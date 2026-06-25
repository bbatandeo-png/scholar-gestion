import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { ArrearsService } from '../arrears/arrears.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import {
  AuditAction,
  EnrollmentStatus,
  EnrollmentType,
  FinalDecision,
} from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { Enrollment, EnrollmentDocument } from '../enrollments/schemas/enrollment.schema';
import { ValidatePromotionsDto } from './dto/validate-promotions.dto';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    private readonly billingService: BillingService,
    private readonly arrearsService: ArrearsService,
    private readonly auditService: AuditService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async prepare(sourceSchoolYearId: string) {
    return this.enrollmentModel
      .find({ schoolYearId: sourceSchoolYearId, status: EnrollmentStatus.ACTIVE })
      .populate('studentId')
      .populate('levelId')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async validate(dto: ValidatePromotionsDto, actorId?: string) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      let promoted = 0;
      let repeated = 0;
      let archived = 0;
      let arrearsCarriedForwardTotal = 0;

      for (const item of dto.decisions) {
        const source = await this.enrollmentModel
          .findById(item.sourceEnrollmentId)
          .session(session ?? null)
          .exec();
        if (!source) {
          continue;
        }

        const sourceInvoice = await this.billingService.findInvoiceByEnrollmentForSession(
          String(source._id),
          session,
        );
        if (sourceInvoice && sourceInvoice.balanceDue > 0) {
          await this.arrearsService.createFromOutstanding(
            {
              studentId: item.studentId,
              sourceEnrollmentId: String(source._id),
              sourceSchoolYearId: String(source.schoolYearId),
              amount: sourceInvoice.balanceDue,
            },
            session,
          );
        }

        if ([FinalDecision.PROMOTED, FinalDecision.REPEATED].includes(item.decision)) {
          if (!item.targetLevelId) {
            throw new Error('targetLevelId requis pour une decision de promotion ou redoublement');
          }

          const existingTargetEnrollment = await this.enrollmentModel
            .findOne({
              studentId: item.studentId,
              schoolYearId: dto.targetSchoolYearId,
              status: EnrollmentStatus.ACTIVE,
            })
            .session(session ?? null)
            .exec();

          if (existingTargetEnrollment) {
            throw new ConflictException(
              'Impossible de valider la promotion : une inscription active existe deja pour cet eleve et cette annee scolaire.',
            );
          }

          const created = await this.enrollmentModel.create(
            [
              {
                studentId: item.studentId,
                schoolYearId: dto.targetSchoolYearId,
                levelId: item.targetLevelId,
                type:
                  item.decision === FinalDecision.PROMOTED
                    ? EnrollmentType.PROMOTION
                    : EnrollmentType.REPEAT,
                status: EnrollmentStatus.ACTIVE,
                finalDecision: FinalDecision.PENDING,
                previousEnrollmentId: source._id,
              },
            ],
            { session },
          );

          const feeSchedule = await this.billingService.getFeeSchedule(
            dto.targetSchoolYearId,
            item.targetLevelId,
          );

          let arrearsAmount = 0;
          if (dto.carryOverArrears) {
            const carried = await this.arrearsService.carryForwardToEnrollment(
              item.studentId,
              String(created[0]._id),
              dto.targetSchoolYearId,
              session,
            );
            arrearsAmount = carried.carriedAmount;
            arrearsCarriedForwardTotal += carried.carriedAmount;
          }

          await this.billingService.createOrUpdateInvoice(
            {
              enrollmentId: String(created[0]._id),
              registrationFee: feeSchedule.registrationFee,
              tuitionFee: feeSchedule.tuitionFee,
              arrearsAmount,
              discountAmount: 0,
              paidAmount: 0,
            },
            session,
          );

          if (item.decision === FinalDecision.PROMOTED) {
            promoted += 1;
          } else {
            repeated += 1;
          }
        } else {
          archived += 1;
        }

        source.status = EnrollmentStatus.CLOSED;
        source.finalDecision = item.decision;
        await source.save({ session });
      }

      await this.auditService.log({
        actorId,
        action: AuditAction.PROMOTION_VALIDATED,
        entityType: 'PromotionBatch',
        entityId: dto.targetSchoolYearId,
        details: {
          sourceSchoolYearId: dto.sourceSchoolYearId,
          processed: dto.decisions.length,
          promoted,
          repeated,
          archived,
          arrearsCarriedForwardTotal,
        },
      });

      return {
        processed: dto.decisions.length,
        promoted,
        repeated,
        archived,
        arrearsCarriedForwardTotal,
      };
    });
  }
}