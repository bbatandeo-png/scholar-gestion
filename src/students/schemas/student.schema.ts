import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { StudentStatus } from '../../common/enums/domain.enums';

export type StudentDocument = HydratedDocument<Student>;

@Schema({ timestamps: true, collection: 'students' })
export class Student {
  @Prop({ required: true, unique: true, trim: true })
  matricule: string;

  @Prop({ required: true, trim: true, index: true })
  lastname: string;

  @Prop({ required: true, trim: true, index: true })
  firstname: string;

  @Prop({ required: true, trim: true, uppercase: true, enum: ['M', 'F'] })
  gender: string;

  @Prop({ required: true })
  birthDate: Date;

  @Prop({ required: true, trim: true })
  birthPlace: string;

  @Prop({ required: true, trim: true })
  district: string;

  @Prop({ required: true, enum: Object.values(StudentStatus), default: StudentStatus.ACTIVE })
  status: StudentStatus;
}

export const StudentSchema = SchemaFactory.createForClass(Student);
StudentSchema.index({ lastname: 1, firstname: 1, birthDate: 1 });