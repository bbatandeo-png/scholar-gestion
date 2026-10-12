import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TeacherTrackingType } from '../../common/enums/domain.enums';

export class CreateTeacherTrackingRecordDto {
  @IsEnum(TeacherTrackingType)
  type: TeacherTrackingType;

  @IsISO8601()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
