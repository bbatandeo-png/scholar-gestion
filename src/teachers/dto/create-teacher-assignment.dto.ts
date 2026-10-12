import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { toOptionalInt } from './dto-transforms.util';

// A native <select multiple> submits the field as a plain string (not an
// array) when exactly one option is selected, and as an array only with two
// or more - qs/body-parser never wraps a lone value. Must be normalized
// before @IsArray() ever sees it, or picking a single classe would always
// fail validation.
function toArray({ value }: { value: unknown }): unknown {
  if (value === undefined || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toOptionalBoolean({ value }: { value: unknown }): boolean {
  return value === 'true' || value === 'on' || value === true;
}

// No schoolYearId here on purpose: the assignment is always recorded
// against the school's one OPEN year, resolved server-side in
// TeachersController.createAssignment() (requireOpen(), not a client-chosen
// value) - same rule as CreateDisciplineRecordDto.
export class CreateTeacherAssignmentDto {
  // Plusieurs classes a la fois (un enseignant intervient souvent dans
  // plusieurs classes) - une ligne TeacherAssignment est creee par classe
  // choisie, voir TeachersService.createAssignments.
  @Transform(toArray)
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  levelIds: string[];

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
}
