import { INestApplication } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ensureTestSessionUser } from './ensure-test-session-user.util';
import { tenantContextMiddleware } from './tenant-context.middleware';

/**
 * Registers the tenant-scoping middleware chain on an app instance. Used by
 * both main.ts (production bootstrap) and e2e test setup, so a test app
 * built via Test.createTestingModule().createNestApplication() - which does
 * NOT replay main.ts's own app.use() calls - gets the same tenant context
 * wiring a real request would go through.
 */
export function applyTenantMiddleware(app: INestApplication): void {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    ensureTestSessionUser(req);
    next();
  });
  app.use(tenantContextMiddleware);
}
