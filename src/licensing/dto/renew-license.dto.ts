import { IsNotEmpty, IsString } from 'class-validator';

export class RenewLicenseDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}
