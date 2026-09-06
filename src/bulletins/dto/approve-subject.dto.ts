import { Type } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SubjectCategory } from '../../common/enums/domain.enums';

export class ApproveSubjectDto {
  @IsString()
  subjectNameRaw: string;

  // Link to an existing Subject...
  @IsOptional()
  @IsMongoId()
  existingSubjectId?: string;

  // ...or create a new one (both required together when existingSubjectId is absent).
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsEnum(SubjectCategory)
  category?: SubjectCategory;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  coefficient: number;

  @IsOptional()
  @IsString()
  teacherName?: string;
}
