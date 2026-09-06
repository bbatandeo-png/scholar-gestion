import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { StudentStatus } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type StudentDocument = HydratedDocument<Student>;

@Schema({ timestamps: true, collection: 'students' })
export class Student {
  @Prop({ required: true, trim: true })
  matricule: string;

  @Prop({ required: true, trim: true, index: true })
  lastname: string;

  @Prop({ required: true, trim: true, index: true })
  firstname: string;

  @Prop({ required: true, trim: true, uppercase: true, enum: ['M', 'F'] })
  gender: string;

  // Optional: a student auto-created from a bulletins-only import (see
  // BulletinsService.createStudentAndEnrollmentForRow) has none of these -
  // the source Excel file only ever carries name/matricule/sexe.
  @Prop()
  birthDate?: Date;

  @Prop({ trim: true })
  birthPlace?: string;

  @Prop({ trim: true })
  district?: string;

  // Relative path under the uploads root (see uploaded-image.util) - never
  // a raw URL, so it works fully offline like the ecole logo.
  @Prop({ trim: true })
  photo?: string;

  @Prop({
    required: true,
    enum: Object.values(StudentStatus),
    default: StudentStatus.ACTIVE,
  })
  status: StudentStatus;
}

export const StudentSchema = SchemaFactory.createForClass(Student);
StudentSchema.plugin(ecoleScopePlugin);
StudentSchema.index({ ecoleId: 1, matricule: 1 }, { unique: true });
StudentSchema.index({ lastname: 1, firstname: 1, birthDate: 1 });
