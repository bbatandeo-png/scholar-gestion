import { IsBooleanString, IsMongoId, IsOptional, IsString } from 'class-validator';

export class ReenrollStudentDto {
  @IsMongoId()
  targetSchoolYearId: string;

  @IsMongoId()
  targetLevelId: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBooleanString()
  carryOverArrears?: string;
}