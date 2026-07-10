import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Arrear, ArrearSchema } from '../arrears/schemas/arrear.schema';
import { Invoice, InvoiceSchema } from '../billing/schemas/invoice.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { Expense, ExpenseSchema } from '../expenses/schemas/expense.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: Student.name, schema: StudentSchema },
			{ name: Enrollment.name, schema: EnrollmentSchema },
			{ name: Invoice.name, schema: InvoiceSchema },
			{ name: Arrear.name, schema: ArrearSchema },
			{ name: Expense.name, schema: ExpenseSchema },
		]),
	],
	controllers: [DashboardController],
	providers: [DashboardService],
})
export class DashboardModule {}