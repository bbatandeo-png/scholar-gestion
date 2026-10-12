import {
  IsBooleanString,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EnrollmentType, PaymentMethod } from '../../common/enums/domain.enums';

// A blank form field arrives as '' - @IsOptional() only skips null/undefined.
function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

export class CreateEnrollmentDto {
  @IsMongoId()
  studentId: string;

  @IsMongoId()
  schoolYearId: string;

  @IsMongoId()
  levelId: string;

  @IsEnum(EnrollmentType)
  type: EnrollmentType;

  @IsOptional()
  @IsMongoId()
  previousEnrollmentId?: string;

  @IsOptional()
  @IsBooleanString()
  applyOpenArrears?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discountAmount?: number;

  // Payment taken at the moment of enrolling (all optional): recorded right
  // after the enrollment, exactly as a payment made later from the invoice.
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
