import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { InvoiceStatus } from '../common/enums/domain.enums';
import { FeeScheduleNotFoundException } from '../common/exceptions/fee-schedule-not-found.exception';
import {
  FeeSchedule,
  FeeScheduleDocument,
} from './schemas/fee-schedule.schema';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { computeLedgerDivergences } from './ledger.util';
import { toDisplayString } from '../common/utils/safe-string.util';
import { UpsertFeeScheduleDto } from './dto/upsert-fee-schedule.dto';
import {
  PopulatedLevelLean,
  PopulatedSchoolYearLean,
} from '../common/types/populated-refs.types';

export interface PopulatedFeeScheduleLean {
  _id?: unknown;
  registrationFee?: number;
  tuitionFee?: number;
  schoolYearId?: PopulatedSchoolYearLean | null;
  levelId?: PopulatedLevelLean | null;
}

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(FeeSchedule.name)
    private readonly feeScheduleModel: Model<FeeScheduleDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
  ) {}

  async upsertFeeSchedule(dto: UpsertFeeScheduleDto) {
    return this.feeScheduleModel
      .findOneAndUpdate(
        { schoolYearId: dto.schoolYearId, levelId: dto.levelId },
        dto,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
  }

  async listFeeSchedules(
    schoolYearId?: string,
  ): Promise<PopulatedFeeScheduleLean[]> {
    return this.feeScheduleModel
      .find(schoolYearId ? { schoolYearId } : {})
      .populate('schoolYearId')
      .populate('levelId')
      .sort({ createdAt: -1 })
      .lean()
      .exec() as unknown as Promise<PopulatedFeeScheduleLean[]>;
  }

  async getFeeSchedule(
    schoolYearId: string,
    levelId: string,
    session?: ClientSession,
  ) {
    const schedule = await this.feeScheduleModel
      .findOne({ schoolYearId, levelId })
      .session(session ?? null)
      .lean()
      .exec();
    if (!schedule) {
      throw new FeeScheduleNotFoundException();
    }

    return schedule;
  }

  async findFeeScheduleById(id: string) {
    const schedule = await this.feeScheduleModel
      .findById(id)
      .populate('schoolYearId')
      .populate('levelId')
      .lean()
      .exec();
    if (!schedule) {
      throw new FeeScheduleNotFoundException();
    }

    return schedule;
  }

  async updateFeeSchedule(id: string, dto: Partial<UpsertFeeScheduleDto>) {
    const { schoolYearId, ...changes } = dto;
    return this.feeScheduleModel
      .findOneAndUpdate(
        { _id: id, ...(schoolYearId ? { schoolYearId } : {}) },
        changes,
        { new: true },
      )
      .populate('schoolYearId')
      .populate('levelId')
      .lean()
      .exec();
  }

  calculateInvoiceAmounts(payload: {
    registrationFee: number;
    tuitionFee: number;
    discountAmount?: number;
    arrearsAmount?: number;
    paidAmount?: number;
  }) {
    const discountAmount = payload.discountAmount ?? 0;
    const arrearsAmount = payload.arrearsAmount ?? 0;
    const paidAmount = payload.paidAmount ?? 0;
    const totalDue =
      payload.registrationFee +
      payload.tuitionFee -
      discountAmount +
      arrearsAmount;
    const balanceDue = Math.max(totalDue - paidAmount, 0);
    const status =
      balanceDue === 0
        ? InvoiceStatus.PAID
        : paidAmount > 0
          ? InvoiceStatus.PARTIAL
          : InvoiceStatus.UNPAID;

    return {
      registrationFee: payload.registrationFee,
      tuitionFee: payload.tuitionFee,
      discountAmount,
      arrearsAmount,
      totalDue,
      paidAmount,
      balanceDue,
      status,
    };
  }

  async createOrUpdateInvoice(
    payload: {
      schoolYearId: string;
      enrollmentId: string;
      registrationFee: number;
      tuitionFee: number;
      discountAmount?: number;
      arrearsAmount?: number;
      paidAmount?: number;
    },
    session?: ClientSession,
  ) {
    const invoiceData = this.calculateInvoiceAmounts(payload);
    return this.invoiceModel.findOneAndUpdate(
      { enrollmentId: payload.enrollmentId },
      {
        schoolYearId: payload.schoolYearId,
        enrollmentId: payload.enrollmentId,
        ...invoiceData,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, session },
    );
  }

  private generateCorrectionNumber() {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `CO-${stamp}-${random}`;
  }

  // Writes the signed ledger entry that keeps the payment ledger equal to an
  // invoice's paidAmount after that amount was changed by hand. The entry is
  // a normal Payment document (kind 'correction') so every ledger-based
  // total - dashboard, revenue report, the "already paid" check in
  // PaymentsService.createPayment - picks it up with no special casing.
  // Splits a correction's delta across the ledger's existing allocation
  // buckets ('current_fees' first, spilling into 'arrear') instead of always
  // tagging it 'current_fees'. Without this, reducing the paid amount on an
  // invoice that also has an arrear payment could drive the 'current_fees'
  // total negative - an impossible value that then silently corrupted
  // registrationRevenue/tuitionRevenue on the dashboard (they use
  // Math.min/Math.max against that total, which happily returns a negative
  // number instead of clamping). A positive delta (paid amount raised) still
  // goes to 'current_fees' - the reverse case (which bucket newly-added
  // money belongs to) needs the school's allocation rule, not just the
  // ledger's past composition, and simply adding is never negative/wrong,
  // only occasionally over-attributed.
  private splitCorrectionAllocation(
    delta: number,
    existingByType: { currentFees: number; arrear: number },
  ): Array<{ type: string; amount: number }> {
    if (delta >= 0) {
      return [{ type: 'current_fees', amount: delta }];
    }
    const allocation: Array<{ type: string; amount: number }> = [];
    let remaining = delta;

    const reduceCurrentFees = Math.max(remaining, -existingByType.currentFees);
    if (reduceCurrentFees !== 0) {
      allocation.push({ type: 'current_fees', amount: reduceCurrentFees });
    }
    remaining -= reduceCurrentFees;

    if (remaining < 0) {
      const reduceArrear = Math.max(remaining, -existingByType.arrear);
      if (reduceArrear !== 0) {
        allocation.push({ type: 'arrear', amount: reduceArrear });
      }
      remaining -= reduceArrear;
    }

    // Ledger has less recorded in these two buckets than the correction
    // needs to remove (should not normally happen) - keep the ledger total
    // exactly equal to invoice.paidAmount rather than silently dropping it.
    if (remaining !== 0) {
      allocation.push({ type: 'current_fees', amount: remaining });
    }
    return allocation;
  }

  async recordPaymentCorrection(
    payload: {
      invoiceId: string;
      schoolYearId: string;
      delta: number;
      reason: string;
      actorId?: string;
    },
    session?: ClientSession,
  ) {
    const existingPayments = await this.paymentModel
      .find({ invoiceId: payload.invoiceId })
      .session(session ?? null)
      .lean()
      .exec();
    const existingByType = { currentFees: 0, arrear: 0 };
    for (const payment of existingPayments) {
      for (const item of payment.allocation ?? []) {
        const amount = Number((item as { amount?: number }).amount ?? 0);
        if (item.type === 'current_fees') existingByType.currentFees += amount;
        else if (item.type === 'arrear') existingByType.arrear += amount;
      }
    }

    const created = await this.paymentModel.create(
      [
        {
          schoolYearId: payload.schoolYearId,
          invoiceId: payload.invoiceId,
          amount: payload.delta,
          kind: 'correction',
          method: 'other',
          reference: payload.reason,
          receiptNumber: this.generateCorrectionNumber(),
          allocation: this.splitCorrectionAllocation(
            payload.delta,
            existingByType,
          ),
          createdBy: payload.actorId,
          paidAt: new Date(),
        },
      ],
      { session },
    );
    return created[0];
  }

  // Invoices whose paidAmount no longer equals what the payment ledger says,
  // with the student/level to identify each one on screen.
  async listLedgerDivergences(schoolYearId: string) {
    const [invoices, payments] = await Promise.all([
      this.invoiceModel
        .find({ schoolYearId })
        .populate({
          path: 'enrollmentId',
          select: 'studentSnapshot levelSnapshot studentId levelId',
          populate: [
            { path: 'studentId', select: 'matricule lastname firstname' },
            { path: 'levelId', select: 'label' },
          ],
        })
        .lean()
        .exec(),
      this.paymentModel
        .find({ schoolYearId })
        .select('invoiceId amount')
        .lean()
        .exec(),
    ]);

    type NamedStudent = {
      matricule?: string;
      lastname?: string;
      firstname?: string;
    };
    type InvoiceWithEnrollment = {
      enrollmentId?: {
        _id?: unknown;
        studentSnapshot?: NamedStudent;
        levelSnapshot?: { label?: string };
        studentId?: NamedStudent;
        levelId?: { label?: string };
      };
    };
    const invoiceById = new Map(
      invoices.map((invoice) => [String(invoice._id), invoice]),
    );
    return computeLedgerDivergences(invoices, payments).map((row) => {
      const enrollment = (
        invoiceById.get(row.invoiceId) as InvoiceWithEnrollment | undefined
      )?.enrollmentId;
      const student = enrollment?.studentSnapshot ?? enrollment?.studentId;
      const level = enrollment?.levelSnapshot ?? enrollment?.levelId;
      return {
        ...row,
        enrollmentId: enrollment?._id ? toDisplayString(enrollment._id) : '',
        studentName:
          `${student?.lastname ?? ''} ${student?.firstname ?? ''}`.trim(),
        matricule: student?.matricule ?? '',
        levelLabel: level?.label ?? '',
      };
    });
  }

  async findInvoiceByEnrollment(enrollmentId: string) {
    return this.invoiceModel.findOne({ enrollmentId }).lean().exec();
  }

  async findInvoiceByEnrollmentForSession(
    enrollmentId: string,
    session?: ClientSession,
  ) {
    return this.invoiceModel
      .findOne({ enrollmentId })
      .session(session ?? null)
      .exec();
  }

  async findInvoiceById(id: string) {
    return this.invoiceModel.findById(id).lean().exec();
  }

  async listInvoicesForSchoolYear(schoolYearId: string) {
    return this.invoiceModel.find({ schoolYearId }).lean().exec();
  }

  async copyFeeSchedules(
    sourceSchoolYearId: string,
    targetSchoolYearId: string,
    session?: ClientSession,
  ) {
    const schedules = await this.feeScheduleModel
      .find({ schoolYearId: sourceSchoolYearId })
      .session(session ?? null)
      .lean()
      .exec();
    for (const schedule of schedules) {
      await this.feeScheduleModel.updateOne(
        { schoolYearId: targetSchoolYearId, levelId: schedule.levelId },
        {
          $setOnInsert: {
            schoolYearId: targetSchoolYearId,
            levelId: schedule.levelId,
            registrationFee: schedule.registrationFee,
            tuitionFee: schedule.tuitionFee,
          },
        },
        { upsert: true, session },
      );
    }
  }
}
