import { NextFunction, Request, Response } from 'express';

/**
 * Every page past the static-asset mounts is dynamic and per-user (lists,
 * details, exports). Without an explicit policy a browser may re-show its
 * cached copy on Back / a link back to a list, so a change just saved
 * elsewhere only appears after a manual reload. `no-store` forces a fresh
 * request each time. Register it after the static-asset middleware so CSS/JS/
 * images keep their normal caching.
 */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
