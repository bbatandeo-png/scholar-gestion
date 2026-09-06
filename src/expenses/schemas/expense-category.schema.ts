import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type ExpenseCategoryDocument = HydratedDocument<ExpenseCategory>;

@Schema({ timestamps: true, collection: 'expense_categories' })
export class ExpenseCategory {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;
}

export const ExpenseCategorySchema =
  SchemaFactory.createForClass(ExpenseCategory);
ExpenseCategorySchema.plugin(ecoleScopePlugin);
ExpenseCategorySchema.index({ ecoleId: 1, name: 1 }, { unique: true });
