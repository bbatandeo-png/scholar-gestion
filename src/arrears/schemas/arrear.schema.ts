import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ArrearStatus } from '../../common/enums/domain.enums';

export type ArrearDocument = HydratedDocument<Arrear>;

@Schema({ timestamps: true, collection: 'arrears' })
export class Arrear {
  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Student', index: true })
  studentId: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Enrollment' })
  sourceEnrollmentId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Enrollment', required: false })
  targetEnrollmentId?: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'SchoolYear' })
  sourceSchoolYearId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: false })
  targetSchoolYearId?: string;

  @Prop({ required: true, min: 0 })
  amountInitial: number;

  @Prop({ required: true, min: 0 })
  amountRemaining: number;

  @Prop({ required: true, enum: Object.values(ArrearStatus), default: ArrearStatus.OPEN })
  status: ArrearStatus;
}

export const ArrearSchema = SchemaFactory.createForClass(Arrear);
ArrearSchema.index({ studentId: 1, status: 1 });
ArrearSchema.index(
  { sourceEnrollmentId: 1, targetEnrollmentId: 1 },
  { unique: true, partialFilterExpression: { targetEnrollmentId: { $exists: true } } },
);