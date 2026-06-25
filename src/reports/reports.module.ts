import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from '../billing/schemas/invoice.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: Enrollment.name, schema: EnrollmentSchema },
			{ name: Invoice.name, schema: InvoiceSchema },
		]),
	],
	controllers: [ReportsController],
	providers: [ReportsService],
})
export class ReportsModule {}