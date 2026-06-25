import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { PaymentMethod } from '../../common/enums/domain.enums';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Invoice', index: true })
  invoiceId: string;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true, enum: Object.values(PaymentMethod) })
  method: PaymentMethod;

  @Prop({ trim: true })
  reference?: string;

  @Prop({ required: true, unique: true, index: true })
  receiptNumber: string;

  @Prop({ type: SchemaTypes.Mixed, default: [] })
  allocation: Array<Record<string, unknown>>;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  createdBy?: string;

  @Prop({ required: true })
  paidAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);