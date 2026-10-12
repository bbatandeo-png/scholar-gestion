import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { BillingModule } from '../billing/billing.module';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { LevelsModule } from '../levels/levels.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import {
  DisciplineRecord,
  DisciplineRecordSchema,
} from '../discipline/schemas/discipline-record.schema';
import { Student, StudentSchema } from './schemas/student.schema';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Student.name, schema: StudentSchema },
      // Registered here too (alongside DisciplineModule) purely so the
      // student fiche can show the "Discipline" panel without importing the
      // whole DisciplineModule back into StudentsModule, which already
      // imports this one - see DisciplineModule's own comment.
      { name: DisciplineRecord.name, schema: DisciplineRecordSchema },
    ]),
    GuardiansModule,
    BillingModule,
    PaymentsModule,
    SettingsModule,
    SchoolYearsModule,
    LevelsModule,
    EcoleModulesModule,
    forwardRef(() => EnrollmentsModule),
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService, MongooseModule],
})
export class StudentsModule {}
