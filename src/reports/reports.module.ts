import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from '../billing/schemas/invoice.schema';
import {
  Enrollment,
  EnrollmentSchema,
} from '../enrollments/schemas/enrollment.schema';
import { Level, LevelSchema } from '../levels/schemas/level.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import {
  SchoolYear,
  SchoolYearSchema,
} from '../school-years/schemas/school-year.schema';
import { SettingsModule } from '../settings/settings.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Level.name, schema: LevelSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    SettingsModule,
    SchoolYearsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
