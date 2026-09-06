import { Type } from 'class-transformer';
import {
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpsertClassSubjectDto {
  @IsMongoId()
  schoolYearId: string;

  @IsMongoId()
  levelId: string;

  @IsMongoId()
  subjectId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  coefficient: number;

  @IsOptional()
  @IsString()
  teacherName?: string;
}
