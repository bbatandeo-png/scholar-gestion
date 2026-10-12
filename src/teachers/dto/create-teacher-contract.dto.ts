import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TeacherContractType } from '../../common/enums/domain.enums';
import { emptyToUndefined } from './dto-transforms.util';

export class CreateTeacherContractDto {
  @IsEnum(TeacherContractType)
  type: TeacherContractType;

  @IsISO8601()
  startDate: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
