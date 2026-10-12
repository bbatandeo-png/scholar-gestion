import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { DisciplineRecordType } from '../../common/enums/domain.enums';

// A blank <select> (the "Toutes"/"Tous" placeholder) submits '' - treated
// the same as "not set" everywhere below, same convention as
// SearchStudentsDto.
function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

export class SearchDisciplineRecordsDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  studentId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  levelId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  schoolYearId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(DisciplineRecordType)
  type?: DisciplineRecordType;

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
