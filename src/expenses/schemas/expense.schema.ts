import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

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

  // Historique complet des modifications (rapport A13) : valeurs avant et
  // apres, auteur, date et motif de CHAQUE modification - jamais ecrase.
  @Prop({
    type: [
      {
        at: Date,
        byName: String,
        byId: String,
        reason: String,
        changes: [{ field: String, before: String, after: String }],
      },
    ],
    default: [],
  })
  modificationHistory: Array<{
    at: Date;
    byName?: string;
    byId?: string;
    reason: string;
    changes: Array<{ field: string; before: string; after: string }>;
  }>;

  @Prop({ default: false, index: true })
  isCancelled: boolean;

  @Prop()
  cancelledAt?: Date;

  @Prop({ trim: true })
  cancellationReason?: string;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.plugin(ecoleScopePlugin);
ExpenseSchema.index({ schoolYearId: 1, expenseDate: -1 });
