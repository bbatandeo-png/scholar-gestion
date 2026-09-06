import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { TypeEvenementConsommation } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type ConsommationDocument = HydratedDocument<Consommation>;

@Schema({ timestamps: true, collection: 'consommations' })
export class Consommation {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Level', index: true })
  classeId?: string;

  @Prop({ required: true, trim: true })
  periode: string;

  @Prop({ required: true, default: Date.now })
  date: Date;

  @Prop({ required: true, enum: Object.values(TypeEvenementConsommation) })
  typeEvenement: TypeEvenementConsommation;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Student', required: true, index: true })
  eleveId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true, index: true })
  anneeScolaireId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Facture', default: null, index: true })
  factureId: string | null;
}

export const ConsommationSchema = SchemaFactory.createForClass(Consommation);
ConsommationSchema.plugin(ecoleScopePlugin);
// Regenerating a bulletin for the same eleve/periode never creates a second
// billable row.
ConsommationSchema.index(
  { ecoleId: 1, eleveId: 1, periode: 1 },
  {
    unique: true,
    partialFilterExpression: { typeEvenement: TypeEvenementConsommation.BULLETIN },
  },
);
// One billable row per eleve per school year, regardless of how many
// periods/regenerations occur within that year.
ConsommationSchema.index(
  { ecoleId: 1, eleveId: 1, anneeScolaireId: 1 },
  {
    unique: true,
    partialFilterExpression: { typeEvenement: TypeEvenementConsommation.USAGE_ELEVE },
  },
);
