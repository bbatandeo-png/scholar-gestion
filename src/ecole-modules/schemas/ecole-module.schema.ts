import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type EcoleModuleDocument = HydratedDocument<EcoleModule>;

// Historised: never updated in place, except the single close-out mutation
// in EcoleModulesService.deactivate (see FacturationService.changeParametre
// for the identical pattern). dateDesactivation is always present (null
// while active) so the "at most one open row per ecole+code" index below
// can use an equality partial filter - MongoDB partial indexes don't
// support $exists:false (see ecole-scope.plugin.ts / setting.schema.ts).
//
// `code` is free-text rather than a fixed enum ('FINANCE' | 'BULLETINS' for
// now) so a later version can introduce hierarchical sub-module codes
// (e.g. 'FINANCE.PAIEMENTS') without a schema migration - no cascade/parent
// logic is implemented yet, this field just stays forward-compatible.
@Schema({ timestamps: true, collection: 'ecole_modules' })
export class EcoleModule {
  @Prop({ required: true })
  code: string;

  @Prop({ required: true, default: true })
  actif: boolean;

  @Prop({ required: true })
  dateActivation: Date;

  @Prop({ type: Date, default: null })
  dateDesactivation: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  activePar: Types.ObjectId;

  // Kept separate from activePar so a closed row still shows who activated
  // it AND who later deactivated it, instead of overwriting the former.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  desactivePar: Types.ObjectId | null;
}

export const EcoleModuleSchema = SchemaFactory.createForClass(EcoleModule);
EcoleModuleSchema.plugin(ecoleScopePlugin);
EcoleModuleSchema.index(
  { ecoleId: 1, code: 1 },
  { unique: true, partialFilterExpression: { dateDesactivation: null } },
);
