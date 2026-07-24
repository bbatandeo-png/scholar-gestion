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
  SchoolYearStatus,
  StudentStatus,
} from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import {
  Enrollment,
  EnrollmentDocument,
} from '../enrollments/schemas/enrollment.schema';
import { ValidatePromotionsDto } from './dto/validate-promotions.dto';
import {
  SchoolYear,
  SchoolYearDocument,
} from '../school-years/schemas/school-year.schema';
import { Student, StudentDocument } from '../students/schemas/student.schema';
import { LevelsService } from '../levels/levels.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(SchoolYear.name)
    private readonly schoolYearModel: Model<SchoolYearDocument>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<StudentDocument>,
    private readonly billingService: BillingService,
    private readonly arrearsService: ArrearsService,
    private readonly auditService: AuditService,
    private readonly levelsService: LevelsService,
    private readonly settingsService: SettingsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async prepare(sourceSchoolYearId: string) {
    const candidates = await this.enrollmentModel
      .find({
        schoolYearId: sourceSchoolYearId,
        status: EnrollmentStatus.ACTIVE,
      })
      .populate('studentId')
      .populate('levelId')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return Promise.all(
      candidates.map(async (candidate: any) => {
        const next = await this.levelsService.findNextLevel(
          String(candidate.levelId?._id ?? candidate.levelId),
        );
        return {
          ...candidate,
          suggestedTargetLevelId: next ? String(next._id) : '',
        };
      }),
    );
  }

  async validate(dto: ValidatePromotionsDto, actorId?: string) {
    return runWithMongoTransactionFallback(
      this.connection,
      async (session) => {
        // MongoDB n'autorise pas les opérations parallèles sur une même
        // session transactionnelle.
        const sourceYear = await this.schoolYearModel
          .findById(dto.sourceSchoolYearId)
          .session(session ?? null)
          .exec();
        const targetYear = await this.schoolYearModel
          .findById(dto.targetSchoolYearId)
          .session(session ?? null)
          .exec();
        if (!sourceYear || !targetYear) {
          throw new ConflictException('Annee source ou cible introuvable');
        }
        if (targetYear.preparedAt) {
          throw new ConflictException(
            'Cette annee scolaire a deja ete preparee',
          );
        }
        if (String(sourceYear._id) === String(targetYear._id)) {
          throw new ConflictException(
            'Les annees source et cible doivent etre differentes',
          );
        }
        if (sourceYear.status !== SchoolYearStatus.CLOSED) {
          throw new ConflictException(
            'Cloturez manuellement l annee source avant d activer la suivante',
          );
        }
        const currentOpen = await this.schoolYearModel
          .findOne({ status: SchoolYearStatus.OPEN })
          .session(session ?? null)
          .lean()
          .exec();
        if (currentOpen) {
          throw new ConflictException(
            `Cloturez d abord l annee ${currentOpen.label} avant d activer la suivante`,
          );
        }
        const activeSourceIds = await this.enrollmentModel
          .find({
            schoolYearId: dto.sourceSchoolYearId,
            status: EnrollmentStatus.ACTIVE,
          })
          .session(session ?? null)
          .distinct('_id')
          .exec();
        const decisionIds = new Set(
          dto.decisions.map((item) => String(item.sourceEnrollmentId)),
        );
        if (
          decisionIds.size !== activeSourceIds.length ||
          activeSourceIds.some((id) => !decisionIds.has(String(id)))
        ) {
          throw new ConflictException(
            'Une decision est requise pour chaque inscription active de l annee source',
          );
        }

        await this.levelsService.copyYearConfiguration(
          dto.sourceSchoolYearId,
          dto.targetSchoolYearId,
          session,
        );
        await this.billingService.copyFeeSchedules(
          dto.sourceSchoolYearId,
          dto.targetSchoolYearId,
          session,
        );
        await this.settingsService.copyAnnualSettings(
          dto.sourceSchoolYearId,
          dto.targetSchoolYearId,
          session,
        );

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
          if (String(source.schoolYearId) !== String(dto.sourceSchoolYearId)) {
            throw new ConflictException(
              'Une decision ne correspond pas a l annee source',
            );
          }
          if (String(source.studentId) !== String(item.studentId)) {
            throw new ConflictException(
              'La decision ne correspond pas a l eleve source',
            );
          }
          if (source.rolloverProcessedAt) {
            throw new ConflictException(
              'Une inscription source a deja ete traitee',
            );
          }

          const sourceInvoice =
            await this.billingService.findInvoiceByEnrollmentForSession(
              String(source._id),
              session,
            );
          const priorArrears = await this.arrearsService.findByTargetEnrollment(
            String(source._id),
            session,
          );
          const priorArrearsRemaining = priorArrears.reduce(
            (sum: number, arrear: any) =>
              sum + Number(arrear.amountRemaining ?? 0),
            0,
          );
          const currentFeesOutstanding = sourceInvoice
            ? Math.max(
                Number(sourceInvoice.balanceDue) - priorArrearsRemaining,
                0,
              )
            : 0;
          if (sourceInvoice && currentFeesOutstanding > 0) {
            await this.arrearsService.createFromOutstanding(
              {
                studentId: item.studentId,
                sourceEnrollmentId: String(source._id),
                sourceSchoolYearId: String(source.schoolYearId),
                amount: currentFeesOutstanding,
              },
              session,
            );
          }

          if (
            [FinalDecision.PROMOTED, FinalDecision.REPEATED].includes(
              item.decision,
            )
          ) {
            const nextLevel =
              item.decision === FinalDecision.PROMOTED
                ? await this.levelsService.findNextLevel(String(source.levelId))
                : await this.levelsService.findById(String(source.levelId));
            if (!nextLevel) {
              throw new ConflictException(
                'Aucun niveau cible automatique : une decision de sortie est requise',
              );
            }
            const targetLevelId = String(nextLevel._id);
            const student = await this.studentModel
              .findById(item.studentId)
              .session(session ?? null)
              .lean()
              .exec();

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
                  levelId: targetLevelId,
                  studentSnapshot: student
                    ? {
                        matricule: student.matricule,
                        lastname: student.lastname,
                        firstname: student.firstname,
                        gender: student.gender,
                        birthDate: student.birthDate,
                        birthPlace: student.birthPlace,
                        district: student.district,
                      }
                    : source.studentSnapshot,
                  levelSnapshot: {
                    code: nextLevel.code,
                    label: nextLevel.label,
                    sortOrder: nextLevel.sortOrder,
                  },
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
              targetLevelId,
              session,
            );

            let arrearsAmount = 0;
            if (dto.carryOverArrears) {
              const carried =
                await this.arrearsService.carryForwardToEnrollment(
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
                schoolYearId: dto.targetSchoolYearId,
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
            const nextStudentStatus =
              item.decision === FinalDecision.TRANSFERRED
                ? StudentStatus.TRANSFERRED
                : item.decision === FinalDecision.LEFT
                  ? StudentStatus.LEFT
                  : StudentStatus.ARCHIVED;
            await this.studentModel.updateOne(
              { _id: item.studentId },
              { status: nextStudentStatus },
              { session },
            );
            await this.studentModel.updateOne(
              { _id: item.studentId },
              { status: StudentStatus.ACTIVE },
              { session },
            );
          }

          source.status = EnrollmentStatus.CLOSED;
          source.finalDecision = item.decision;
          source.promotionTargetLevelId =
            item.decision === FinalDecision.REPEATED
              ? String(source.levelId)
              : item.targetLevelId || undefined;
          source.rolloverProcessedAt = new Date();
          await source.save({ session });
        }

        targetYear.status = SchoolYearStatus.OPEN;
        targetYear.preparedAt = new Date();
        targetYear.preparedFromSchoolYearId = String(sourceYear._id);
        targetYear.rolloverVersion = 1;
        await targetYear.save({ session });

        await this.auditService.log(
          {
            schoolYearId: dto.targetSchoolYearId,
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
          },
          session,
        );

        return {
          processed: dto.decisions.length,
          promoted,
          repeated,
          archived,
          arrearsCarriedForwardTotal,
        };
      },
      { allowFallback: false },
    );
  }
}
