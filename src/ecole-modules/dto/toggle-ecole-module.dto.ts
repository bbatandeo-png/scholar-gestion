import { IsIn, IsString } from 'class-validator';

export class ToggleEcoleModuleDto {
  @IsString()
  code: string;

  @IsIn(['true', 'false'])
  active: string;
}
