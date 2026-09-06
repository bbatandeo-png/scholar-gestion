import { NextFunction, Request, Response } from 'express';

/**
 * A stale/expired session (e.g. a browser tab left open past the session
 * maxAge) carries a csrfToken that no longer matches the server-side
 * secret. Without this handler, csurf's rejection bubbles up as an
 * unhandled EBADCSRFTOKEN error (raw 403 crash) - including on /logout,
 * which would trap the user in a session they can't get out of. Destroy
 * whatever session remains and send them back to /login instead.
 */
export function csrfErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    err &&
    typeof err === 'object' &&
    (err as { code?: string }).code === 'EBADCSRFTOKEN'
  ) {
    req.session?.destroy(() => {
      res.redirect('/login');
    });
    return;
  }

  next(err);
}
