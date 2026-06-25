import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { InvoiceStatus } from '../../common/enums/domain.enums';

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ timestamps: true, collection: 'invoices' })
export class Invoice {
  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'Enrollment', unique: true })
  enrollmentId: string;

  @Prop({ required: true, min: 0 })
  registrationFee: number;

  @Prop({ required: true, min: 0 })
  tuitionFee: number;

  @Prop({ required: true, min: 0, default: 0 })
  discountAmount: number;

  @Prop({ required: true, min: 0, default: 0 })
  arrearsAmount: number;

  @Prop({ required: true, min: 0 })
  totalDue: number;

  @Prop({ required: true, min: 0, default: 0 })
  paidAmount: number;

  @Prop({ required: true, min: 0 })
  balanceDue: number;

  @Prop({ required: true, enum: Object.values(InvoiceStatus), default: InvoiceStatus.UNPAID })
  status: InvoiceStatus;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);