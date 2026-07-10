import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type ExpenseDocument = HydratedDocument<Expense>;

@Schema({ timestamps: true, collection: 'expenses' })
export class Expense {
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

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'ExpenseCategory', index: true })
  categoryId: string;

  @Prop({ trim: true })
  lastModificationReason?: string;

  @Prop()
  modifiedAt?: Date;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
