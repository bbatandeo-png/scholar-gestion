import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { FactureStatut } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type FactureLigne = {
  label: string;
  quantite: number;
  prixUnitaire: number;
  sousTotal: number;
};

export type FactureDocument = HydratedDocument<Facture>;

@Schema({ timestamps: true, collection: 'factures' })
export class Facture {
  @Prop({ required: true, trim: true })
  numero: string;

  // Null = whole-ecole invoice, otherwise scoped to a single class.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Level', default: null })
  classeId: string | null;

  @Prop({ required: true, trim: true })
  periode: string;

  @Prop({ required: true, default: Date.now })
  dateGeneration: Date;

  @Prop({ type: SchemaTypes.Mixed, required: true, default: [] })
  lignes: FactureLigne[];

  @Prop({ required: true, min: 0 })
  montantTotal: number;

  @Prop({
    required: true,
    enum: Object.values(FactureStatut),
    default: FactureStatut.EMISE,
  })
  statut: FactureStatut;
}

export const FactureSchema = SchemaFactory.createForClass(Facture);
FactureSchema.plugin(ecoleScopePlugin);
FactureSchema.index({ ecoleId: 1, numero: 1 }, { unique: true });
