import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TeacherTrackingType } from '../../common/enums/domain.enums';

export class UpdateTeacherTrackingRecordDto {
  @IsEnum(TeacherTrackingType)
  type: TeacherTrackingType;

  @IsISO8601()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsString()
  @IsNotEmpty({ message: 'Le motif de la modification est obligatoire' })
  @MaxLength(500)
  modificationReason: string;
}
