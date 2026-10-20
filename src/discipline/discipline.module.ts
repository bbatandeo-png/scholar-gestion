import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { EcolesModule } from '../ecoles/ecoles.module';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { LevelsModule } from '../levels/levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { StudentsModule } from '../students/students.module';
import { DisciplineController } from './discipline.controller';
import { DisciplineService } from './discipline.service';
import {
  DisciplineRecord,
  DisciplineRecordSchema,
} from './schemas/discipline-record.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DisciplineRecord.name, schema: DisciplineRecordSchema },
    ]),
    AuditModule,
    EcoleModulesModule,
    EcolesModule,
    LevelsModule,
    SchoolYearsModule,
    StudentsModule,
  ],
  controllers: [DisciplineController],
  providers: [DisciplineService],
  exports: [DisciplineService],
})
export class DisciplineModule {}
