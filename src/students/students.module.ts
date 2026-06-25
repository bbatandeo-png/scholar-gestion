import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { BillingModule } from '../billing/billing.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { LevelsModule } from '../levels/levels.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { Student, StudentSchema } from './schemas/student.schema';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: Student.name, schema: StudentSchema }]),
		GuardiansModule,
		BillingModule,
		PaymentsModule,
		SettingsModule,
		SchoolYearsModule,
		LevelsModule,
		forwardRef(() => EnrollmentsModule),
	],
	controllers: [StudentsController],
	providers: [StudentsService],
	exports: [StudentsService, MongooseModule],
})
export class StudentsModule {}