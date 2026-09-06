import { IsOptional, IsString } from 'class-validator';

export class GenererFactureDto {
  @IsString()
  periode: string;

  @IsOptional()
  @IsString()
  classeId?: string;
}
