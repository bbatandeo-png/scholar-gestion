import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import {
  TeacherContractStatus,
  TeacherContractType,
} from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type TeacherContractDocument = HydratedDocument<TeacherContract>;

// Historise : une ligne par periode de contrat, jamais reecrite en place une
// fois qu'une suivante existe - meme precedent que EcoleModule (module
// toggle) et Enrollment. Un renouvellement cree une NOUVELLE ligne (liee a
// l'ancienne via renewedFromContractId) plutot que de prolonger la date de
// l'existante, pour garder tout l'historique interrogeable. Au plus un
// contrat ACTIF a la fois par enseignant, impose par l'index partiel
// ci-dessous (meme mecanisme que EcoleModule.dateDesactivation:null).
@Schema({ timestamps: true, collection: 'teacher_contracts' })
export class TeacherContract {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Teacher',
    index: true,
  })
  teacherId: string;

  @Prop({ required: true, enum: Object.values(TeacherContractType) })
  type: TeacherContractType;

  @Prop({ required: true })
  startDate: Date;

  // Absent pour un CDI sans terme prevu.
  @Prop()
  endDate?: Date;

  @Prop({
    required: true,
    enum: Object.values(TeacherContractStatus),
    default: TeacherContractStatus.ACTIF,
  })
  status: TeacherContractStatus;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'TeacherContract', default: null })
  renewedFromContractId?: string | null;

  @Prop({ trim: true })
  notes?: string;

  @Prop()
  terminatedAt?: Date;

  @Prop({ trim: true })
  terminatedReason?: string;

  // Motif obligatoire a chaque modification (voir TeachersService.
  // updateContract) - distinct de terminatedReason (resiliation).
  @Prop({ trim: true })
  lastModificationReason?: string;

  @Prop()
  modifiedAt?: Date;
}

export const TeacherContractSchema =
  SchemaFactory.createForClass(TeacherContract);
TeacherContractSchema.plugin(ecoleScopePlugin);
TeacherContractSchema.index({ teacherId: 1, startDate: -1 });
TeacherContractSchema.index(
  { ecoleId: 1, teacherId: 1 },
  { unique: true, partialFilterExpression: { status: 'actif' } },
);
