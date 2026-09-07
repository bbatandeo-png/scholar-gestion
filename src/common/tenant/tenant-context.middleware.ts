import { Request, Response, NextFunction } from 'express';
import { Role } from '../enums/domain.enums';
import { tenantStorage } from './tenant-context';

export function tenantContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.session?.user;

  tenantStorage.run(
    {
      userId: user?.id,
      role: user?.role,
      ecoleId: user?.ecoleId ?? null,
      bypass: user?.role === Role.PLATFORM_ADMIN,
    },
    next,
  );
}
