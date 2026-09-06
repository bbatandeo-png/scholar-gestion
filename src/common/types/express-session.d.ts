import 'express-session';
import { SessionUser } from './session-user.type';

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    flash?: {
      type: 'success' | 'error';
      message: string;
    };
    // One-time reveal of a newly generated admin password (see
    // EcolesController.create/index) - consumed and deleted by the very
    // next page render, same lifecycle as `flash`.
    lastCreatedCredentials?: {
      email: string;
      tempPassword: string;
    };
    selectedSchoolYearId?: string;
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
