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

export class UpdateStudentDto {
	@IsOptional()
	@IsString()
	matricule?: string;

	@IsOptional()
	@IsString()
	lastname?: string;

	@IsOptional()
	@IsString()
	firstname?: string;

	@IsOptional()
	@IsString()
	@IsIn(['M', 'F'])
	gender?: string;

	@IsOptional()
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