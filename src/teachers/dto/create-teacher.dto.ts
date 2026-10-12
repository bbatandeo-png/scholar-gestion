import {
  IsEnum,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TeacherStatus } from '../../common/enums/domain.enums';
import { emptyToUndefined } from './dto-transforms.util';

export class CreateTeacherDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastname: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstname: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(['M', 'F'])
  gender?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  birthPlace?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  diploma?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialty?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601()
  hireDate?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(TeacherStatus)
  status?: TeacherStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
