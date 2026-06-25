import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class CarryForwardArrearsDto {
  @IsMongoId()
  studentId: string;

  @IsMongoId()
  sourceEnrollmentId: string;

  @IsMongoId()
  targetEnrollmentId: string;

  @IsOptional()
  @IsString()
  mode?: string;
}