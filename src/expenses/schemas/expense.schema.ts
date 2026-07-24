import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type ExpenseDocument = HydratedDocument<Expense>;

@Schema({ timestamps: true, collection: 'expenses' })
export class Expense {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  schoolYearId: string;

  @Prop({ required: true, trim: true })
  orderNumber: string;

  @Prop({ required: true })
  expenseDate: Date;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, trim: true })
  beneficiary: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'ExpenseCategory',
    index: true,
  })
  categoryId: string;

  @Prop({ trim: true })
  lastModificationReason?: string;

  @Prop()
  modifiedAt?: Date;

  @Prop({ default: false, index: true })
  isCancelled: boolean;

  @Prop()
  cancelledAt?: Date;

  @Prop({ trim: true })
  cancellationReason?: string;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.index({ schoolYearId: 1, expenseDate: -1 });
