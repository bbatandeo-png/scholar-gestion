import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SubjectCategory } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type SubjectDocument = HydratedDocument<Subject>;

// Ecole-global "matiere" catalog (not per-class - see ClassSubject for the
// per-level coefficient/teacher configuration).
@Schema({ timestamps: true, collection: 'subjects' })
export class Subject {
  @Prop({ required: true, trim: true })
  label: string;

  // Accent/case-stripped lookup key (see bulletins-import.util.ts
  // normalizeLabel) - the actual match key, since imported Excel files vary
  // in casing/accents/typos and must never fuzzy-auto-match on this field.
  @Prop({ required: true, trim: true })
  labelNormalized: string;

  @Prop({ required: true, enum: Object.values(SubjectCategory) })
  category: SubjectCategory;

  @Prop({ default: true })
  active: boolean;
}

export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.plugin(ecoleScopePlugin);
SubjectSchema.index({ ecoleId: 1, labelNormalized: 1 }, { unique: true });
