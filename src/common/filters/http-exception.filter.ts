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
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const accept = String(req.headers['accept'] || '');

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isHttpException) {
      const stack = exception instanceof Error ? exception.stack : exception;
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        stack as string,
      );
    }

    if (accept.includes('text/html')) {
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

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
