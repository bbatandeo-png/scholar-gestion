import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type ArrearCarryForwardDocument = HydratedDocument<ArrearCarryForward>;

@Schema({
  timestamps: { createdAt: 'carriedAt', updatedAt: false },
  collection: 'arrear_carry_forwards',
})
export class ArrearCarryForward {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Arrear',
    index: true,
  })
  arrearId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  sourceSchoolYearId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  targetSchoolYearId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Enrollment',
    index: true,
  })
  targetEnrollmentId: string;

  @Prop({ required: true, min: 0 })
  amountCarried: number;

  carriedAt: Date;
}

export const ArrearCarryForwardSchema =
  SchemaFactory.createForClass(ArrearCarryForward);
ArrearCarryForwardSchema.index(
  { arrearId: 1, targetEnrollmentId: 1 },
  { unique: true },
);
ArrearCarryForwardSchema.index({ targetSchoolYearId: 1, carriedAt: -1 });
