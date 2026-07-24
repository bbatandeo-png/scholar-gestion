import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type SettingDocument = HydratedDocument<Setting>;

@Schema({ timestamps: true, collection: 'settings' })
export class Setting {
  @Prop({ required: true })
  key: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', index: true })
  schoolYearId?: string;

  @Prop({ required: true })
  value: string;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
SettingSchema.index(
  { key: 1, schoolYearId: 1 },
  {
    unique: true,
    partialFilterExpression: { schoolYearId: { $exists: true } },
  },
);
SettingSchema.index(
  { key: 1 },
  {
    unique: true,
    partialFilterExpression: { schoolYearId: { $exists: false } },
  },
);
