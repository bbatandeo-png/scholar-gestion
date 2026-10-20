import { FeeScheduleNotFoundException } from '../common/exceptions/fee-schedule-not-found.exception';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { ArrearsService } from '../arrears/arrears.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { normalizeLabel } from '../bulletins/bulletins-import.util';
import {
  AuditAction,
  EnrollmentStatus,
  EnrollmentType,
  FinalDecision,
  GuardianType,
  PaymentMethod,
  Role,
} from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { PopulatedEnrollmentLean } from '../common/types/populated-refs.types';
import {
  parseExcelDate,
  pickRowValue,
  readExcelRows,
} from '../common/utils/excel.util';
import { toDisplayString } from '../common/utils/safe-string.util';
import { LevelsService } from '../levels/levels.service';
import { PaymentsService } from '../payments/payments.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { CreateStudentDto } from '../students/dto/create-student.dto';
import { StudentsService } from '../students/students.service';
import { UsersService } from '../users/users.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { Enrollment, EnrollmentDocument } from './schemas/enrollment.schema';

export type ImportPaidStudentsReport = {
  created: number;
  paid: number;
  skipped: number;
  unknownClass: number;
  missingFields: number;
  invalidDate: number;
  creationFailed: number;
};

function getAuditActionLabel(action: string) {
  // action is deliberately a bare string, not AuditAction: the default
  // branch below also has to handle audit actions outside that enum -
  // string equality against the enum's (string) values is safe here.
  /* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
  switch (action) {
    case AuditAction.DISCOUNT_APPLIED:
      return 'Remise appliquée';
    case AuditAction.PAYMENT_CORRECTED:
      return 'Correction du registre des paiements';
    case AuditAction.ENROLLMENT_CREATED:
      return 'Création d’inscription';
    case AuditAction.REENROLLMENT_CREATED:
      return 'Réinscription';
    default:
      return action.replace(/_/g, ' ');
  }
  /* eslint-enable @typescript-eslint/no-unsafe-enum-comparison */
}

// Audit details are stored as an untyped bag (Record<string, unknown>), so a
// bare String(x) can't be proven safe by the type checker and would render
// "[object Object]" if a value ever isn't a primitive - format defensively
// instead of asserting a shape we don't actually control here.
function formatAuditValue(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
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
    items.push(`Motif : ${formatAuditValue(details.reason)}`);
  }

  if (
    details.registrationFeeBefore !== undefined &&
    details.registrationFeeAfter !== undefined
  ) {
    items.push(
      `Frais d'inscription : ${formatAuditValue(details.registrationFeeBefore)} → ${formatAuditValue(details.registrationFeeAfter)}`,
    );
  }

  if (
    details.discountAmountBefore !== undefined &&
    details.discountAmountAfter !== undefined
  ) {
    items.push(
      `Remise : ${formatAuditValue(details.discountAmountBefore)} → ${formatAuditValue(details.discountAmountAfter)}`,
    );
  }

  if (
    details.paidAmountBefore !== undefined &&
    details.paidAmountAfter !== undefined
  ) {
    items.push(
      `Montant payé : ${formatAuditValue(details.paidAmountBefore)} → ${formatAuditValue(details.paidAmountAfter)}`,
    );
  }

  if (details.arrearsAmount !== undefined) {
    items.push(`Impayés reportés : ${formatAuditValue(details.arrearsAmount)}`);
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
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService,
  ) {}

  async list(schoolYearId: string): Promise<
    Array<
      PopulatedEnrollmentLean & {
        type?: EnrollmentType;
        status?: EnrollmentStatus;
        finalDecision?: FinalDecision;
      }
    >
  > {
    return this.enrollmentModel
      .find({ schoolYearId })
      .populate({ path: 'studentId', select: 'matricule lastname firstname' })
      .populate({ path: 'schoolYearId', select: 'label' })
      .populate({ path: 'levelId', select: 'label' })
      .sort({ createdAt: -1 })
      .lean()
      .exec() as unknown as Promise<
      Array<
        PopulatedEnrollmentLean & {
          type?: EnrollmentType;
          status?: EnrollmentStatus;
          finalDecision?: FinalDecision;
        }
      >
    >;
  }

  // Every word typed must match either the student (matricule / lastname /
  // firstname) or the level (label / code) - so "kouassi cp1" narrows to that
  // student in that class, and a single word works on either.
  private async buildSearchCriteria(schoolYearId: string, query?: string) {
    const tokens = (query ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    if (!tokens.length) {
      return { schoolYearId };
    }

    const normalize = (value: string) =>
      value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const levels = await this.levelsService.listForSchoolYear(schoolYearId);
    const conditions = await Promise.all(
      tokens.map(async (token) => {
        const studentIds = await this.studentsService.findIdsMatching(
          token,
          schoolYearId,
        );
        const needle = normalize(token);
        const levelIds = levels
          .filter((level) =>
            normalize(`${level.label} ${level.code}`).includes(needle),
          )
          .map((level) => toDisplayString(level._id));
        return {
          $or: [
            { studentId: { $in: studentIds } },
            { levelId: { $in: levelIds } },
          ],
        };
      }),
    );
    return { schoolYearId, $and: conditions };
  }

  async listPaginated(
    schoolYearId: string,
    page: number,
    pageSize: number,
    query?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const criteria = await this.buildSearchCriteria(schoolYearId, query);
    const [items, total] = await Promise.all([
      this.enrollmentModel
        .find(criteria)
        .populate({ path: 'studentId', select: 'matricule lastname firstname' })
        .populate({ path: 'schoolYearId', select: 'label' })
        .populate({ path: 'levelId', select: 'label' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
      this.enrollmentModel.countDocuments(criteria),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findById(id: string): Promise<{
    enrollment: PopulatedEnrollmentLean;
    invoice: Awaited<ReturnType<BillingService['findInvoiceByEnrollment']>>;
    auditLogs: Awaited<
      ReturnType<EnrollmentsService['getAuditHistoryForEnrollment']>
    >;
  }> {
    const enrollment = (await this.enrollmentModel
      .findById(id)
      .populate('studentId')
      .populate('schoolYearId')
      .populate('levelId')
      .lean()
      .exec()) as PopulatedEnrollmentLean | null;
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
      new Set(
        logs
          .map((log) => log.actorId)
          .filter((actorId): actorId is string => Boolean(actorId)),
      ),
    );
    const users = actorIds.length
      ? await this.usersService.findByIds(actorIds)
      : [];
    const userById = new Map(users.map((user) => [String(user._id), user]));

    return logs.map((log) => ({
      ...log,
      actor: log.actorId ? userById.get(String(log.actorId)) : null,
      actorName: log.actorId
        ? (userById.get(String(log.actorId))?.name ?? 'Utilisateur inconnu')
        : 'Système',
      actionLabel: getAuditActionLabel(log.action),
      detailsSummary: buildAuditDetailsSummary(
        log.details as Record<string, unknown> | undefined,
      ),
    }));
  }

  async findStudentHistory(
    studentId: string,
    schoolYearId?: string,
  ): Promise<PopulatedEnrollmentLean[]> {
    return this.enrollmentModel
      .find({ studentId, ...(schoolYearId ? { schoolYearId } : {}) })
      .populate('schoolYearId')
      .populate('levelId')
      .sort({ createdAt: -1 })
      .lean()
      .exec() as unknown as Promise<PopulatedEnrollmentLean[]>;
  }

  async previewOpenArrears(studentId: string) {
    return this.arrearsService.findOpenByStudent(studentId);
  }

  private async materializeOutstandingArrearsForStudent(
    studentId: string,
    session?: ClientSession,
  ) {
    const enrollments = await this.enrollmentModel
      .find({ studentId })
      .session(session ?? null)
      .exec();

    for (const enrollment of enrollments) {
      const invoice =
        await this.billingService.findInvoiceByEnrollmentForSession(
          String(enrollment._id),
          session,
        );
      const carriedArrears = await this.arrearsService.findByTargetEnrollment(
        String(enrollment._id),
        session,
      );
      const carriedRemaining = carriedArrears.reduce(
        (sum: number, arrear) => sum + Number(arrear.amountRemaining ?? 0),
        0,
      );
      const currentFeesOutstanding = invoice
        ? Math.max(Number(invoice.balanceDue) - carriedRemaining, 0)
        : 0;
      if (invoice && currentFeesOutstanding > 0) {
        await this.arrearsService.createFromOutstanding(
          {
            studentId,
            sourceEnrollmentId: String(enrollment._id),
            sourceSchoolYearId: String(enrollment.schoolYearId),
            amount: currentFeesOutstanding,
          },
          session,
        );
      }
    }
  }

  // Used by EnrollmentsController.create() to tell "genuinely enrolling a
  // new student" apart from "this student is already enrolled this year,
  // and the desk actually wants to record another payment against their
  // existing invoice" before ever reaching the duplicate-enrollment guard
  // below.
  async findActiveEnrollment(studentId: string, schoolYearId: string) {
    return this.enrollmentModel
      .findOne({
        studentId,
        schoolYearId,
        status: EnrollmentStatus.ACTIVE,
      })
      .exec();
  }

  async createEnrollment(dto: CreateEnrollmentDto, actorId?: string) {
    await this.schoolYearsService.assertWritable(dto.schoolYearId);
    const [studentSnapshot, levelSnapshot] = await Promise.all([
      this.studentsService.findById(dto.studentId),
      this.levelsService.findById(dto.levelId),
    ]);
    if (!levelSnapshot) {
      throw new NotFoundException('Niveau introuvable');
    }
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const existing = await this.enrollmentModel
        .findOne({
          studentId: dto.studentId,
          schoolYearId: dto.schoolYearId,
          status: EnrollmentStatus.ACTIVE,
        })
        .session(session ?? null)
        .exec();
      if (existing) {
        throw new ConflictException(
          'Double inscription active interdite pour cette année',
        );
      }

      const feeSchedule = await this.billingService.getFeeSchedule(
        dto.schoolYearId,
        dto.levelId,
      );
      const created = await this.enrollmentModel.create(
        [
          {
            studentId: dto.studentId,
            schoolYearId: dto.schoolYearId,
            levelId: dto.levelId,
            studentSnapshot: {
              matricule: studentSnapshot.matricule,
              lastname: studentSnapshot.lastname,
              firstname: studentSnapshot.firstname,
              gender: studentSnapshot.gender,
              birthDate: studentSnapshot.birthDate,
              birthPlace: studentSnapshot.birthPlace,
              district: studentSnapshot.district,
            },
            levelSnapshot: {
              code: levelSnapshot.code,
              label: levelSnapshot.label,
              sortOrder: levelSnapshot.sortOrder,
            },
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
        await this.materializeOutstandingArrearsForStudent(
          dto.studentId,
          session,
        );
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
          schoolYearId: dto.schoolYearId,
          enrollmentId: String(enrollment._id),
          registrationFee: feeSchedule.registrationFee,
          tuitionFee: feeSchedule.tuitionFee,
          arrearsAmount,
          discountAmount: dto.discountAmount ?? 0,
          paidAmount: 0,
        },
        session,
      );

      await this.auditService.log(
        {
          schoolYearId: dto.schoolYearId,
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
        },
        session,
      );

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
    const previousEnrollmentId = history[0]?._id
      ? toDisplayString(history[0]._id)
      : undefined;

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

  async updateEnrollment(
    id: string,
    rawDto: Partial<CreateEnrollmentDto> & { levelChangeReason?: string },
    actorId?: string,
    actorRole?: string,
  ) {
    // A blank field (e.g. the untouched "Choisir un niveau" placeholder)
    // means "leave unchanged", never a value to write.
    const dto = Object.fromEntries(
      Object.entries(rawDto).filter(([, value]) => value !== ''),
    ) as Partial<CreateEnrollmentDto> & { levelChangeReason?: string };
    const enrollment = await this.enrollmentModel.findById(id).exec();
    if (!enrollment) {
      throw new NotFoundException('Inscription introuvable');
    }
    await this.schoolYearsService.assertWritable(
      String(enrollment.schoolYearId),
    );

    const studentChanged =
      dto.studentId && dto.studentId !== String(enrollment.studentId);
    const levelChanged =
      dto.levelId && dto.levelId !== String(enrollment.levelId);

    if (studentChanged) {
      // Same guard createEnrollment already applies at creation time - the
      // student being switched onto this enrollment must not already have
      // a separate active enrollment for the same school year.
      const conflicting = await this.enrollmentModel
        .findOne({
          _id: { $ne: id },
          studentId: dto.studentId,
          schoolYearId: enrollment.schoolYearId,
          status: EnrollmentStatus.ACTIVE,
        })
        .exec();
      if (conflicting) {
        throw new ConflictException(
          'Double inscription active interdite pour cette année',
        );
      }
    }

    // studentSnapshot/levelSnapshot are denormalized for display (e.g. the
    // enrollments list) - they must be refreshed whenever the student or
    // level actually changes, otherwise the list keeps showing the old
    // student/level for this row even though the detail page (which
    // populates the live reference) shows the new one.
    const [studentSnapshot, levelSnapshot] = await Promise.all([
      studentChanged
        ? this.studentsService.findById(dto.studentId as string)
        : null,
      levelChanged ? this.levelsService.findById(dto.levelId as string) : null,
    ]);
    if (levelChanged && !levelSnapshot) {
      throw new NotFoundException('Niveau introuvable');
    }

    // Changement de classe : un eleve qui a deja paye cette annee ne change
    // de classe que sur decision de la direction (ou du super administrateur),
    // avec un motif - la facture est ensuite recalculee sur les frais de la
    // nouvelle classe, sans toucher aux paiements deja encaisses.
    const invoiceBefore = levelChanged
      ? await this.billingService.findInvoiceByEnrollment(id)
      : null;
    const alreadyPaid = Number(invoiceBefore?.paidAmount ?? 0) > 0;
    const levelChangeReason = dto.levelChangeReason?.trim() ?? '';
    if (levelChanged && alreadyPaid) {
      if (actorRole !== Role.SUPER_ADMIN && actorRole !== Role.DIRECTION) {
        throw new BadRequestException(
          'Cet élève a déjà effectué un paiement cette année : seuls la direction et le super administrateur peuvent changer sa classe. Adressez-vous à la direction.',
        );
      }
      if (!levelChangeReason) {
        throw new BadRequestException(
          'Cet élève a déjà effectué un paiement : indiquez le motif du changement de classe.',
        );
      }
    }
    // Frais de la nouvelle classe : si sa grille n'est pas encore
    // configuree, le changement reste possible et la facture garde ses
    // montants (comportement d'avant), plutot que de bloquer l'operation.
    const newFees = levelChanged
      ? await this.billingService
          .getFeeSchedule(
            String(enrollment.schoolYearId),
            dto.levelId as string,
          )
          .catch((error: unknown) => {
            if (error instanceof FeeScheduleNotFoundException) {
              return null;
            }
            throw error;
          })
      : null;

    const updated = await this.enrollmentModel
      .findByIdAndUpdate(
        id,
        {
          studentId: dto.studentId ?? enrollment.studentId,
          schoolYearId: enrollment.schoolYearId,
          levelId: dto.levelId ?? enrollment.levelId,
          type: dto.type ?? enrollment.type,
          previousEnrollmentId:
            dto.previousEnrollmentId ?? enrollment.previousEnrollmentId,
          ...(studentSnapshot
            ? {
                studentSnapshot: {
                  matricule: studentSnapshot.matricule,
                  lastname: studentSnapshot.lastname,
                  firstname: studentSnapshot.firstname,
                  gender: studentSnapshot.gender,
                  birthDate: studentSnapshot.birthDate,
                  birthPlace: studentSnapshot.birthPlace,
                  district: studentSnapshot.district,
                },
              }
            : {}),
          ...(levelSnapshot
            ? {
                levelSnapshot: {
                  code: levelSnapshot.code,
                  label: levelSnapshot.label,
                  sortOrder: levelSnapshot.sortOrder,
                },
              }
            : {}),
        },
        { new: true },
      )
      .exec();

    if (levelChanged && invoiceBefore && newFees) {
      const invoiceAfter = await this.billingService.createOrUpdateInvoice({
        schoolYearId: String(enrollment.schoolYearId),
        enrollmentId: id,
        registrationFee: newFees.registrationFee,
        tuitionFee: newFees.tuitionFee,
        discountAmount: invoiceBefore.discountAmount,
        arrearsAmount: invoiceBefore.arrearsAmount,
        paidAmount: invoiceBefore.paidAmount,
      });
      await this.auditService.log({
        schoolYearId: String(enrollment.schoolYearId),
        actorId,
        action: AuditAction.ENROLLMENT_LEVEL_CHANGED,
        entityType: 'Enrollment',
        entityId: id,
        details: {
          fromLevelId: String(enrollment.levelId),
          toLevelId: dto.levelId,
          toLevelLabel: levelSnapshot?.label,
          reason: levelChangeReason || undefined,
          paidAmount: invoiceBefore.paidAmount,
          totalDueBefore: invoiceBefore.totalDue,
          totalDueAfter: invoiceAfter?.totalDue,
          balanceDueAfter: invoiceAfter?.balanceDue,
        },
      });
    }

    await this.auditService.log({
      schoolYearId: String(enrollment.schoolYearId),
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
    await this.schoolYearsService.assertWritable(
      String(enrollment.schoolYearId),
    );

    const canAuthorizeFinancialUpdate =
      actorRole === Role.SUPER_ADMIN || actorRole === Role.COMPTABILITE;
    if (!canAuthorizeFinancialUpdate) {
      throw new BadRequestException(
        'Seuls le super administrateur et le comptable peuvent modifier les montants financiers',
      );
    }

    if (
      payload.paidAmount !== undefined &&
      (!Number.isFinite(payload.paidAmount) || payload.paidAmount < 0)
    ) {
      throw new BadRequestException(
        'Le montant payé doit être un nombre positif ou nul',
      );
    }

    const hasFinancialChange =
      payload.registrationFee !== undefined ||
      payload.discountAmount !== undefined ||
      payload.paidAmount !== undefined;
    if (hasFinancialChange && !payload.reason?.trim()) {
      throw new BadRequestException(
        'Un motif est obligatoire pour toute modification des montants financiers',
      );
    }

    const invoice = await this.billingService.findInvoiceByEnrollment(id);
    if (!invoice) {
      throw new NotFoundException('Facture introuvable pour cette inscription');
    }

    const updatedInvoice = await this.billingService.createOrUpdateInvoice({
      schoolYearId: String(enrollment.schoolYearId),
      enrollmentId: id,
      registrationFee: payload.registrationFee ?? invoice.registrationFee,
      tuitionFee: invoice.tuitionFee,
      discountAmount: payload.discountAmount ?? invoice.discountAmount,
      arrearsAmount: invoice.arrearsAmount,
      paidAmount: payload.paidAmount ?? invoice.paidAmount,
    });

    // Correcting the paid amount by hand (e.g. to cancel a payment entered by
    // mistake) must also correct the payment ledger: the dashboard and the
    // revenue report add up Payment documents, not invoice.paidAmount, so
    // without a matching entry they would keep counting the cancelled money.
    const previousPaid = Number(invoice.paidAmount ?? 0);
    const paidDelta =
      payload.paidAmount !== undefined ? payload.paidAmount - previousPaid : 0;
    if (Math.abs(paidDelta) >= 0.01) {
      await this.billingService.recordPaymentCorrection({
        invoiceId: String(invoice._id),
        schoolYearId: String(enrollment.schoolYearId),
        delta: paidDelta,
        reason: `Correction du montant payé : ${payload.reason?.trim() ?? ''}`,
        actorId,
      });
    }

    // The paid amount is the one figure with its own global history page
    // (see getPaymentModificationsHistory()) and dashboard indicator, so it
    // needs its own action distinct from a plain discount/fee edit - a form
    // submit always resends the current paidAmount, so this checks the
    // actual delta rather than whether the field was merely present.
    await this.auditService.log({
      schoolYearId: String(enrollment.schoolYearId),
      actorId,
      action:
        Math.abs(paidDelta) >= 0.01
          ? AuditAction.PAYMENT_CORRECTED
          : AuditAction.DISCOUNT_APPLIED,
      entityType: 'EnrollmentInvoice',
      entityId: id,
      details: {
        registrationFeeBefore: invoice.registrationFee,
        registrationFeeAfter: updatedInvoice?.registrationFee,
        discountAmountBefore: invoice.discountAmount,
        discountAmountAfter: updatedInvoice?.discountAmount,
        paidAmountBefore: invoice.paidAmount,
        paidAmountAfter: updatedInvoice?.paidAmount,
        reason: payload.reason?.trim(),
      },
    });

    return updatedInvoice;
  }

  // Global "historique des modifications de paiement": every PAYMENT_CORRECTED
  // audit entry for the school year, whatever triggered it (a manual
  // financial-details edit above, or an automatic ledger-reconciliation
  // correction in PaymentsService.applyLedgerCorrections) - deliberately
  // excludes every other audit action (enrollment creation, a fresh payment,
  // a plain discount edit with no paid-amount change, ...).
  async getPaymentModificationsHistory(
    schoolYearId: string,
    page = 1,
    pageSize = 20,
  ) {
    const { logs, total } = await this.auditService.listByAction(
      [AuditAction.PAYMENT_CORRECTED],
      { schoolYearId },
      { page, pageSize },
    );

    const actorIds = Array.from(
      new Set(
        logs
          .map((log) => log.actorId)
          .filter((actorId): actorId is string => Boolean(actorId)),
      ),
    );
    const users = actorIds.length
      ? await this.usersService.findByIds(actorIds)
      : [];
    const userById = new Map(users.map((user) => [String(user._id), user]));

    const entityIds = Array.from(new Set(logs.map((log) => log.entityId)));
    const enrollments = (entityIds.length
      ? await this.enrollmentModel
          .find({ _id: { $in: entityIds } })
          .populate({
            path: 'studentId',
            select: 'matricule lastname firstname',
          })
          .populate({ path: 'levelId', select: 'label' })
          .lean()
          .exec()
      : []) as unknown as PopulatedEnrollmentLean[];
    const enrollmentById = new Map(
      enrollments.map((enrollment) => [String(enrollment._id), enrollment]),
    );

    type NamedStudent = {
      matricule?: string;
      lastname?: string;
      firstname?: string;
    };
    const rows = logs.map((log) => {
      const enrollment = enrollmentById.get(String(log.entityId));
      const student = (enrollment?.studentSnapshot ?? enrollment?.studentId) as
        | NamedStudent
        | undefined;
      const level = enrollment?.levelSnapshot ?? enrollment?.levelId;
      const details = (log.details ?? {}) as Record<string, unknown>;
      const paidBefore = Number(details.paidAmountBefore ?? 0);
      const paidAfter = Number(details.paidAmountAfter ?? paidBefore);
      // AuditLog's TS class doesn't declare createdAt (it's added purely by
      // the schema's `timestamps: { createdAt: true }` option) - same reason
      // getAuditHistoryForEnrollment() above only ever spreads a log rather
      // than naming this field.
      const createdAt = (log as unknown as { createdAt?: Date }).createdAt;

      return {
        date: createdAt,
        enrollmentId: log.entityId,
        studentName:
          `${student?.lastname ?? ''} ${student?.firstname ?? ''}`.trim() ||
          'Élève inconnu',
        matricule: student?.matricule ?? '',
        levelLabel: level?.label ?? '',
        actorName: log.actorId
          ? (userById.get(String(log.actorId))?.name ?? 'Utilisateur inconnu')
          : 'Système',
        paidBefore,
        paidAfter,
        delta: paidAfter - paidBefore,
        reason: formatAuditValue(details.reason ?? ''),
      };
    });

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async closeEnrollmentWithDecision(
    enrollmentId: string,
    finalDecision: FinalDecision,
    session?: ClientSession,
  ) {
    return this.enrollmentModel.findByIdAndUpdate(
      enrollmentId,
      { status: EnrollmentStatus.CLOSED, finalDecision },
      { new: true, session },
    );
  }

  // Migration-style bulk import (see SettingsService.
  // getImportPaidStudentsEnabled - off by default, a school opts in).
  // Creates the student, enrolls into schoolYearId/the row's classe, and -
  // if a montant_paye was given - records it as-is, no recalculation
  // against the fee schedule. One row's failure never aborts the batch:
  // each row is independent, same convention as StudentsService's own
  // /students/import. levelId is matched from the row's "classe"/"niveau"
  // text against the levels actually enabled for schoolYearId (accent/case
  // insensitive via normalizeLabel, same matcher bulletins import uses).
  async importPaidStudents(
    fileBuffer: Buffer,
    schoolYearId: string,
    actorId?: string,
  ): Promise<ImportPaidStudentsReport> {
    const levels = await this.levelsService.listForSchoolYear(schoolYearId);
    const levelIdByLabel = new Map(
      levels.map((level) => [normalizeLabel(level.label), String(level._id)]),
    );

    const rows = readExcelRows(fileBuffer);
    const report: ImportPaidStudentsReport = {
      created: 0,
      paid: 0,
      skipped: 0,
      unknownClass: 0,
      missingFields: 0,
      invalidDate: 0,
      creationFailed: 0,
    };

    for (const row of rows) {
      const classeRaw = pickRowValue(row, ['classe', 'niveau']);
      const levelId = classeRaw
        ? levelIdByLabel.get(normalizeLabel(classeRaw))
        : undefined;
      if (!classeRaw || !levelId) {
        report.skipped += 1;
        report.unknownClass += 1;
        continue;
      }

      const rawBirthDate = pickRowValue(row, ['birthdate', 'date_naissance']);
      const parsedBirthDate = rawBirthDate
        ? parseExcelDate(rawBirthDate)
        : null;
      if (rawBirthDate && !parsedBirthDate) {
        report.skipped += 1;
        report.invalidDate += 1;
        continue;
      }

      const guardians: CreateStudentDto['guardians'] = [];
      const pereFullname = pickRowValue(row, [
        'nom_pere',
        'pere',
        'nom_complet_pere',
      ]);
      if (pereFullname) {
        guardians.push({
          type: GuardianType.FATHER,
          fullname: pereFullname,
          phone: pickRowValue(row, [
            'contact_pere',
            'telephone_pere',
            'tel_pere',
          ]),
          address: pickRowValue(row, ['adresse_pere']),
        });
      }
      const mereFullname = pickRowValue(row, [
        'nom_mere',
        'mere',
        'nom_complet_mere',
      ]);
      if (mereFullname) {
        guardians.push({
          type: GuardianType.MOTHER,
          fullname: mereFullname,
          phone: pickRowValue(row, [
            'contact_mere',
            'telephone_mere',
            'tel_mere',
          ]),
          address: pickRowValue(row, ['adresse_mere']),
        });
      }

      const montantPayeRaw = pickRowValue(row, [
        'montant_paye',
        'montant',
        'paymentamount',
      ]);
      const paymentAmount = montantPayeRaw ? Number(montantPayeRaw) : 0;
      const modePaiementRaw = pickRowValue(row, [
        'mode_paiement',
        'paymentmethod',
      ])?.toLowerCase();
      const paymentMethod = (Object.values(PaymentMethod) as string[]).includes(
        modePaiementRaw ?? '',
      )
        ? (modePaiementRaw as PaymentMethod)
        : PaymentMethod.CASH;

      const dto: CreateStudentDto = {
        matricule: pickRowValue(row, ['matricule', 'code_eleve']),
        lastname: pickRowValue(row, ['lastname', 'nom']),
        firstname: pickRowValue(row, ['firstname', 'prenoms', 'prenom']),
        gender: (pickRowValue(row, ['gender', 'sexe']) || '')
          .toString()
          .trim()
          .toUpperCase(),
        birthDate: parsedBirthDate ?? '',
        birthPlace: pickRowValue(row, ['birthplace', 'lieu_naissance']),
        district: pickRowValue(row, ['district', 'quartier']),
        guardians: guardians.length ? guardians : undefined,
        levelId,
      };

      if (
        !dto.lastname ||
        !dto.firstname ||
        !dto.gender ||
        !['M', 'F'].includes(dto.gender) ||
        !dto.birthDate ||
        !dto.birthPlace ||
        !dto.district
      ) {
        report.skipped += 1;
        report.missingFields += 1;
        continue;
      }

      try {
        const student = await this.studentsService.create(dto);
        report.created += 1;

        const result = await this.createEnrollment(
          {
            studentId: String(student._id),
            schoolYearId,
            levelId,
            type: EnrollmentType.INITIAL,
          },
          actorId,
        );

        if (paymentAmount > 0) {
          await this.paymentsService.createPayment(
            {
              invoiceId: result.invoiceId,
              amount: paymentAmount,
              method: paymentMethod,
              reference: pickRowValue(row, ['reference', 'ref']),
            },
            actorId,
          );
          report.paid += 1;
        }
      } catch {
        report.skipped += 1;
        report.creationFailed += 1;
      }
    }

    return report;
  }
}
