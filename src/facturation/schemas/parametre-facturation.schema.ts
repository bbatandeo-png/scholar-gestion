import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  FacturationMode,
  FacturationSousType,
} from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type ParametreFacturationDocument =
  HydratedDocument<ParametreFacturation>;

// Historised: never updated in place, see FacturationService.changeParametre.
// dateFin is always present (null while active) so the "at most one active
// row per ecole" index below can use an equality partial filter - MongoDB
// partial indexes don't support $exists:false (see ecole-scope.plugin.ts /
// setting.schema.ts for the same lesson learned).
@Schema({ timestamps: true, collection: 'parametre_facturations' })
export class ParametreFacturation {
  @Prop({ required: true, enum: Object.values(FacturationMode) })
  mode: FacturationMode;

  @Prop({ enum: Object.values(FacturationSousType) })
  sousType?: FacturationSousType;

  @Prop({ required: true, min: 0 })
  montantUnitaire: number;

  @Prop({ required: true })
  dateEffet: Date;

  @Prop({ type: Date, default: null })
  dateFin: Date | null;
}

export const ParametreFacturationSchema =
  SchemaFactory.createForClass(ParametreFacturation);
ParametreFacturationSchema.plugin(ecoleScopePlugin, { skipPlainIndex: true });
ParametreFacturationSchema.index(
  { ecoleId: 1 },
  { unique: true, partialFilterExpression: { dateFin: null } },
);
