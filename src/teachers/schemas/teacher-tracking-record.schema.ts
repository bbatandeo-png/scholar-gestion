import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { TeacherTrackingType } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type TeacherTrackingRecordDocument =
  HydratedDocument<TeacherTrackingRecord>;

// Journal de suivi "version simple" (absence/observation/evaluation) sur
// toute la presence de l'enseignant dans l'ecole. Modifiable en place (voir
// TeachersService.updateTrackingRecord) - un motif est alors obligatoire et
// l'avant/apres journalise via AuditService, pour garder une trace malgre
// la correction directe.
@Schema({ timestamps: true, collection: 'teacher_tracking_records' })
export class TeacherTrackingRecord {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Teacher',
    index: true,
  })
  teacherId: string;

  // Toujours l'annee OUVERTE au moment de l'enregistrement (requireOpen(),
  // jamais choisie par le client) - meme regle que DisciplineRecord, pour
  // dater l'entree sans jamais permettre d'antidater dans une annee deja
  // cloturee en naviguant dessus via le selecteur d'annee de l'en-tete.
  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'SchoolYear' })
  schoolYearId: string;

  @Prop({ required: true, enum: Object.values(TeacherTrackingType) })
  type: TeacherTrackingType;

  @Prop({ required: true })
  date: Date;

  @Prop({ trim: true })
  note?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  recordedBy?: string;

  @Prop({ trim: true })
  lastModificationReason?: string;

  @Prop()
  modifiedAt?: Date;
}

export const TeacherTrackingRecordSchema = SchemaFactory.createForClass(
  TeacherTrackingRecord,
);
TeacherTrackingRecordSchema.plugin(ecoleScopePlugin);
TeacherTrackingRecordSchema.index({ teacherId: 1, date: -1 });
