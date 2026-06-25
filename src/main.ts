import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { urlencoded } from 'express';
import methodOverride from 'method-override';
import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import csurf from 'csurf';
import { AppModule } from './app.module';
import { FeeScheduleNotFoundFilter } from './common/filters/fee-schedule-not-found.filter';
import { SessionUser } from './common/types/session-user.type';

function resolveExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/schoolar';
  const isTest = process.env.NODE_ENV === 'test';

  const isPkgRuntime = Boolean((process as any).pkg);
  const runtimeRoot = isPkgRuntime ? path.dirname(process.execPath) : process.cwd();
  const viewsDir = resolveExistingPath([
    path.join(runtimeRoot, 'views'),
    path.join(process.cwd(), 'dist', 'views'),
    path.join(process.cwd(), 'src', 'views'),
  ]);
  const publicDir = resolveExistingPath([
    path.join(runtimeRoot, 'public'),
    path.join(process.cwd(), 'dist', 'public'),
    path.join(process.cwd(), 'public'),
  ]);

  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('njk');
  app.useStaticAssets(publicDir);
  nunjucks.configure(viewsDir, {
    autoescape: true,
    express: app.getHttpAdapter().getInstance(),
    noCache: true,
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

  if (!isTest) {
    app.use(csurf());
  }

  app.use((req, res, next) => {
    const flash = req.session?.flash;
    const user = req.session?.user as SessionUser | undefined;

    res.locals.currentUser = user;
    res.locals.flash = flash;
    res.locals.currentPath = req.path;
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';

    if (req.session) {
      delete (req.session as any).flash;
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

  // Global filter to present a friendly message when fee schedule is missing
  app.useGlobalFilters(new FeeScheduleNotFoundFilter());

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
