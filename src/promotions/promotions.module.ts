import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArrearsModule } from '../arrears/arrears.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { LevelsModule } from '../levels/levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: Enrollment.name, schema: EnrollmentSchema },
			{ name: Student.name, schema: StudentSchema },
		]),
		BillingModule,
		ArrearsModule,
		AuditModule,
		SchoolYearsModule,
		LevelsModule,
	],
	controllers: [PromotionsController],
	providers: [PromotionsService],
})
export class PromotionsModule {}