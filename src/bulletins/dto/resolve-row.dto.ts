import { IsMongoId } from 'class-validator';

export class ResolveRowDto {
  @IsMongoId()
  studentId: string;
}
