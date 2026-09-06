import { IsEnum } from 'class-validator';
import { EcoleAccountStatus } from '../../common/enums/domain.enums';

export class UpdateEcoleStatusDto {
  @IsEnum(EcoleAccountStatus)
  statutCompte: EcoleAccountStatus;
}
