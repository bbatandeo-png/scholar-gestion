import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { StockMovementType } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type StockMovementDocument = HydratedDocument<StockMovement>;

// Append-only ledger entry - see the StockMovementType comment. Mirrors how
// Payment/DisciplineRecord are never edited or deleted once created.
@Schema({ timestamps: true, collection: 'stock_movements' })
export class StockMovement {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'StockItem',
    index: true,
  })
  itemId: string;

  @Prop({
    required: true,
    enum: Object.values(StockMovementType),
  })
  type: StockMovementType;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  recordedBy?: string;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.plugin(ecoleScopePlugin);
StockMovementSchema.index({ itemId: 1, date: -1 });
