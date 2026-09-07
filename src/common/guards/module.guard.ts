import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { EcoleModulesService } from '../../ecole-modules/ecole-modules.service';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ecoleModulesService: EcoleModulesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!code) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();

    // Read-only after deactivation: a deactivated module freezes further
    // writes but never hides/destroys already-entered data, so GET/HEAD
    // never gets blocked here regardless of module state.
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return true;
    }

    const ecoleId = req.session?.user?.ecoleId;
    if (!ecoleId) {
      // PLATFORM_ADMIN (or any session with no ecole) is not subject to
      // per-ecole module gating - not applicable, not a bypass to abuse.
      return true;
    }

    const active = await this.ecoleModulesService.isActive(ecoleId, code);
    if (!active) {
      throw new ForbiddenException(
        `Le module ${code} est desactive pour cette ecole`,
      );
    }

    return true;
  }
}
