import './bootstrap-polyfills';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { NextFunction, Request, Response, urlencoded } from 'express';
import methodOverride from 'method-override';
import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import csurf from 'csurf';
import { AppModule } from './app.module';
import { FeeScheduleNotFoundFilter } from './common/filters/fee-schedule-not-found.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { runSeed, shouldRunSeed } from './scripts/seed';
import { SchoolYearsService } from './school-years/school-years.service';
import { applyTenantMiddleware } from './common/tenant/apply-tenant-middleware';
import { csrfErrorHandler } from './common/middleware/csrf-error-handler';
import { EcoleModulesService } from './ecole-modules/ecole-modules.service';
import { LicensingService } from './licensing/licensing.service';
import { ENUM_META } from './common/view-helpers/enum-meta';
import {
  getRuntimeRoot,
  getUploadsRoot,
  isPkgRuntime,
} from './common/utils/runtime-paths.util';
import { multipartUpload } from './common/utils/multer.util';
import { ensureReplicaSetReady } from './common/utils/replica-set-setup.util';

function resolveExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function bootstrap() {
  const mongoUri =
    process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/schoolar';
  const isTest = process.env.NODE_ENV === 'test';

  await ensureReplicaSetReady(mongoUri);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const runtimeRoot = getRuntimeRoot();
  const viewsDir = resolveExistingPath([
    path.join(runtimeRoot, 'views'),
    // dist/views sits next to this compiled file (dist/main.js) both when
    // run as `node dist/main` and inside a pkg exe's virtual snapshot - in
    // dev (ts-node running src/main.ts in place) this resolves to
    // src/views instead, so it works unmodified in all three run modes.
    path.join(__dirname, 'views'),
    path.join(process.cwd(), 'dist', 'views'),
    path.join(process.cwd(), 'src', 'views'),
  ]);
  const publicDir = resolveExistingPath([
    path.join(runtimeRoot, 'public'),
    path.join(__dirname, 'public'),
    path.join(process.cwd(), 'dist', 'public'),
    path.join(process.cwd(), 'public'),
  ]);
  // Always a real, writable directory (never part of pkg's read-only
  // snapshot) - holds files created at runtime, e.g. uploaded ecole logos.
  const uploadsDir = getUploadsRoot();
  fs.mkdirSync(uploadsDir, { recursive: true });

  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('njk');
  app.useStaticAssets(publicDir);
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });
  const nunjucksEnv = nunjucks.configure(viewsDir, {
    autoescape: true,
    express: app.getHttpAdapter().getInstance(),
    noCache: true,
  });

  nunjucksEnv.addFilter('formatDate', (value: unknown) => {
    if (!value) {
      return '';
    }

    const date =
      value instanceof Date ? value : new Date(value as string | number);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleString('fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
  });

  nunjucksEnv.addGlobal('ENUM_META', ENUM_META);

  nunjucksEnv.addFilter('inputDate', (value: unknown) => {
    if (!value) {
      return '';
    }

    const date =
      value instanceof Date ? value : new Date(value as string | number);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toISOString().slice(0, 10);
  });

  app.use(cookieParser());
  app.use(urlencoded({ extended: true }));
  app.use(methodOverride('_method'));

  const sessionOptions: session.SessionOptions = {
    secret: process.env.SESSION_SECRET ?? 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
    },
  };

  if (!isTest) {
    sessionOptions.store = MongoStore.create({
      mongoUrl: mongoUri,
      collectionName: 'sessions',
    });
  }

  app.use(session(sessionOptions));

  // Must run before csurf() - see multer.util.ts's comment on why a
  // multipart/form-data request (any file upload form) needs its body
  // parsed here first, or csurf can never find the CSRF token and every
  // such submission gets treated as a forged/stale request.
  // multipartUpload is deliberately untyped (require('multer'), no
  // @types/multer installed - see multer.util.ts's own comment on why).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/platform/ecoles', multipartUpload.any());
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/students', multipartUpload.any());

  if (!isTest) {
    app.use(csurf());
    app.use(csrfErrorHandler);
  }

  applyTenantMiddleware(app);

  const schoolYearsService = app.get(SchoolYearsService);
  const ecoleModulesService = app.get(EcoleModulesService);
  const licensingService = app.get(LicensingService);
  const LICENSE_WRITE_ALLOWLIST = ['/licence', '/logout'];
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const flash = req.session?.flash;
    const user = req.session?.user;

    res.locals.currentUser = user;
    res.locals.flash = flash;
    res.locals.currentPath = req.path;
    res.locals.csrfToken =
      typeof req.csrfToken === 'function' ? req.csrfToken() : '';

    if (user) {
      try {
        const [schoolYears, openSchoolYear, selectedSchoolYear] =
          await Promise.all([
            schoolYearsService.list(),
            schoolYearsService.findOpen(),
            schoolYearsService.resolveSelected(
              req.session.selectedSchoolYearId,
            ),
          ]);
        res.locals.schoolYearContext = {
          years: schoolYears,
          open: openSchoolYear,
          selected: selectedSchoolYear,
          isHistorical:
            Boolean(openSchoolYear) &&
            String(openSchoolYear?._id) !== String(selectedSchoolYear?._id),
        };
        if (
          res.locals.schoolYearContext.isHistorical &&
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
          !['/settings/school-years/select', '/logout'].includes(req.path)
        ) {
          req.session.flash = {
            type: 'error',
            message: 'Cette annee historique est disponible en lecture seule',
          };
          return res.redirect(req.get('referer') || '/dashboard');
        }
      } catch {
        res.locals.schoolYearContext = {
          years: [],
          open: null,
          selected: null,
          isHistorical: false,
        };
      }

      if (user.ecoleId) {
        try {
          const openModules = await ecoleModulesService.listForEcole(
            user.ecoleId,
          );
          const openCodes = new Set(openModules.map((m) => m.code));
          res.locals.activeModules = {
            finance: openCodes.has('FINANCE'),
            bulletins: openCodes.has('BULLETINS'),
          };
        } catch {
          res.locals.activeModules = { finance: false, bulletins: false };
        }

        // Off by default: LICENSE_ENFORCEMENT must be explicitly set to 'on'
        // in a given install's .env for the licence system to check/block
        // anything there. Lets the licensing code ship to every client
        // (including ones already deployed) without switching any of them
        // over before it's actually decided per-client - flip this one
        // variable later when ready to turn it on for a given school.
        if (process.env.LICENSE_ENFORCEMENT === 'on') {
          res.locals.licenseEnforcementEnabled = true;
          try {
            const licenseStatus = await licensingService.getStatus(
              user.ecoleId,
            );
            res.locals.licenseStatus = licenseStatus;

            const isWriteMethod = !['GET', 'HEAD', 'OPTIONS'].includes(
              req.method,
            );
            const isAllowlisted = LICENSE_WRITE_ALLOWLIST.some((prefix) =>
              req.path.startsWith(prefix),
            );
            if (
              licenseStatus.state === 'blocked' &&
              isWriteMethod &&
              !isAllowlisted
            ) {
              req.session.flash = {
                type: 'error',
                message:
                  'La licence de cette installation a expire - contactez le support pour la renouveler avant de pouvoir enregistrer de nouvelles donnees.',
              };
              return res.redirect('/licence');
            }
          } catch {
            res.locals.licenseStatus = null;
          }
        } else {
          res.locals.licenseEnforcementEnabled = false;
          res.locals.licenseStatus = null;
        }
      } else {
        // PLATFORM_ADMIN or any session with no ecole - not applicable.
        res.locals.activeModules = null;
        res.locals.licenseStatus = null;
      }
    }

    if (req.session) {
      delete req.session.flash;
    }

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  // Global filters, most specific first: Nest picks the first bound filter
  // whose @Catch() types match the thrown exception, so FeeScheduleNotFoundFilter
  // (narrow) must come before HttpExceptionFilter (catch-all) or the latter
  // would shadow it entirely - see HttpExceptionFilter's own comment.
  app.useGlobalFilters(
    new FeeScheduleNotFoundFilter(),
    new HttpExceptionFilter(),
  );

  if (shouldRunSeed()) {
    await runSeed();
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  // Only for the packaged exe double-clicked by a non-technical user - not
  // during `npm run start:dev` (would reopen a tab on every watch restart)
  // nor `node dist/main`/tests. `start ""` opens the URL with whatever the
  // OS considers the default handler, exactly like double-clicking a link -
  // if no default browser is configured, Windows itself shows its native
  // "how do you want to open this" picker, so there is no separate chooser
  // dialog to build. Best-effort only: if it fails, the user can still type
  // the URL manually as before this existed.
  if (isPkgRuntime()) {
    exec(`start "" "http://127.0.0.1:${port}/login"`, () => {});
  }
}

void bootstrap();
