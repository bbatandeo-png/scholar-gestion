import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditAction, Role, UserStatus } from '../common/enums/domain.enums';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { EcolesService } from '../ecoles/ecoles.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly ecolesService: EcolesService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte desactive');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (user.role !== Role.PLATFORM_ADMIN && user.ecoleId) {
      const suspended = await this.ecolesService.isSuspended(
        String(user.ecoleId),
      );
      if (suspended) {
        throw new UnauthorizedException('Compte de l ecole suspendu');
      }
    }

    await this.auditService.log({
      actorId: String(user._id),
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: String(user._id),
      details: { email: user.email },
    });

    return user;
  }
}
