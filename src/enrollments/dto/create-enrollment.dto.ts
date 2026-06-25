import { IsBooleanString, IsEnum, IsMongoId, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { EnrollmentType } from '../../common/enums/domain.enums';

export class CreateEnrollmentDto {
  @IsMongoId()
  studentId: string;

  @IsMongoId()
  schoolYearId: string;

  @IsMongoId()
  levelId: string;

  @IsEnum(EnrollmentType)
  type: EnrollmentType;

  @IsOptional()
  @IsMongoId()
  previousEnrollmentId?: string;

  @IsOptional()
  @IsBooleanString()
  applyOpenArrears?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discountAmount?: number;
}