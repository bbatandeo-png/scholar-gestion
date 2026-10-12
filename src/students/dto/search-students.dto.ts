import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// A blank <select>/<input> (the "Tous"/"Toutes les annees" placeholder) submits
// '' - treated the same as "not set" everywhere below.
function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

export class SearchStudentsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  levelId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(['active', 'archived', 'transferred', 'left'])
  status?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  matricule?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  schoolYearId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  pageSize?: number;
}
