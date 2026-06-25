import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateLevelDto {
  @IsString()
  code: string;

  @IsString()
  label: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder: number;
}