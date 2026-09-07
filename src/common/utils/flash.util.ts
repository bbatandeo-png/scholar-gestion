import { Request } from 'express';

export function setFlash(
  req: Request,
  type: 'success' | 'error',
  message: string,
) {
  if (req.session) {
    req.session.flash = { type, message };
  }
}
