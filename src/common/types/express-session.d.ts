import 'express-session';
import { SessionUser } from './session-user.type';

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    flash?: {
      type: 'success' | 'error';
      message: string;
    };
  }
}

declare global {
  namespace Express {
    interface Request {
      csrfToken?: () => string;
    }
  }
}

export {};