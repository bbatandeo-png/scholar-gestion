import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { ArrearStatus } from '../common/enums/domain.enums';
import { Arrear, ArrearDocument } from './schemas/arrear.schema';
import {
  ArrearCarryForward,
  ArrearCarryForwardDocument,
} from './schemas/arrear-carry-forward.schema';

@Injectable()
export class ArrearsService {
  constructor(
    @InjectModel(Arrear.name)
    private readonly arrearModel: Model<ArrearDocument>,
    @InjectModel(ArrearCarryForward.name)
    private readonly carryForwardModel: Model<ArrearCarryForwardDocument>,
  ) {}

  async list(schoolYearId: string) {
    const carriedIds = await this.carryForwardModel
      .find({ targetSchoolYearId: schoolYearId })
      .distinct('arrearId')
      .exec();
    return this.arrearModel
      .find({
        $or: [
          { sourceSchoolYearId: schoolYearId },
          { _id: { $in: carriedIds } },
        ],
      })
      .populate({ path: 'studentId', select: 'matricule lastname firstname' })
      .populate({ path: 'sourceEnrollmentId', select: 'schoolYearId levelId' })
      .populate({ path: 'targetEnrollmentId', select: 'schoolYearId levelId' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async listPaginated(schoolYearId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const carriedIds = await this.carryForwardModel
      .find({ targetSchoolYearId: schoolYearId })
      .distinct('arrearId')
      .exec();
    const criteria = {
      $or: [{ sourceSchoolYearId: schoolYearId }, { _id: { $in: carriedIds } }],
    };
    const [items, total] = await Promise.all([
      this.arrearModel
        .find(criteria)
        .populate({ path: 'studentId', select: 'matricule lastname firstname' })
        .populate({
          path: 'sourceEnrollmentId',
          select: 'schoolYearId levelId',
        })
        .populate({
          path: 'targetEnrollmentId',
          select: 'schoolYearId levelId',
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
      this.arrearModel.countDocuments(criteria),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findOpenByStudent(
    studentId: string,
    beforeSchoolYearId?: string,
    session?: ClientSession,
  ) {
    const criteria: Record<string, any> = {
      studentId,
      status: { $in: [ArrearStatus.OPEN, ArrearStatus.PARTIALLY_PAID] },
      amountRemaining: { $gt: 0 },
    };
    if (beforeSchoolYearId) {
      criteria.sourceSchoolYearId = { $ne: beforeSchoolYearId };
    }
    return this.arrearModel
      .find(criteria)
      .session(session ?? null)
      .lean()
      .exec();
  }

  async findByTargetEnrollment(enrollmentId: string, session?: ClientSession) {
    return this.arrearModel
      .find({
        targetEnrollmentId: enrollmentId,
        status: { $in: [ArrearStatus.OPEN, ArrearStatus.PARTIALLY_PAID] },
        amountRemaining: { $gt: 0 },
      })
      .session(session ?? null)
      .lean()
      .exec();
  }

  async createFromOutstanding(
    payload: {
      studentId: string;
      sourceEnrollmentId: string;
      sourceSchoolYearId: string;
      amount: number;
    },
    session?: ClientSession,
  ) {
    if (payload.amount <= 0) {
      return null;
    }

    const existing = await this.arrearModel
      .findOne({
        sourceEnrollmentId: payload.sourceEnrollmentId,
        status: { $in: [ArrearStatus.OPEN, ArrearStatus.PARTIALLY_PAID] },
      })
      .session(session ?? null)
      .exec();
    if (existing) {
      return existing;
    }

    const created = await this.arrearModel.create(
      [
        {
          studentId: payload.studentId,
          sourceEnrollmentId: payload.sourceEnrollmentId,
          sourceSchoolYearId: payload.sourceSchoolYearId,
          amountInitial: payload.amount,
          amountRemaining: payload.amount,
          status: ArrearStatus.OPEN,
        },
      ],
      { session },
    );
    return created[0];
  }

  async carryForwardToEnrollment(
    studentId: string,
    targetEnrollmentId: string,
    targetSchoolYearId: string,
    session?: ClientSession,
  ) {
    const arrears = await this.findOpenByStudent(
      studentId,
      targetSchoolYearId,
      session,
    );
    let carriedAmount = 0;
    const linkedIds: string[] = [];

    for (const arrear of arrears) {
      const carry = await this.carryForwardModel.findOneAndUpdate(
        { arrearId: arrear._id, targetEnrollmentId },
        {
          $setOnInsert: {
            arrearId: arrear._id,
            sourceSchoolYearId: arrear.sourceSchoolYearId,
            targetSchoolYearId,
            targetEnrollmentId,
            amountCarried: arrear.amountRemaining,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, session },
      );
      await this.arrearModel.updateOne(
        { _id: arrear._id },
        { $set: { targetEnrollmentId, targetSchoolYearId } },
        { session },
      );
      carriedAmount += carry.amountCarried;
      linkedIds.push(String(arrear._id));
    }

    return { carriedAmount, linkedIds };
  }

  async applyPaymentAllocations(
    arrearIds: string[],
    amount: number,
    session?: ClientSession,
  ) {
    let remaining = amount;
    const allocations: Array<{ arrearId: string; amount: number }> = [];

    const arrears = await this.arrearModel
      .find({ _id: { $in: arrearIds } })
      .session(session ?? null)
      .exec();
    for (const arrear of arrears) {
      if (remaining <= 0) {
        break;
      }

      const applied = Math.min(arrear.amountRemaining, remaining);
      arrear.amountRemaining -= applied;
      arrear.status =
        arrear.amountRemaining === 0
          ? ArrearStatus.PAID
          : ArrearStatus.PARTIALLY_PAID;
      await arrear.save({ session });
      allocations.push({ arrearId: String(arrear._id), amount: applied });
      remaining -= applied;
    }

    return { allocations, remaining };
  }
}
