import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type FeeScheduleDocument = HydratedDocument<FeeSchedule>;

@Schema({ timestamps: true, collection: 'fee_schedules' })
export class FeeSchedule {
  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'SchoolYear' })
  schoolYearId: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Level' })
  levelId: string;

  @Prop({ required: true, min: 0 })
  registrationFee: number;

  @Prop({ required: true, min: 0 })
  tuitionFee: number;
}

export const FeeScheduleSchema = SchemaFactory.createForClass(FeeSchedule);
FeeScheduleSchema.index({ schoolYearId: 1, levelId: 1 }, { unique: true });