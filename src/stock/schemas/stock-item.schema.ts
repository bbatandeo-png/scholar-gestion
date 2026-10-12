import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { StockCategory } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type StockItemDocument = HydratedDocument<StockItem>;

// Current quantity is a running total maintained by StockService on every
// StockMovement (never edited directly) - the movement ledger is the
// source of truth, this field exists only so the list/alert view doesn't
// have to re-sum every movement on every page load.
@Schema({ timestamps: true, collection: 'stock_items' })
export class StockItem {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    required: true,
    enum: Object.values(StockCategory),
    default: StockCategory.AUTRE,
  })
  category: StockCategory;

  @Prop({ required: true, trim: true, default: 'unité' })
  unit: string;

  @Prop({ required: true, min: 0, default: 0 })
  quantity: number;

  // Below this, the item shows up as "en alerte" on the list - left unset
  // (no alert ever) when not meaningful for a given item.
  @Prop({ min: 0 })
  alertThreshold?: number;

  @Prop({ trim: true })
  location?: string;

  @Prop({ trim: true })
  notes?: string;
}

export const StockItemSchema = SchemaFactory.createForClass(StockItem);
StockItemSchema.plugin(ecoleScopePlugin);
StockItemSchema.index({ ecoleId: 1, name: 1 }, { unique: true });
