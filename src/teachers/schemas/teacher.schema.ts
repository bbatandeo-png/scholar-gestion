import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { TeacherStatus } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type TeacherDocument = HydratedDocument<Teacher>;

// Fiche identite + professionnelle d'un enseignant - le reste du dossier
// (affectations, contrats, pieces jointes, suivi) vit dans des collections
// separees qui referencent celle-ci (voir teacher-assignment/teacher-contract/
// teacher-document/teacher-tracking-record), jamais en tableaux embarques,
// meme pattern que Student/Enrollment.
@Schema({ timestamps: true, collection: 'teachers' })
export class Teacher {
  @Prop({ required: true, trim: true })
  lastname: string;

  @Prop({ required: true, trim: true })
  firstname: string;

  @Prop({ trim: true, uppercase: true, enum: ['M', 'F'] })
  gender?: string;

  @Prop()
  birthDate?: Date;

  @Prop({ trim: true })
  birthPlace?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ trim: true })
  address?: string;

  // Plus haut diplome obtenu (ex: "Licence", "Master FLE", "CAP") - texte
  // libre, pas une liste fermee : trop variable d'une ecole a l'autre.
  @Prop({ trim: true })
  diploma?: string;

  // Domaine/matiere de specialite, en texte libre - distinct du catalogue
  // Subject (bulletins) utilise par les affectations, qui lui est
  // structure/reutilise pour les bulletins.
  @Prop({ trim: true })
  specialty?: string;

  @Prop()
  hireDate?: Date;

  @Prop({
    required: true,
    enum: Object.values(TeacherStatus),
    default: TeacherStatus.ACTIF,
  })
  status: TeacherStatus;

  // Meme convention que Student.photo (voir uploaded-image.util.ts) -
  // chemin relatif sous uploads/, remplace a chaque reupload.
  @Prop()
  photo?: string;

  @Prop({ trim: true })
  notes?: string;
}

export const TeacherSchema = SchemaFactory.createForClass(Teacher);
TeacherSchema.plugin(ecoleScopePlugin);
TeacherSchema.index({ ecoleId: 1, lastname: 1, firstname: 1 });
