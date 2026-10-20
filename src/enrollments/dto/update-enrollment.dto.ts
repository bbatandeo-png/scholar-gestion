import { Transform } from 'class-transformer';
import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { EnrollmentType } from '../../common/enums/domain.enums';

// A blank <select> (e.g. the "Choisir un niveau" placeholder) arrives as ''
// - @IsOptional() alone only skips null/undefined, so blank must be mapped
// to undefined first, meaning "leave this field unchanged".
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : value;

export class UpdateEnrollmentDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  studentId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  schoolYearId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  levelId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(EnrollmentType)
  type?: EnrollmentType;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsMongoId()
  previousEnrollmentId?: string;

  // Obligatoire pour changer la classe d'un eleve ayant deja paye (voir
  // EnrollmentsService.updateEnrollment).
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  levelChangeReason?: string;
}
