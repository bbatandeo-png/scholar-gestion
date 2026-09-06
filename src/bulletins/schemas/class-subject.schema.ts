import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type ClassSubjectDocument = HydratedDocument<ClassSubject>;

// Per class-year configuration of a Subject: its coefficient and assigned
// teacher for one level in one school year, reused across all periodes of
// that year. The Excel file's own Coef/Prof cells are informational only -
// this is the stable, authoritative source (see bulletins-import.util.ts).
@Schema({ timestamps: true, collection: 'class_subjects' })
export class ClassSubject {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'SchoolYear',
    required: true,
    index: true,
  })
  schoolYearId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Level',
    required: true,
    index: true,
  })
  levelId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true })
  subjectId: string;

  @Prop({ required: true, min: 0 })
  coefficient: number;

  @Prop({ trim: true })
  teacherName?: string;

  @Prop({ default: 0 })
  displayOrder: number;
}

export const ClassSubjectSchema = SchemaFactory.createForClass(ClassSubject);
ClassSubjectSchema.plugin(ecoleScopePlugin);
ClassSubjectSchema.index(
  { ecoleId: 1, schoolYearId: 1, levelId: 1, subjectId: 1 },
  { unique: true },
);
