import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { Periode } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type NoteDocument = HydratedDocument<Note>;

// The durable, authoritative grade record - only written at session
// validation (see BulletinsService.validateSession). i1/i2/devoir/compo are
// nullable and must never be coerced to 0: a null note is excluded from
// averaging, a 0 counts (see bulletins-import.util.ts for the confirmed
// real-world case of a whole note column being consistently unused).
@Schema({ timestamps: true, collection: 'bulletin_notes' })
export class Note {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Student',
    required: true,
    index: true,
  })
  studentId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Enrollment', required: true })
  enrollmentId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true })
  subjectId: string;

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

  @Prop({ required: true, enum: Object.values(Periode) })
  periode: Periode;

  @Prop({ type: Number, default: null })
  i1: number | null;

  @Prop({ type: Number, default: null })
  i2: number | null;

  @Prop({ type: Number, default: null })
  devoir: number | null;

  @Prop({ type: Number, default: null })
  compo: number | null;

  // Snapshotted from ClassSubject at validation time, mirroring the
  // studentSnapshot/levelSnapshot denormalization convention already used
  // on Enrollment - so a later coefficient/teacher change never retroactively
  // alters an already-validated period's grades.
  @Prop({ required: true, min: 0 })
  coefficient: number;

  @Prop({ trim: true })
  teacherName?: string;

  // Computed at validation by bulletin-calculation.util.ts, never at import
  // time - a subject's rank/appreciation depend on every other student's
  // grade in the same subject, so they can only be known once the whole
  // class's raw notes are in. Null until then (never for an already
  // validated Note, which always has every field below populated).
  @Prop({ type: Number, default: null })
  moyenneClasse: number | null;

  @Prop({ type: Number, default: null })
  moyennePeriode: number | null;

  @Prop({ type: Number, default: null })
  moyenneDefinitive: number | null;

  @Prop({ type: String, default: null })
  rang: string | null;

  @Prop({ type: String, default: null })
  appreciation: string | null;
}

export const NoteSchema = SchemaFactory.createForClass(Note);
NoteSchema.plugin(ecoleScopePlugin);
NoteSchema.index(
  { ecoleId: 1, studentId: 1, subjectId: 1, periode: 1, schoolYearId: 1 },
  { unique: true },
);
