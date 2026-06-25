import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { GuardianType } from '../../common/enums/domain.enums';

export type GuardianDocument = HydratedDocument<Guardian>;

@Schema({ timestamps: true, collection: 'guardians' })
export class Guardian {
  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Student', index: true })
  studentId: string;

  @Prop({ required: true, enum: Object.values(GuardianType) })
  type: GuardianType;

  @Prop({ required: true, trim: true })
  lastname: string;

  @Prop({ required: true, trim: true })
  firstname: string;

  @Prop({ required: false, trim: true })
  phone?: string;

  @Prop({ required: false, trim: true })
  address?: string;
}

export const GuardianSchema = SchemaFactory.createForClass(Guardian);