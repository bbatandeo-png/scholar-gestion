import { ExceptionFilter, Catch, ArgumentsHost, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(NotFoundException)
export class FeeScheduleNotFoundFilter implements ExceptionFilter {
  catch(exception: NotFoundException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const message = (exception && (exception as any).message) || '';

    if (message === 'Parametrage des frais introuvable') {
      const accept = String(req.headers['accept'] || '');

      // If the client expects HTML, set a flash message and redirect to enrollments page
      if (accept.includes('text/html')) {
        if (req.session) {
          (req.session as any).flash = {
            type: 'error',
            message: 'Parametrage des frais introuvable pour cette classe. Veuillez configurer les frais de scolarite avant de faire l\'inscription. Allez a Frais dans les parametrages.',
          };
        }
        return res.redirect('/enrollments');
      }

      // Otherwise respond with JSON as usual
      return res.status(404).json({ statusCode: 404, message, error: 'Not Found' });
    }

    // Not the fee-schedule error - rethrow so Nest handles it normally
    throw exception;
  }
}
