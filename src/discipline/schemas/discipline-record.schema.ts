import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { DisciplineRecordType } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type DisciplineRecordDocument = HydratedDocument<DisciplineRecord>;

// A transversal journal entry on a student's own timeline (avertissement /
// sanction / convocation), independent of any one bulletin session - unlike
// BulletinResult.retards/absences/exclusion (see BulletinsService), which
// are entered per trimestre/semestre only for that term's printed bulletin
// and never carry over. A record here follows the student across school
// years, same as their enrollment history. Never deleted once created
// (append-only, like the rest of the audited trail) - a mistaken entry is
// corrected by adding a note, not by erasing what was recorded.
@Schema({ timestamps: true, collection: 'discipline_records' })
export class DisciplineRecord {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Student',
    index: true,
  })
  studentId: string;

  // The year the incident happened in - lets the journal be filtered/read
  // year by year even though the record itself is never year-scoped away.
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  schoolYearId: string;

  @Prop({
    required: true,
    enum: Object.values(DisciplineRecordType),
  })
  type: DisciplineRecordType;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true, trim: true })
  motif: string;

  // What was decided/done about it (e.g. "3 jours d'exclusion", "convocation
  // des parents le ..."). Optional - an avertissement often has none beyond
  // the motif itself.
  @Prop({ trim: true })
  mesure?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  recordedBy?: string;
}

export const DisciplineRecordSchema =
  SchemaFactory.createForClass(DisciplineRecord);
DisciplineRecordSchema.plugin(ecoleScopePlugin);
DisciplineRecordSchema.index({ studentId: 1, date: -1 });
DisciplineRecordSchema.index({ schoolYearId: 1, date: -1 });
