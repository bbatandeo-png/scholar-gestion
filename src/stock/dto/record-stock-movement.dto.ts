import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { StockMovementType } from '../../common/enums/domain.enums';

export class RecordStockMovementDto {
  @IsEnum(StockMovementType)
  type: StockMovementType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @MinLength(1)
  reason: string;

  @IsISO8601()
  date: string;
}
