import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Arrear } from '../arrears/schemas/arrear.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Student } from '../students/schemas/student.schema';
import { Expense } from '../expenses/schemas/expense.schema';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Arrear.name) private readonly arrearModel: Model<Arrear>,
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
  ) {}

  async getSummary() {
    const [totalStudents, activeStudents, archivedStudents, invoices, arrearsOpen, expenses] = await Promise.all([
      this.studentModel.countDocuments(),
      this.studentModel.countDocuments({ status: 'active' }),
      this.studentModel.countDocuments({ status: 'archived' }),
      this.invoiceModel.find().lean().exec(),
      this.arrearModel.countDocuments({ status: { $in: ['open', 'partially_paid'] } }),
      this.expenseModel.find().lean().exec(),
    ]);

    const revenue = invoices.reduce((sum, invoice: any) => sum + invoice.paidAmount, 0);
    const totalDue = invoices.reduce((sum, invoice: any) => sum + invoice.totalDue, 0);
    const totalBalance = invoices.reduce((sum, invoice: any) => sum + invoice.balanceDue, 0);
    const totalExpenses = expenses.reduce((sum, expense: any) => sum + expense.amount, 0);
    const currentBalance = revenue - totalExpenses;
    const registrationRevenue = invoices.reduce((sum, invoice: any) => sum + (invoice.registrationFee || 0), 0);
    const tuitionRevenue = invoices.reduce((sum, invoice: any) => sum + (invoice.tuitionFee || 0), 0);
    const recoveryRate = totalDue === 0 ? 0 : Math.round((revenue / totalDue) * 100);

    return {
      totalStudents,
      revenue,
      registrationRevenue,
      tuitionRevenue,
      totalBalance,
      totalExpenses,
      currentBalance,
      recoveryRate,
      activeStudents,
      archivedStudents,
      arrearsOpen,
      enrollmentsActive: await this.enrollmentModel.countDocuments({ status: 'active' }),
    };
  }
}