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
    // Populated by the res.locals middleware in main.ts, read back by the
    // Nunjucks views (layout.njk et al.) - typed here so that same
    // middleware doesn't have to treat res.locals as an untyped bag.
    interface Locals {
      currentUser?: SessionUser;
      flash?: { type: 'success' | 'error'; message: string };
      currentPath?: string;
      csrfToken?: string;
      schoolYearContext?: {
        years: unknown[];
        open: unknown;
        selected: unknown;
        isHistorical: boolean;
      };
      activeModules?: { finance: boolean; bulletins: boolean } | null;
      licenseEnforcementEnabled?: boolean;
      licenseStatus?: unknown;
    }
  }
}

export {};
