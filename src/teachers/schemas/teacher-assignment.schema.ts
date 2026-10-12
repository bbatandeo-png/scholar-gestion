import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type TeacherAssignmentDocument = HydratedDocument<TeacherAssignment>;

// Affectation matiere/classe/annee scolaire d'un enseignant, avec le volume
// horaire hebdomadaire correspondant - une ligne par affectation, jamais
// un tableau embarque sur Teacher (meme raisonnement que Enrollment pour
// Student : chaque annee/configuration a sa propre ligne interrogeable).
@Schema({ timestamps: true, collection: 'teacher_assignments' })
export class TeacherAssignment {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Teacher',
    index: true,
  })
  teacherId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  schoolYearId: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Level' })
  levelId: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Subject' })
  subjectId: string;

  @Prop({ required: true, min: 0 })
  hoursPerWeek: number;

  // Titulaire = enseignant responsable de la classe (une seule personne par
  // classe/annee - impose par l'index partiel ci-dessous), distinct des
  // autres enseignants qui y interviennent juste pour une matiere donnee.
  @Prop({ default: false })
  isTitulaire: boolean;

  // Motif obligatoire a chaque modification (voir TeachersService.
  // updateAssignment) - jamais rempli a la creation.
  @Prop({ trim: true })
  lastModificationReason?: string;

  @Prop()
  modifiedAt?: Date;
}

export const TeacherAssignmentSchema =
  SchemaFactory.createForClass(TeacherAssignment);
TeacherAssignmentSchema.plugin(ecoleScopePlugin);
TeacherAssignmentSchema.index(
  { ecoleId: 1, teacherId: 1, schoolYearId: 1, levelId: 1, subjectId: 1 },
  { unique: true },
);
TeacherAssignmentSchema.index({ schoolYearId: 1, levelId: 1 });
TeacherAssignmentSchema.index(
  { ecoleId: 1, schoolYearId: 1, levelId: 1 },
  { unique: true, partialFilterExpression: { isTitulaire: true } },
);
