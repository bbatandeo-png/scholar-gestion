import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../../common/enums/domain.enums';
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

  // Mandatory on the manual creation form (ValidationPipe enforces this on
  // the HTTP boundary) - kept optional at the TS type level only so the
  // bulk-import path (StudentsController.import, which builds this object
  // directly in code, bypassing ValidationPipe, since its Excel template has
  // no class column) is not forced to set one.
  @Transform(emptyToUndefined)
  @IsMongoId()
  levelId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => GuardianInputDto)
  guardians?: GuardianInputDto[];

  // Payment taken at the moment of creating the student's file (all
  // optional): most schools never create a student without immediately
  // enrolling and collecting something, so this lets the desk do both in one
  // step - see StudentsController.create(), which enrolls into the open
  // school year using levelId above and then records this payment, exactly
  // as EnrollmentsController.create() already does.
  @IsOptional()
  @Transform(emptyToUndefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paymentAmount?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}
