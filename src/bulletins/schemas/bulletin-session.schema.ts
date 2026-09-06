import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import {
  BulletinSessionStatus,
  BulletinStudentMatchingMode,
  Periode,
} from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type BulletinSessionMeta = {
  titulaire?: string;
  chefEtablissement?: string;
  anneeScolaire?: string;
  dateDuConseil?: Date;
};

// Class-wide period stats (same 3 numbers printed on every student's
// bulletin for this class/periode) - computed once at validation and stored
// here rather than duplicated onto every BulletinResult document.
export type BulletinSessionClassStats = {
  moyenneMin: number;
  moyenneMax: number;
  moyenneClasse: number;
};

export type BulletinSessionDocument = HydratedDocument<BulletinSession>;

// One session per class (level) + periode + school year. Re-importing a
// file against the same class/periode re-enters this same session (see
// BulletinImportMode) rather than creating a duplicate.
@Schema({ timestamps: true, collection: 'bulletin_sessions' })
export class BulletinSession {
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

  // Chosen once at creation (see BulletinsController.create), immutable
  // after - importFile() re-invoked across PREMIER_IMPORT/ECRASER/FUSIONNER
  // re-imports of the same session must stay on the same mode. Defaults to
  // RECONCILE so any pre-existing session (created before this field
  // existed) behaves exactly as before with no backfill needed.
  @Prop({
    required: true,
    enum: Object.values(BulletinStudentMatchingMode),
    default: BulletinStudentMatchingMode.RECONCILE,
  })
  studentMatchingMode: BulletinStudentMatchingMode;

  @Prop({
    required: true,
    enum: Object.values(BulletinSessionStatus),
    default: BulletinSessionStatus.DRAFT,
  })
  status: BulletinSessionStatus;

  @Prop({ trim: true })
  sourceFileName?: string;

  @Prop()
  importedAt?: Date;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  meta: BulletinSessionMeta;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  classStats: BulletinSessionClassStats | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy: string;
}

export const BulletinSessionSchema =
  SchemaFactory.createForClass(BulletinSession);
BulletinSessionSchema.plugin(ecoleScopePlugin);
BulletinSessionSchema.index(
  { ecoleId: 1, schoolYearId: 1, levelId: 1, periode: 1 },
  { unique: true },
);
