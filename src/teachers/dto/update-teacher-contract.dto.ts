import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TeacherContractType } from '../../common/enums/domain.enums';
import { emptyToUndefined } from './dto-transforms.util';

export class UpdateTeacherContractDto {
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

  @IsString()
  @IsNotEmpty({ message: 'Le motif de la modification est obligatoire' })
  @MaxLength(500)
  modificationReason: string;
}
