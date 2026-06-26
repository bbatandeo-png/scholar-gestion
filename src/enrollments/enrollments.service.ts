import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
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
  Role,
} from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { StudentsService } from '../students/students.service';
import { UsersService } from '../users/users.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { Enrollment, EnrollmentDocument } from './schemas/enrollment.schema';

function getAuditActionLabel(action: string) {
  switch (action) {
    case AuditAction.DISCOUNT_APPLIED:
      return 'Remise appliquée';
    case AuditAction.ENROLLMENT_CREATED:
      return 'Création d’inscription';
    case AuditAction.REENROLLMENT_CREATED:
      return 'Réinscription';
    default:
      return action.replace(/_/g, ' ');
  }
}

function buildAuditDetailsSummary(details?: Record<string, unknown>) {
  if (!details || typeof details !== 'object') {
    return [];
  }

  const items: string[] = [];

  if (Array.isArray(details.updatedFields) && details.updatedFields.length) {
    items.push(`Champs modifiés : ${details.updatedFields.join(', ')}`);
  }

  if (details.reason) {
    items.push(`Motif : ${String(details.reason)}`);
  }

  if (details.registrationFeeBefore !== undefined && details.registrationFeeAfter !== undefined) {
    items.push(`Frais d'inscription : ${String(details.registrationFeeBefore)} → ${String(details.registrationFeeAfter)}`);
  }

  if (details.discountAmountBefore !== undefined && details.discountAmountAfter !== undefined) {
    items.push(`Remise : ${String(details.discountAmountBefore)} → ${String(details.discountAmountAfter)}`);
  }

  if (details.paidAmountBefore !== undefined && details.paidAmountAfter !== undefined) {
    items.push(`Montant payé : ${String(details.paidAmountBefore)} → ${String(details.paidAmountAfter)}`);
  }

  if (details.arrearsAmount !== undefined) {
    items.push(`Impayés reportés : ${String(details.arrearsAmount)}`);
  }

  return items;
}

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    private readonly billingService: BillingService,
    private readonly arrearsService: ArrearsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
    private readonly auditService: AuditService,
    @Inject(forwardRef(() => StudentsService))
    private readonly studentsService: StudentsService,
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService,
  ) {}

  async list() {
    return this.enrollmentModel
      .find()
      .populate({ path: 'studentId', select: 'matricule lastname firstname' })
      .populate({ path: 'schoolYearId', select: 'label' })
      .populate({ path: 'levelId', select: 'label' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async listPaginated(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.enrollmentModel
        .find()
        .populate({ path: 'studentId', select: 'matricule lastname firstname' })
        .populate({ path: 'schoolYearId', select: 'label' })
        .populate({ path: 'levelId', select: 'label' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
      this.enrollmentModel.countDocuments(),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findById(id: string): Promise<{ enrollment: any; invoice: any; auditLogs: any[] }> {
    const enrollment = await this.enrollmentModel
      .findById(id)
      .populate('studentId')
      .populate('schoolYearId')
      .populate('levelId')
      .lean()
      .exec();
    if (!enrollment) {
      throw new NotFoundException('Inscription introuvable');
    }

    const invoice = await this.billingService.findInvoiceByEnrollment(id);
    const auditLogs = await this.getAuditHistoryForEnrollment(id);

    return { enrollment, invoice, auditLogs };
  }

  private async getAuditHistoryForEnrollment(id: string) {
    const logs = await this.auditService.findByEntityTypes(
      ['Enrollment', 'EnrollmentInvoice'],
      id,
    );

    const actorIds = Array.from(
      new Set(logs.map((log) => log.actorId).filter((actorId): actorId is string => Boolean(actorId))),
    );
    const users = actorIds.length ? await this.usersService.findByIds(actorIds) : [];
    const userById = new Map(users.map((user) => [String(user._id), user]));

    return logs.map((log) => ({
      ...log,
      actor: log.actorId ? userById.get(String(log.actorId)) : null,
      actorName: log.actorId ? userById.get(String(log.actorId))?.name ?? 'Utilisateur inconnu' : 'Système',
      actionLabel: getAuditActionLabel(log.action),
      detailsSummary: buildAuditDetailsSummary(log.details as Record<string, unknown> | undefined),
    }));
  }

  async findStudentHistory(studentId: string) {
    return this.enrollmentModel
      .find({ studentId })
      .populate('schoolYearId')
      .populate('levelId')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async previewOpenArrears(studentId: string) {
    return this.arrearsService.findOpenByStudent(studentId);
  }

  private async materializeOutstandingArrearsForStudent(
    studentId: string,
    session?: any,
  ) {
    const enrollments = await this.enrollmentModel
      .find({ studentId })
      .session(session ?? null)
      .exec();

    for (const enrollment of enrollments) {
      const invoice = await this.billingService.findInvoiceByEnrollmentForSession(
        String(enrollment._id),
        session,
      );
      if (invoice && invoice.balanceDue > 0) {
        await this.arrearsService.createFromOutstanding(
          {
            studentId,
            sourceEnrollmentId: String(enrollment._id),
            sourceSchoolYearId: String(enrollment.schoolYearId),
            amount: invoice.balanceDue,
          },
          session,
        );
      }
    }
  }

  async createEnrollment(dto: CreateEnrollmentDto, actorId?: string) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const existing = await this.enrollmentModel
        .findOne({ studentId: dto.studentId, schoolYearId: dto.schoolYearId, status: EnrollmentStatus.ACTIVE })
        .session(session ?? null)
        .exec();
      if (existing) {
        throw new ConflictException('Double inscription active interdite pour cette annee');
      }

      const feeSchedule = await this.billingService.getFeeSchedule(dto.schoolYearId, dto.levelId);
      const created = await this.enrollmentModel.create(
        [
          {
            studentId: dto.studentId,
            schoolYearId: dto.schoolYearId,
            levelId: dto.levelId,
            type: dto.type,
            status: EnrollmentStatus.ACTIVE,
            finalDecision: FinalDecision.PENDING,
            previousEnrollmentId: dto.previousEnrollmentId,
          },
        ],
        { session },
      );
      const enrollment = created[0];

      let arrearsAmount = 0;
      if (dto.applyOpenArrears !== 'false') {
        await this.materializeOutstandingArrearsForStudent(dto.studentId, session);
        const carried = await this.arrearsService.carryForwardToEnrollment(
          dto.studentId,
          String(enrollment._id),
          dto.schoolYearId,
          session,
        );
        arrearsAmount = carried.carriedAmount;
      }

      const invoice = await this.billingService.createOrUpdateInvoice(
        {
          enrollmentId: String(enrollment._id),
          registrationFee: feeSchedule.registrationFee,
          tuitionFee: feeSchedule.tuitionFee,
          arrearsAmount,
          discountAmount: dto.discountAmount ?? 0,
          paidAmount: 0,
        },
        session,
      );

      await this.auditService.log({
        actorId,
        action:
          dto.type === EnrollmentType.RE_ENROLLMENT
            ? AuditAction.REENROLLMENT_CREATED
            : AuditAction.ENROLLMENT_CREATED,
        entityType: 'Enrollment',
        entityId: String(enrollment._id),
        details: {
          studentId: dto.studentId,
          schoolYearId: dto.schoolYearId,
          levelId: dto.levelId,
          arrearsAmount,
        },
      });

      return {
        enrollmentId: String(enrollment._id),
        invoiceId: String(invoice?._id),
        arrearsAmount,
      };
    });
  }

  async reenrollStudent(
    studentId: string,
    payload: {
      targetSchoolYearId: string;
      targetLevelId: string;
      carryOverArrears: boolean;
      reason?: string;
      actorId?: string;
    },
  ) {
    await this.studentsService.findById(studentId);

    const history = await this.findStudentHistory(studentId);
    const previousEnrollmentId = history[0]?._id ? String(history[0]._id) : undefined;

    return this.createEnrollment(
      {
        studentId,
        schoolYearId: payload.targetSchoolYearId,
        levelId: payload.targetLevelId,
        type: EnrollmentType.RE_ENROLLMENT,
        previousEnrollmentId,
        applyOpenArrears: payload.carryOverArrears ? 'true' : 'false',
      },
      payload.actorId,
    );
  }

  async updateEnrollment(id: string, dto: Partial<CreateEnrollmentDto>, actorId?: string) {
    const enrollment = await this.enrollmentModel.findById(id).exec();
    if (!enrollment) {
      throw new NotFoundException('Inscription introuvable');
    }

    const updated = await this.enrollmentModel
      .findByIdAndUpdate(
        id,
        {
          studentId: dto.studentId ?? enrollment.studentId,
          schoolYearId: dto.schoolYearId ?? enrollment.schoolYearId,
          levelId: dto.levelId ?? enrollment.levelId,
          type: dto.type ?? enrollment.type,
          previousEnrollmentId: dto.previousEnrollmentId ?? enrollment.previousEnrollmentId,
        },
        { new: true },
      )
      .exec();

    await this.auditService.log({
      actorId,
      action: AuditAction.ENROLLMENT_CREATED,
      entityType: 'Enrollment',
      entityId: String(updated?._id),
      details: {
        updatedFields: Object.keys(dto),
      },
    });

    return updated;
  }

  async updateFinancialDetails(
    id: string,
    payload: {
      registrationFee?: number;
      discountAmount?: number;
      paidAmount?: number;
      reason?: string;
    },
    actorId?: string,
    actorRole?: string,
  ) {
    const enrollment = await this.enrollmentModel.findById(id).exec();
    if (!enrollment) {
      throw new NotFoundException('Inscription introuvable');
    }

    const canAuthorizeFinancialUpdate = actorRole === Role.SUPER_ADMIN || actorRole === Role.COMPTABILITE;
    if (!canAuthorizeFinancialUpdate) {
      throw new BadRequestException('Seuls le super administrateur et le comptable peuvent modifier les montants financiers');
    }

    const hasFinancialChange = payload.registrationFee !== undefined || payload.discountAmount !== undefined;
    if (hasFinancialChange && !payload.reason?.trim()) {
      throw new BadRequestException('Un motif est obligatoire pour toute modification des montants financiers');
    }

    const invoice = await this.billingService.findInvoiceByEnrollment(id);
    if (!invoice) {
      throw new NotFoundException('Facture introuvable pour cette inscription');
    }

    const updatedInvoice = await this.billingService.createOrUpdateInvoice({
      enrollmentId: id,
      registrationFee: payload.registrationFee ?? invoice.registrationFee,
      tuitionFee: invoice.tuitionFee,
      discountAmount: payload.discountAmount ?? invoice.discountAmount,
      arrearsAmount: invoice.arrearsAmount,
      paidAmount: payload.paidAmount ?? invoice.paidAmount,
    });

    await this.auditService.log({
      actorId,
      action: AuditAction.DISCOUNT_APPLIED,
      entityType: 'EnrollmentInvoice',
      entityId: id,
      details: {
        registrationFeeBefore: invoice.registrationFee,
        registrationFeeAfter: updatedInvoice?.registrationFee,
        discountAmountBefore: invoice.discountAmount,
        discountAmountAfter: updatedInvoice?.discountAmount,
        reason: payload.reason?.trim(),
      },
    });

    return updatedInvoice;
  }

  async closeEnrollmentWithDecision(
    enrollmentId: string,
    finalDecision: FinalDecision,
    session?: any,
  ) {
    return this.enrollmentModel.findByIdAndUpdate(
      enrollmentId,
      { status: EnrollmentStatus.CLOSED, finalDecision },
      { new: true, session },
    );
  }
}