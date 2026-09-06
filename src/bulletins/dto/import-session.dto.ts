import { IsEnum } from 'class-validator';
import { BulletinImportMode } from '../../common/enums/domain.enums';

export class ImportSessionDto {
  @IsEnum(BulletinImportMode)
  mode: BulletinImportMode;
}
