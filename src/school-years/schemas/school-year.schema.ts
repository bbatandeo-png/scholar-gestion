import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
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

  @Prop({ required: true, enum: Object.values(SchoolYearStatus), default: SchoolYearStatus.DRAFT })
  status: SchoolYearStatus;
}

export const SchoolYearSchema = SchemaFactory.createForClass(SchoolYear);