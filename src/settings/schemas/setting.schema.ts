import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type SettingDocument = HydratedDocument<Setting>;

@Schema({ timestamps: true, collection: 'settings' })
export class Setting {
  @Prop({ required: true })
  key: string;

  // Always present (defaults to null for a "global" setting not tied to a
  // school year), never omitted - MongoDB partial indexes don't support
  // $exists:false, so uniqueness below relies on a plain compound index
  // instead, where null is just another distinct indexed value.
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'SchoolYear',
    default: null,
    index: true,
  })
  schoolYearId: string | null;

  @Prop({ required: true })
  value: string;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
SettingSchema.plugin(ecoleScopePlugin);
SettingSchema.index({ ecoleId: 1, key: 1, schoolYearId: 1 }, { unique: true });
