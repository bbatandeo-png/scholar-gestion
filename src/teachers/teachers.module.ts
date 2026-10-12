import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { BulletinsModule } from '../bulletins/bulletins.module';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { LevelsModule } from '../levels/levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { Teacher, TeacherSchema } from './schemas/teacher.schema';
import {
  TeacherAssignment,
  TeacherAssignmentSchema,
} from './schemas/teacher-assignment.schema';
import {
  TeacherContract,
  TeacherContractSchema,
} from './schemas/teacher-contract.schema';
import {
  TeacherDocumentFile,
  TeacherDocumentFileSchema,
} from './schemas/teacher-document.schema';
import {
  TeacherTrackingRecord,
  TeacherTrackingRecordSchema,
} from './schemas/teacher-tracking-record.schema';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Teacher.name, schema: TeacherSchema },
      { name: TeacherAssignment.name, schema: TeacherAssignmentSchema },
      { name: TeacherContract.name, schema: TeacherContractSchema },
      { name: TeacherDocumentFile.name, schema: TeacherDocumentFileSchema },
      {
        name: TeacherTrackingRecord.name,
        schema: TeacherTrackingRecordSchema,
      },
    ]),
    AuditModule,
    EcoleModulesModule,
    LevelsModule,
    SchoolYearsModule,
    BulletinsModule,
  ],
  controllers: [TeachersController],
  providers: [TeachersService],
  exports: [TeachersService, MongooseModule],
})
export class TeachersModule {}
