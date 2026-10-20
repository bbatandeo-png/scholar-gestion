import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { GuardianInputDto } from './guardian-input.dto';

// A blank <select>/<input> submits '' - @IsOptional() only skips null/undefined.
function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

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

  // Un champ date laisse vide envoie '' : sans cette transformation,
  // l'enregistrement d'un eleve sans date de naissance echouait avec
  // "birthDate must be a valid ISO 8601 date string" (meme correctif que
  // CreateStudentDto).
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
  @Transform(emptyToUndefined)
  @IsMongoId()
  levelId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians?: GuardianInputDto[];
}
