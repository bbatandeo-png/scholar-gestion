import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArrearsModule } from '../arrears/arrears.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { LevelsModule } from '../levels/levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { StudentsModule } from '../students/students.module';
import { UsersModule } from '../users/users.module';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { Enrollment, EnrollmentSchema } from './schemas/enrollment.schema';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: Enrollment.name, schema: EnrollmentSchema }]),
		BillingModule,
		ArrearsModule,
		SchoolYearsModule,
		LevelsModule,
		AuditModule,
		UsersModule,
		forwardRef(() => StudentsModule),
	],
	controllers: [EnrollmentsController],
	providers: [EnrollmentsService],
	exports: [EnrollmentsService, MongooseModule],
})
export class EnrollmentsModule {}