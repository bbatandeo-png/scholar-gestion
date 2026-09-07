import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Request, Response } from 'express';
import { FeeScheduleNotFoundException } from '../exceptions/fee-schedule-not-found.exception';

// Only ever catches FeeScheduleNotFoundException (a distinct subclass, not
// a plain NotFoundException) - every other 404 in the app falls through to
// Nest's own default handling untouched. See that exception's own comment
// for why catching the generic NotFoundException here was a real bug.
@Catch(FeeScheduleNotFoundException)
export class FeeScheduleNotFoundFilter implements ExceptionFilter {
  catch(exception: FeeScheduleNotFoundException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const message = exception.message;
    const accept = String(req.headers['accept'] || '');

    // If the client expects HTML, set a flash message and redirect to enrollments page
    if (accept.includes('text/html')) {
      if (req.session) {
        req.session.flash = {
          type: 'error',
          message:
            "Parametrage des frais introuvable pour cette classe. Veuillez configurer les frais de scolarite avant de faire l'inscription. Allez a Frais dans les parametrages.",
        };
      }
      return res.redirect('/enrollments');
    }

    // Otherwise respond with JSON as usual
    return res
      .status(404)
      .json({ statusCode: 404, message, error: 'Not Found' });
  }
}
