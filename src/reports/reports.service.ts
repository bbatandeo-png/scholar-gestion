import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
  ) {}

  async studentsByLevel() {
    return this.enrollmentModel.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$levelId', total: { $sum: 1 } } },
    ]);
  }

  async paidStudents() {
    return this.invoiceModel
      .find({ status: 'paid' })
      .populate({ path: 'enrollmentId', populate: [{ path: 'studentId' }, { path: 'schoolYearId' }, { path: 'levelId' }] })
      .lean()
      .exec();
  }

  async unpaidStudents() {
    return this.invoiceModel
      .find({ status: { $in: ['unpaid', 'partial'] } })
      .populate({ path: 'enrollmentId', populate: [{ path: 'studentId' }, { path: 'schoolYearId' }, { path: 'levelId' }] })
      .lean()
      .exec();
  }

  async revenue() {
    const [aggregated] = await this.invoiceModel.aggregate([
      {
        $group: {
          _id: null,
          collected: { $sum: '$paidAmount' },
          outstanding: { $sum: '$balanceDue' },
          totalDue: { $sum: '$totalDue' },
        },
      },
    ]);

    return {
      collected: aggregated?.collected ?? 0,
      outstanding: aggregated?.outstanding ?? 0,
      totalDue: aggregated?.totalDue ?? 0,
    };
  }
}