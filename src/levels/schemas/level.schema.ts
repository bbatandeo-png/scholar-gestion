import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LevelDocument = HydratedDocument<Level>;

@Schema({ timestamps: true, collection: 'levels' })
export class Level {
  @Prop({ required: true, unique: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, unique: true })
  sortOrder: number;
}

export const LevelSchema = SchemaFactory.createForClass(Level);