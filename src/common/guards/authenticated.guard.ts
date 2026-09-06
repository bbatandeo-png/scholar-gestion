import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ensureTestSessionUser } from '../tenant/ensure-test-session-user.util';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    if (req.session?.user) {
      return true;
    }

    if (process.env.NODE_ENV === 'test') {
      ensureTestSessionUser(req);
      return true;
    }

    throw new UnauthorizedException('Authentification requise');
  }
}
