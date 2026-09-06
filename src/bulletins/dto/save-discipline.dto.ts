import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SaveDisciplineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  retards?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  absences?: number;

  @IsOptional()
  @IsString()
  exclusion?: string;

  @IsOptional()
  @IsString()
  decisionConseil?: string;
}
