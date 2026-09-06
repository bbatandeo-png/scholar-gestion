import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { Periode } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type BulletinResultDocument = HydratedDocument<BulletinResult>;

// One document per student/periode/schoolYear - the durable, authoritative
// summary of a validated bulletin (everything on the printed document that
// isn't a single subject's grade - see Note for those). Written once at
// BulletinsService.validateSession() and never recomputed afterward, even
// if class-subject coefficients or a later period's data change - mirrors
// the same "snapshot at validation, historize, never retroactively alter an
// already-issued bulletin" rule already applied to Note.
@Schema({ timestamps: true, collection: 'bulletin_results' })
export class BulletinResult {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Student',
    required: true,
    index: true,
  })
  studentId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Enrollment', required: true })
  enrollmentId: string;

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

  // Derived from Enrollment.type at validation time (REPEAT -> 'R', else
  // 'N') and snapshotted here rather than read live from Enrollment on
  // every render - an enrollment's type is mutable after the fact (see
  // EnrollmentsController.update), and an already-issued bulletin must
  // never silently change.
  @Prop({ required: true, enum: ['N', 'R'] })
  statutNR: 'N' | 'R';

  @Prop({ type: Number, default: null })
  moyenneLitteraire: number | null;

  @Prop({ type: String, default: null })
  rangLitteraire: string | null;

  @Prop({ type: Number, default: null })
  moyenneScientifique: number | null;

  @Prop({ type: String, default: null })
  rangScientifique: string | null;

  @Prop({ type: Number, default: null })
  moyenneAutres: number | null;

  @Prop({ type: String, default: null })
  rangAutres: string | null;

  @Prop({ required: true })
  totalPoints: number;

  @Prop({ required: true })
  totalCoef: number;

  @Prop({ required: true })
  moyenneGenerale: number;

  @Prop({ required: true })
  rangGeneral: string;

  @Prop({ required: true, trim: true })
  appreciationGenerale: string;

  // Null when this is the student's first validated period of the school
  // year (nothing to cumulate yet).
  @Prop({ type: Number, default: null })
  moyenneAnnuelle: number | null;

  @Prop({ type: String, default: null })
  rangAnnuel: string | null;

  // Entered manually (see BulletinsService.saveDiscipline), not derived from
  // imported data - the source Excel file never carries this information.
  @Prop({ type: Number, default: null })
  retards: number | null;

  @Prop({ type: Number, default: null })
  absences: number | null;

  @Prop({ trim: true })
  exclusion?: string;

  @Prop({ trim: true })
  decisionConseil?: string;
}

export const BulletinResultSchema =
  SchemaFactory.createForClass(BulletinResult);
BulletinResultSchema.plugin(ecoleScopePlugin);
BulletinResultSchema.index(
  { ecoleId: 1, studentId: 1, periode: 1, schoolYearId: 1 },
  { unique: true },
);
