import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TerminateTeacherContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
