import './bootstrap-polyfills';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { urlencoded } from 'express';
import methodOverride from 'method-override';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import csurf from 'csurf';
import { AppModule } from './app.module';
import { applyViewLocals, configureViewEngine } from './app-setup';
import { FeeScheduleNotFoundFilter } from './common/filters/fee-schedule-not-found.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { runSeed, shouldRunSeed } from './scripts/seed';
import { applyTenantMiddleware } from './common/tenant/apply-tenant-middleware';
import { noStore } from './common/middleware/no-store';
import { csrfErrorHandler } from './common/middleware/csrf-error-handler';
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
  // The public marketing site (separate static HTML/CSS/JS, not part of the
  // backoffice's own views) - served here so the backoffice can link to it
  // without needing separate hosting.
  const siteVitrineDir = resolveExistingPath([
    path.join(runtimeRoot, 'site-vitrine'),
    path.join(__dirname, 'site-vitrine'),
    path.join(process.cwd(), 'dist', 'site-vitrine'),
    path.join(process.cwd(), 'site-vitrine'),
  ]);
  // Always a real, writable directory (never part of pkg's read-only
  // snapshot) - holds files created at runtime, e.g. uploaded ecole logos.
  const uploadsDir = getUploadsRoot();
  fs.mkdirSync(uploadsDir, { recursive: true });

  app.useStaticAssets(publicDir);
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });
  app.useStaticAssets(siteVitrineDir, { prefix: '/vitrine' });
  // After the static mounts on purpose: assets keep caching, pages do not.
  app.use(noStore);
  configureViewEngine(app, viewsDir);

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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/bulletins', multipartUpload.any());
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/promotions', multipartUpload.any());
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/settings/fees', multipartUpload.any());
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/teachers', multipartUpload.any());
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/enrollments', multipartUpload.any());

  if (!isTest) {
    app.use(csurf());
    app.use(csrfErrorHandler);
  }

  applyTenantMiddleware(app);

  applyViewLocals(app);

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
