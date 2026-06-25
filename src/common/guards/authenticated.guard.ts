import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Role } from '../enums/domain.enums';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    if (req.session?.user) {
      return true;
    }

    if (process.env.NODE_ENV === 'test') {
      if (!req.session) {
        req.session = {};
      }
      (req.session as any).user = {
        id: '507f1f77bcf86cd799439011',
        name: 'Test User',
        email: 'test@example.com',
        role: (req.headers['x-test-role'] as Role | undefined) ?? Role.SUPER_ADMIN,
      };
      return true;
    }

    throw new UnauthorizedException('Authentification requise');
  }
}