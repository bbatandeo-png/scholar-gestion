import { Type } from 'class-transformer';
import { IsMongoId, IsNumber, Min } from 'class-validator';

export class UpsertFeeScheduleDto {
  @IsMongoId()
  schoolYearId: string;

  @IsMongoId()
  levelId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  registrationFee: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tuitionFee: number;
}