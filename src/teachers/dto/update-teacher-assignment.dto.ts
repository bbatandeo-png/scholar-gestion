import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { toOptionalInt } from './dto-transforms.util';

function toOptionalBoolean({ value }: { value: unknown }): boolean {
  return value === 'true' || value === 'on' || value === true;
}

export class UpdateTeacherAssignmentDto {
  @IsMongoId()
  subjectId: string;

  @Transform(toOptionalInt)
  @IsNumber()
  @Min(0)
  hoursPerWeek: number;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isTitulaire?: boolean;

  @IsString()
  @IsNotEmpty({ message: 'Le motif de la modification est obligatoire' })
  @MaxLength(500)
  modificationReason: string;
}
