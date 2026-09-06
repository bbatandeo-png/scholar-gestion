import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { InvoiceStatus } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ timestamps: true, collection: 'invoices' })
export class Invoice {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  schoolYearId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Enrollment',
  })
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

  @Prop({
    required: true,
    enum: Object.values(InvoiceStatus),
    default: InvoiceStatus.UNPAID,
  })
  status: InvoiceStatus;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.plugin(ecoleScopePlugin);
InvoiceSchema.index({ schoolYearId: 1, status: 1 });
InvoiceSchema.index({ ecoleId: 1, enrollmentId: 1 }, { unique: true });
