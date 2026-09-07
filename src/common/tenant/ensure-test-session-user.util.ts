import { Request } from 'express';
import { Role } from '../enums/domain.enums';

export const TEST_DEFAULT_USER_ID = '507f1f77bcf86cd799439011';
export const TEST_DEFAULT_ECOLE_ID = '507f1f77bcf86cd799439099';

/**
 * In NODE_ENV=test, fabricates a session user (and ecoleId) from the
 * x-test-role / x-test-ecole-id headers so guards/tenant scoping work
 * without going through a real /login flow. No-op outside test mode, and
 * no-op if the session already has a user (idempotent).
 */
export function ensureTestSessionUser(req: Request): void {
  if (process.env.NODE_ENV !== 'test') {
    return;
  }

  if (!req.session) {
    // Test-only fallback for a request that never went through the real
    // express-session middleware - a plain object stands in for the full
    // Session class (its .save()/.destroy()/etc methods are never used here).
    (req as unknown as { session: object }).session = {};
  }

  if (req.session.user) {
    return;
  }

  const role =
    (req.headers['x-test-role'] as Role | undefined) ?? Role.SUPER_ADMIN;
  const ecoleId =
    role === Role.PLATFORM_ADMIN
      ? null
      : ((req.headers['x-test-ecole-id'] as string | undefined) ??
        TEST_DEFAULT_ECOLE_ID);

  req.session.user = {
    id: TEST_DEFAULT_USER_ID,
    name: 'Test User',
    email: 'test@example.com',
    role,
    ecoleId,
  };
}
