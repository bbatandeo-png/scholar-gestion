import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import * as nunjucks from 'nunjucks';
import { EcoleModulesService } from './ecole-modules/ecole-modules.service';
import { LicensingService } from './licensing/licensing.service';
import { SchoolYearsService } from './school-years/school-years.service';
import { ENUM_META } from './common/view-helpers/enum-meta';
import { formatAmount, formatMoney } from './common/view-helpers/format-money';
import { formatDay } from './common/view-helpers/format-day';

// Shared by main.ts and the page-crawl e2e suite, so the tests render pages
// exactly as production does (same filters, globals, menu and user context)
// instead of a hand-maintained copy that can drift.

export function configureViewEngine(
  app: NestExpressApplication,
  viewsDir: string,
) {
  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('njk');
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
  // Montants : {{ x | money }} -> "125 000 FCFA", {{ x | amount }} -> "125 000".
  nunjucksEnv.addFilter('money', (value: unknown) => formatMoney(value));
  nunjucksEnv.addFilter('amount', (value: unknown) => formatAmount(value));
  nunjucksEnv.addFilter('formatDay', (value: unknown) => formatDay(value));
  // Pied de page (partials/footer.njk) : une fonction plutot qu'une valeur
  // figee au demarrage, pour que l'annee change sans redemarrer le serveur.
  nunjucksEnv.addGlobal('currentYear', () => new Date().getFullYear());
  nunjucksEnv.addGlobal(
    'copyrightHolder',
    process.env.COPYRIGHT_HOLDER?.trim() || 'Scolar-Gestion',
  );

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

  return nunjucksEnv;
}

// Exposes the session user, flash, school-year context, active modules and
// licence status to every view, and enforces the read-only rules (historical
// year, expired licence) for write requests.
export function applyViewLocals(app: NestExpressApplication) {
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
            message: 'Cette année historique est disponible en lecture seule',
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
            discipline: openCodes.has('DISCIPLINE'),
            stock: openCodes.has('STOCK'),
            enseignants: openCodes.has('ENSEIGNANTS'),
          };
        } catch {
          res.locals.activeModules = {
            finance: false,
            bulletins: false,
            discipline: false,
            stock: false,
            enseignants: false,
          };
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
                  'La licence de cette installation a expiré - contactez le support pour la renouveler avant de pouvoir enregistrer de nouvelles données.',
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
}
