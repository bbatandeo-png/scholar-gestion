import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type TeacherDocumentFileDocument = HydratedDocument<TeacherDocumentFile>;

// Une ligne par piece jointe (diplome, CV, piece d'identite, contrat
// scanne...) - plusieurs fichiers par enseignant, contrairement a
// Teacher.photo qui est une image unique remplacee a chaque reupload. Voir
// uploaded-document.util.ts pour l'ecriture sur disque (chemin unique par
// fichier, jamais ecrase).
@Schema({ timestamps: true, collection: 'teacher_documents' })
export class TeacherDocumentFile {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Teacher',
    index: true,
  })
  teacherId: string;

  // Libelle libre choisi au moment du depot (ex: "Diplome", "CNI", "CV").
  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  relativePath: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  uploadedBy?: string;

  @Prop({ trim: true })
  lastModificationReason?: string;

  @Prop()
  modifiedAt?: Date;
}

export const TeacherDocumentFileSchema =
  SchemaFactory.createForClass(TeacherDocumentFile);
TeacherDocumentFileSchema.plugin(ecoleScopePlugin);
TeacherDocumentFileSchema.index({ teacherId: 1, createdAt: -1 });
