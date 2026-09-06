import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { EcolesModule } from '../ecoles/ecoles.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { LevelsModule } from '../levels/levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { StudentsModule } from '../students/students.module';
import { BulletinsController } from './bulletins.controller';
import { BulletinsService } from './bulletins.service';
import { SubjectsController } from './subjects.controller';
import {
  BulletinImportRow,
  BulletinImportRowSchema,
} from './schemas/bulletin-import-row.schema';
import {
  BulletinResult,
  BulletinResultSchema,
} from './schemas/bulletin-result.schema';
import {
  BulletinSession,
  BulletinSessionSchema,
} from './schemas/bulletin-session.schema';
import {
  ClassSubject,
  ClassSubjectSchema,
} from './schemas/class-subject.schema';
import { Note, NoteSchema } from './schemas/note.schema';
import { Subject, SubjectSchema } from './schemas/subject.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subject.name, schema: SubjectSchema },
      { name: ClassSubject.name, schema: ClassSubjectSchema },
      { name: BulletinSession.name, schema: BulletinSessionSchema },
      { name: BulletinImportRow.name, schema: BulletinImportRowSchema },
      { name: Note.name, schema: NoteSchema },
      { name: BulletinResult.name, schema: BulletinResultSchema },
    ]),
    LevelsModule,
    EnrollmentsModule,
    SchoolYearsModule,
    AuditModule,
    EcoleModulesModule,
    EcolesModule,
    StudentsModule,
  ],
  // SubjectsController (the more specific /bulletins/matieres routes) must
  // be registered before BulletinsController: Nest/Express match routes in
  // registration order, and BulletinsController's GET /bulletins/:id would
  // otherwise catch "matieres" as an :id value first.
  controllers: [SubjectsController, BulletinsController],
  providers: [BulletinsService],
  exports: [BulletinsService, MongooseModule],
})
export class BulletinsModule {}
