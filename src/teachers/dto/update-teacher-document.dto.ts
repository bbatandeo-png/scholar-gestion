import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTeacherDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @IsString()
  @IsNotEmpty({ message: 'Le motif de la modification est obligatoire' })
  @MaxLength(500)
  modificationReason: string;
}
