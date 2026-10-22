import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { setFlash } from '../utils/flash.util';

// Global catch-all filter: handles every exception that isn't already
// handled by a more specific filter. FeeScheduleNotFoundFilter only
// intercepts FeeScheduleNotFoundException, so it must be registered
// *before* this one in main.ts - Nest walks its list of global filters in
// registration order and picks the first whose @Catch() types match the
// thrown exception; this filter's bare @Catch() (no arguments) matches
// everything, so if it were registered first it would shadow every other
// filter and FeeScheduleNotFoundFilter would never run.
//
// For a normal browser navigation (Accept: text/html) this renders a
// plain, non-technical error page instead of Nest's raw JSON payload -
// previously the only thing an end user saw for any unhandled error was a
// bare JSON blob. Any other client (API call, fetch/XHR without an HTML
// Accept header) keeps getting Nest's usual JSON error shape untouched.

// A malformed id in the URL (/students/abc) makes Mongoose throw a
// CastError (or the BSON driver a BSONError) - that is a "not found", not
// a server crash.
function isInvalidIdError(exception: unknown) {
  if (!(exception instanceof Error)) {
    return false;
  }
  return (
    exception.name === 'CastError' ||
    (exception.name === 'BSONError' &&
      /hex string|ObjectId/i.test(exception.message))
  );
}

// Only a same-site path is accepted as a post-login destination, never an
// absolute URL (open redirect).
export function safeNextPath(value: unknown) {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/login') &&
    !value.startsWith('/logout')
    ? value
    : '';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const accept = String(req.headers['accept'] || '');

    const invalidId = isInvalidIdError(exception);
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : invalidId
        ? HttpStatus.NOT_FOUND
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isHttpException && !invalidId) {
      const stack = exception instanceof Error ? exception.stack : exception;
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        stack as string,
      );
    }

    // Session absente ou expiree : une page demandee par le navigateur
    // renvoie vers la connexion (puis revient sur la page demandee), au lieu
    // d'afficher le JSON brut « Authentification requise ».
    const wantsPage =
      accept.includes('text/html') ||
      (req.method === 'GET' &&
        !accept.includes('application/json') &&
        req.get?.('x-requested-with') !== 'XMLHttpRequest');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (status === HttpStatus.UNAUTHORIZED && wantsPage) {
      const next = req.method === 'GET' ? safeNextPath(req.originalUrl) : '';
      res.redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
      return;
    }

    if (accept.includes('text/html')) {
      // Une page qui n'existe pas (mauvaise adresse, identifiant invalide ou
      // supprime) : page « introuvable » plutot qu'un retour en arriere.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (status === HttpStatus.NOT_FOUND && req.method === 'GET') {
        res.status(status).render('error/generic', {
          title: 'Page introuvable',
          statusCode: status,
          isNotFound: true,
        });
        return;
      }

      // A 4xx HttpException is an expected business-rule refusal (wrong
      // role, no open school year, a duplicate email, a bad id...), not a
      // crash. Surface the real message as a flash on the page the user
      // came from, exactly like every controller's own try/catch+setFlash
      // does, rather than replacing the page with a dead-end "something
      // went wrong" screen that hides what actually needs fixing.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (isHttpException && status < HttpStatus.INTERNAL_SERVER_ERROR) {
        const responseBody = exception.getResponse();
        const message =
          typeof responseBody === 'string'
            ? responseBody
            : ((responseBody as { message?: string | string[] })?.message ??
              exception.message);
        setFlash(
          req,
          'error',
          Array.isArray(message) ? message.join(' ') : message,
        );
        res.redirect(req.get('referer') || '/dashboard');
        return;
      }

      res.status(status).render('error/generic', {
        title: 'Erreur',
        statusCode: status,
        // no-unsafe-enum-comparison and no-unnecessary-type-assertion
        // disagree on this expression's type (asserting it to `number`
        // is flagged as both required and redundant) - both sides are
        // plain numbers at runtime, so the comparison itself is safe.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        isNotFound: status === HttpStatus.NOT_FOUND,
      });
      return;
    }

    if (isHttpException) {
      const responseBody = exception.getResponse();
      res
        .status(status)
        .json(
          typeof responseBody === 'string'
            ? { statusCode: status, message: responseBody }
            : responseBody,
        );
      return;
    }

    if (invalidId) {
      res.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Ressource introuvable',
      });
      return;
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erreur interne du serveur',
    });
  }
}
