import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import {
  EnrollmentStatus,
  EnrollmentType,
  FinalDecision,
} from '../../common/enums/domain.enums';

export type EnrollmentDocument = HydratedDocument<Enrollment>;

@Schema({ timestamps: true, collection: 'enrollments' })
export class Enrollment {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Student',
    index: true,
  })
  studentId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  schoolYearId: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Level' })
  levelId: string;

  @Prop({ type: SchemaTypes.Mixed })
  studentSnapshot?: Record<string, unknown>;

  @Prop({ type: SchemaTypes.Mixed })
  levelSnapshot?: Record<string, unknown>;

  @Prop({ required: true, enum: Object.values(EnrollmentType) })
  type: EnrollmentType;

  @Prop({
    required: true,
    enum: Object.values(EnrollmentStatus),
    default: EnrollmentStatus.ACTIVE,
  })
  status: EnrollmentStatus;

  @Prop({
    required: true,
    enum: Object.values(FinalDecision),
    default: FinalDecision.PENDING,
  })
  finalDecision: FinalDecision;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Enrollment', required: false })
  previousEnrollmentId?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Level', required: false })
  promotionTargetLevelId?: string;

  @Prop()
  rolloverProcessedAt?: Date;
}

export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);
EnrollmentSchema.index(
  { studentId: 1, schoolYearId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
EnrollmentSchema.index({ schoolYearId: 1, levelId: 1, status: 1 });
