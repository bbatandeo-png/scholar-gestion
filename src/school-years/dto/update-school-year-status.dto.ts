import { IsEnum } from 'class-validator';
import { SchoolYearStatus } from '../../common/enums/domain.enums';

export class UpdateSchoolYearStatusDto {
  @IsEnum(SchoolYearStatus)
  status: SchoolYearStatus;
}
