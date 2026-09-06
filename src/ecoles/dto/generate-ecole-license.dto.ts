import { IsDateString } from 'class-validator';

export class GenerateEcoleLicenseDto {
  @IsDateString()
  expiresAt: string;
}
