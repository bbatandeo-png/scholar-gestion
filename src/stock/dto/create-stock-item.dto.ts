import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { StockCategory } from '../../common/enums/domain.enums';

// A blank "Seuil d'alerte" input submits '' - must become undefined (not a
// number) so @IsOptional() skips it. This has to check for '' AND convert
// to a number in the same @Transform: stacking a separate
// @Transform(emptyToUndefined) with @Type(() => Number) looks equivalent
// but isn't - Number('') is 0, not NaN, so if @Type runs before the
// empty-check ever sees the raw string, '' silently becomes a stored
// threshold of 0 instead of "no threshold" (caught via a real submission,
// not just reasoning about it - see stock.controller e2e coverage).
function toOptionalInt({ value }: { value: unknown }) {
  if (value === '' || value === undefined || value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

export class CreateStockItemDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(StockCategory)
  category: StockCategory;

  @IsString()
  @MinLength(1)
  unit: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(0)
  alertThreshold?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
