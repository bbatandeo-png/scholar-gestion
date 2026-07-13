import { Type } from 'class-transformer';
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

  @IsDateString()
  birthDate: string;

  @IsString()
  birthPlace: string;

  @IsString()
  district: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians?: GuardianInputDto[];
}