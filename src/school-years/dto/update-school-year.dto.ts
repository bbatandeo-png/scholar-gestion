import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { SchoolYearStatus } from '../../common/enums/domain.enums';

export class UpdateSchoolYearDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(SchoolYearStatus)
  status?: SchoolYearStatus;
}
