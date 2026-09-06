import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Arrear } from '../arrears/schemas/arrear.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Student } from '../students/schemas/student.schema';
import { Expense } from '../expenses/schemas/expense.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { ArrearCarryForward } from '../arrears/schemas/arrear-carry-forward.schema';

type DashboardInvoiceAmounts = {
  paidAmount?: number;
  balanceDue?: number;
  registrationFee?: number;
  tuitionFee?: number;
  discountAmount?: number;
};

type DashboardExpenseAmount = {
  amount?: number;
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Arrear.name) private readonly arrearModel: Model<Arrear>,
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(ArrearCarryForward.name)
    private readonly carryForwardModel: Model<ArrearCarryForward>,
  ) {}

  calculateFinancialSummary(
    invoices: DashboardInvoiceAmounts[],
    expenses: DashboardExpenseAmount[],
  ) {
    const revenue = invoices.reduce(
      (sum, invoice) => sum + Math.max(Number(invoice.paidAmount ?? 0), 0),
      0,
    );
    const totalBalance = invoices.reduce(
      (sum, invoice) => sum + Math.max(Number(invoice.balanceDue ?? 0), 0),
      0,
    );
    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + Math.max(Number(expense.amount ?? 0), 0),
      0,
    );
    const registrationRevenue = invoices.reduce(
      (sum, invoice) =>
        sum +
        Math.min(
          Math.max(Number(invoice.paidAmount ?? 0), 0),
          Math.max(Number(invoice.registrationFee ?? 0), 0),
        ),
      0,
    );
    const tuitionExpected = invoices.reduce((sum, invoice) => {
      const tuitionFee = Math.max(Number(invoice.tuitionFee ?? 0), 0);
      const discountAmount = Math.max(Number(invoice.discountAmount ?? 0), 0);
      return sum + Math.max(tuitionFee - discountAmount, 0);
    }, 0);
    const tuitionRevenue = invoices.reduce((sum, invoice) => {
      const paidAmount = Math.max(Number(invoice.paidAmount ?? 0), 0);
      const registrationFee = Math.max(Number(invoice.registrationFee ?? 0), 0);
      const tuitionFee = Math.max(Number(invoice.tuitionFee ?? 0), 0);
      const discountAmount = Math.max(Number(invoice.discountAmount ?? 0), 0);
      const netTuitionFee = Math.max(tuitionFee - discountAmount, 0);
      return (
        sum + Math.min(Math.max(paidAmount - registrationFee, 0), netTuitionFee)
      );
    }, 0);

    return {
      revenue,
      registrationRevenue,
      tuitionRevenue,
      tuitionExpected,
      totalBalance,
      totalExpenses,
      availableBalance: tuitionRevenue - totalExpenses,
      recoveryRate:
        tuitionExpected === 0
          ? 0
          : Math.round((tuitionRevenue / tuitionExpected) * 100),
    };
  }

  async getSummary(schoolYearId: string) {
    const carriedArrearIds = await this.carryForwardModel
      .find({ targetSchoolYearId: schoolYearId })
      .distinct('arrearId')
      .exec();
    const [
      studentIds,
      activeStudents,
      archivedStudents,
      invoices,
      arrearsOpen,
      expenses,
      payments,
    ] = await Promise.all([
      this.enrollmentModel.distinct('studentId', { schoolYearId }).exec(),
      this.enrollmentModel.countDocuments({ schoolYearId, status: 'active' }),
      // Promotion decisions (archived/transferred/left) are recorded on the
      // SOURCE enrollment, in the year the student left from - not on any
      // enrollment in the currently selected year, so filtering enrollments
      // by {schoolYearId, finalDecision} here could never match anything.
      // Student.status is the durable, non-year-scoped signal for this
      // (set correctly by PromotionsService.validate()) - matches the
      // "Eleves archives" label exactly, unlike transferred/left.
      this.studentModel.countDocuments({ status: 'archived' }),
      this.invoiceModel.find({ schoolYearId }).lean().exec(),
      this.arrearModel.countDocuments({
        $or: [
          { sourceSchoolYearId: schoolYearId },
          { _id: { $in: carriedArrearIds } },
        ],
        status: { $in: ['open', 'partially_paid'] },
      }),
      this.expenseModel
        .find({ schoolYearId, isCancelled: { $ne: true } })
        .lean()
        .exec(),
      this.paymentModel.find({ schoolYearId }).lean().exec(),
    ]);

    const totalStudents = studentIds.length;
    const revenue = payments.reduce(
      (sum, payment: any) => sum + (payment.amount ?? 0),
      0,
    );
    const totalDue = invoices.reduce(
      (sum, invoice: any) => sum + (invoice.totalDue ?? 0),
      0,
    );
    const totalBalance = invoices.reduce(
      (sum, invoice: any) => sum + (invoice.balanceDue ?? 0),
      0,
    );
    const totalExpenses = expenses.reduce(
      (sum, expense: any) => sum + (expense.amount ?? 0),
      0,
    );
    const currentPaidByInvoice = new Map<string, number>();
    for (const payment of payments as any[]) {
      const currentAmount = (payment.allocation ?? [])
        .filter((item: any) => item.type === 'current_fees')
        .reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0);
      const key = String(payment.invoiceId);
      currentPaidByInvoice.set(
        key,
        (currentPaidByInvoice.get(key) ?? 0) + currentAmount,
      );
    }
    const registrationRevenue = invoices.reduce((sum, invoice: any) => {
      const currentPaid = currentPaidByInvoice.get(String(invoice._id)) ?? 0;
      return sum + Math.min(currentPaid, invoice.registrationFee ?? 0);
    }, 0);
    const tuitionRevenue = invoices.reduce((sum, invoice: any) => {
      const paidAmount = currentPaidByInvoice.get(String(invoice._id)) ?? 0;
      const registrationFee = invoice.registrationFee ?? 0;
      return (
        sum +
        Math.max(
          Math.min(paidAmount - registrationFee, invoice.tuitionFee ?? 0),
          0,
        )
      );
    }, 0);
    const availableBalance = tuitionRevenue - totalExpenses;
    const recoveryRate =
      totalDue === 0 ? 0 : Math.round((revenue / totalDue) * 100);

    return {
      totalStudents,
      revenue,
      registrationRevenue,
      tuitionRevenue,
      totalBalance,
      totalExpenses,
      availableBalance,
      recoveryRate,
      activeStudents,
      archivedStudents,
      arrearsOpen,
      enrollmentsActive: activeStudents,
    };
  }
}
