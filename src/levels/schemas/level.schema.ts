import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LevelCycle } from '../../common/enums/domain.enums';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type LevelDocument = HydratedDocument<Level>;

@Schema({ timestamps: true, collection: 'levels' })
export class Level {
  @Prop({ required: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true })
  sortOrder: number;

  // Optional (not required) so existing seeded levels don't fail validation
  // on next save - backfilled via src/scripts/migrate-add-level-cycle.ts,
  // enforced at bulletin-session-creation time instead of at the DB level.
  @Prop({
    type: Number,
    enum: Object.values(LevelCycle).filter((v) => typeof v === 'number'),
  })
  cycle?: LevelCycle;
}

export const LevelSchema = SchemaFactory.createForClass(Level);
LevelSchema.plugin(ecoleScopePlugin);
LevelSchema.index({ ecoleId: 1, code: 1 }, { unique: true });
LevelSchema.index({ ecoleId: 1, sortOrder: 1 }, { unique: true });
