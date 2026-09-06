import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import {
  FacturationMode,
  FacturationSousType,
} from '../../common/enums/domain.enums';

export class ChangeParametreFacturationDto {
  @IsEnum(FacturationMode)
  mode: FacturationMode;

  @IsOptional()
  @IsEnum(FacturationSousType)
  sousType?: FacturationSousType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  montantUnitaire: number;
}
