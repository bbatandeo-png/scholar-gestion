import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { StockCategory } from '../../common/enums/domain.enums';

function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

export class SearchStockItemsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(StockCategory)
  category?: StockCategory;
}
