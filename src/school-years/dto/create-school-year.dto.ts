import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { SchoolYearStatus } from '../../common/enums/domain.enums';

export class CreateSchoolYearDto {
  @IsString()
  label: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsEnum(SchoolYearStatus)
  status?: SchoolYearStatus;
}