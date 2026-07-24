import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { SchoolYearStatus } from '../../common/enums/domain.enums';

export type SchoolYearDocument = HydratedDocument<SchoolYear>;

@Schema({ timestamps: true, collection: 'school_years' })
export class SchoolYear {
  @Prop({ required: true, unique: true, trim: true })
  label: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({
    required: true,
    enum: Object.values(SchoolYearStatus),
    default: SchoolYearStatus.DRAFT,
  })
  status: SchoolYearStatus;

  @Prop()
  preparedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear' })
  preparedFromSchoolYearId?: string;

  @Prop({ default: 0, min: 0 })
  rolloverVersion: number;
}

export const SchoolYearSchema = SchemaFactory.createForClass(SchoolYear);
SchoolYearSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: SchoolYearStatus.OPEN },
    name: 'one_open_school_year',
  },
);
