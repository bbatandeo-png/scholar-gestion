import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ImportRowMatchStatus } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type ImportRowIdentity = {
  nameRaw: string;
  matriculeRaw?: string;
  sexeRaw?: string;
};

export type ImportRowNote = {
  subjectNameRaw: string;
  subjectId?: string;
  i1: number | null;
  i2: number | null;
  devoir: number | null;
  compo: number | null;
  coef: number | null;
  profRaw?: string;
};

export type BulletinImportRowDocument = HydratedDocument<BulletinImportRow>;

// One document per Excel data row (its own collection, not an embedded
// array on the session) so individual rows can be queried/corrected cheaply
// during review without reloading/resubmitting the whole session at once.
@Schema({ timestamps: true, collection: 'bulletin_import_rows' })
export class BulletinImportRow {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'BulletinSession',
    required: true,
    index: true,
  })
  sessionId: string;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  rawIdentity: ImportRowIdentity;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Student', default: null })
  studentId: string | null;

  @Prop({
    required: true,
    enum: Object.values(ImportRowMatchStatus),
    default: ImportRowMatchStatus.UNRESOLVED,
  })
  matchStatus: ImportRowMatchStatus;

  @Prop({ type: [SchemaTypes.ObjectId], default: [] })
  matchCandidates: string[];

  @Prop({ type: SchemaTypes.Mixed, default: [] })
  notes: ImportRowNote[];

  // Entered manually via BulletinsController's discipline screen, before
  // validation. Copied onto the corresponding BulletinResult at
  // BulletinsService.validateSession() - the source Excel file never
  // carries this information.
  @Prop({ type: Number, default: null })
  retards: number | null;

  @Prop({ type: Number, default: null })
  absences: number | null;

  @Prop({ trim: true })
  exclusion?: string;

  @Prop({ trim: true })
  decisionConseil?: string;
}

export const BulletinImportRowSchema =
  SchemaFactory.createForClass(BulletinImportRow);
BulletinImportRowSchema.plugin(ecoleScopePlugin);
BulletinImportRowSchema.index({ ecoleId: 1, sessionId: 1 });
