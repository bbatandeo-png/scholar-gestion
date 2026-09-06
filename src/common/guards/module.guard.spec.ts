import { ForbiddenException } from '@nestjs/common';
import { ModuleGuard } from './module.guard';

function buildContext(req: Record<string, unknown>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('ModuleGuard', () => {
  it('passe si aucune metadonnee @RequireModule presente', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const ecoleModulesService = { isActive: jest.fn() };
    const guard = new ModuleGuard(reflector as any, ecoleModulesService as any);

    const result = await guard.canActivate(
      buildContext({ method: 'POST', session: { user: { ecoleId: 'e1' } } }),
    );

    expect(result).toBe(true);
    expect(ecoleModulesService.isActive).not.toHaveBeenCalled();
  });

  it('laisse toujours passer une lecture (GET), module actif ou non', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('FINANCE'),
    };
    const ecoleModulesService = {
      isActive: jest.fn().mockResolvedValue(false),
    };
    const guard = new ModuleGuard(reflector as any, ecoleModulesService as any);

    const result = await guard.canActivate(
      buildContext({ method: 'GET', session: { user: { ecoleId: 'e1' } } }),
    );

    expect(result).toBe(true);
    expect(ecoleModulesService.isActive).not.toHaveBeenCalled();
  });

  it('laisse passer une ecriture quand le module est actif', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('FINANCE'),
    };
    const ecoleModulesService = { isActive: jest.fn().mockResolvedValue(true) };
    const guard = new ModuleGuard(reflector as any, ecoleModulesService as any);

    const result = await guard.canActivate(
      buildContext({ method: 'POST', session: { user: { ecoleId: 'e1' } } }),
    );

    expect(result).toBe(true);
    expect(ecoleModulesService.isActive).toHaveBeenCalledWith('e1', 'FINANCE');
  });

  it('bloque une ecriture quand le module est inactif', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('FINANCE'),
    };
    const ecoleModulesService = {
      isActive: jest.fn().mockResolvedValue(false),
    };
    const guard = new ModuleGuard(reflector as any, ecoleModulesService as any);

    await expect(
      guard.canActivate(
        buildContext({ method: 'POST', session: { user: { ecoleId: 'e1' } } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('laisse toujours passer une session sans ecoleId (PLATFORM_ADMIN), sans appeler isActive', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('FINANCE'),
    };
    const ecoleModulesService = { isActive: jest.fn() };
    const guard = new ModuleGuard(reflector as any, ecoleModulesService as any);

    const result = await guard.canActivate(
      buildContext({ method: 'POST', session: { user: { ecoleId: null } } }),
    );

    expect(result).toBe(true);
    expect(ecoleModulesService.isActive).not.toHaveBeenCalled();
  });
});
