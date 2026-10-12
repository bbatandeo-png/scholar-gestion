import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeacherDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;
}
