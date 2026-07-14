import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Arrear } from '../arrears/schemas/arrear.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Student } from '../students/schemas/student.schema';
import { Expense } from '../expenses/schemas/expense.schema';

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
    const availableBalance = tuitionRevenue - totalExpenses;
    const recoveryRate =
      tuitionExpected === 0
        ? 0
        : Math.round((tuitionRevenue / tuitionExpected) * 100);

    return {
      revenue,
      registrationRevenue,
      tuitionRevenue,
      tuitionExpected,
      totalBalance,
      totalExpenses,
      availableBalance,
      recoveryRate,
    };
  }

  async getSummary() {
    const [
      totalStudents,
      activeStudents,
      archivedStudents,
      invoices,
      arrearsOpen,
      expenses,
    ] = await Promise.all([
      this.studentModel.countDocuments(),
      this.studentModel.countDocuments({ status: 'active' }),
      this.studentModel.countDocuments({ status: 'archived' }),
      this.invoiceModel.find().lean().exec(),
      this.arrearModel.countDocuments({
        status: { $in: ['open', 'partially_paid'] },
      }),
      this.expenseModel.find().lean().exec(),
    ]);

    const financialSummary = this.calculateFinancialSummary(invoices, expenses);

    return {
      totalStudents,
      ...financialSummary,
      activeStudents,
      archivedStudents,
      arrearsOpen,
      enrollmentsActive: await this.enrollmentModel.countDocuments({
        status: 'active',
      }),
    };
  }
}
