import { IsEnum } from 'class-validator';
import { Role, UserStatus } from '../../common/enums/domain.enums';

export class UpdateUserAccessDto {
  @IsEnum(Role)
  role: Role;

  @IsEnum(UserStatus)
  status: UserStatus;
}
