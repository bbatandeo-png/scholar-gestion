import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { InvoiceStatus } from '../common/enums/domain.enums';
import { FeeSchedule, FeeScheduleDocument } from './schemas/fee-schedule.schema';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { UpsertFeeScheduleDto } from './dto/upsert-fee-schedule.dto';

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(FeeSchedule.name)
    private readonly feeScheduleModel: Model<FeeScheduleDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
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

  async listFeeSchedules() {
    return this.feeScheduleModel
      .find()
      .populate('schoolYearId')
      .populate('levelId')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getFeeSchedule(schoolYearId: string, levelId: string) {
    const schedule = await this.feeScheduleModel.findOne({ schoolYearId, levelId }).lean().exec();
    if (!schedule) {
      throw new NotFoundException('Parametrage des frais introuvable');
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
      throw new NotFoundException('Parametrage des frais introuvable');
    }

    return schedule;
  }

  async updateFeeSchedule(id: string, dto: Partial<UpsertFeeScheduleDto>) {
    return this.feeScheduleModel
      .findByIdAndUpdate(id, dto, { new: true })
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
    const totalDue = payload.registrationFee + payload.tuitionFee - discountAmount + arrearsAmount;
    const balanceDue = Math.max(totalDue - paidAmount, 0);
    const status =
      balanceDue === 0 ? InvoiceStatus.PAID : paidAmount > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID;

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
      { enrollmentId: payload.enrollmentId, ...invoiceData },
      { upsert: true, new: true, setDefaultsOnInsert: true, session },
    );
  }

  async findInvoiceByEnrollment(enrollmentId: string) {
    return this.invoiceModel.findOne({ enrollmentId }).lean().exec();
  }

  async findInvoiceByEnrollmentForSession(enrollmentId: string, session?: ClientSession) {
    return this.invoiceModel.findOne({ enrollmentId }).session(session ?? null).exec();
  }

  async findInvoiceById(id: string) {
    return this.invoiceModel.findById(id).lean().exec();
  }
}