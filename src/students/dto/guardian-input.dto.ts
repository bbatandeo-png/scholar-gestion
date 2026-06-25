import { IsEnum, IsOptional, IsString } from 'class-validator';
import { GuardianType } from '../../common/enums/domain.enums';

export class GuardianInputDto {
  @IsEnum(GuardianType)
  type: GuardianType;

  @IsOptional()
  @IsString()
  fullname?: string;

  @IsOptional()
  @IsString()
  lastname?: string;

  @IsOptional()
  @IsString()
  firstname?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}