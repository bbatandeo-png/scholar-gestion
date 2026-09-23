import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { GuardianInputDto } from './guardian-input.dto';

// A blank <input type="date"> submits '' (not absent) - @IsOptional() only
// skips null/undefined, so without this an empty optional birthDate fails
// @IsDateString() (same fix as CreateEcoleDto's email/color fields).
function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

export class CreateStudentDto {
  @IsOptional()
  @IsString()
  matricule?: string;

  @IsString()
  lastname: string;

  @IsString()
  firstname: string;

  @IsString()
  @IsIn(['M', 'F'])
  gender: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  birthPlace?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians?: GuardianInputDto[];
}
