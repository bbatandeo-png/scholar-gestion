import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StockItem, StockItemSchema } from './schemas/stock-item.schema';
import {
  StockMovement,
  StockMovementSchema,
} from './schemas/stock-movement.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockItem.name, schema: StockItemSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
    ]),
    EcoleModulesModule,
  ],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
