import { NotFoundException } from '@nestjs/common';

// Distinct subclass (not a plain NotFoundException with a magic-string
// message) so FeeScheduleNotFoundFilter's @Catch() only ever intercepts
// this specific error - catching the generic NotFoundException and
// rethrowing for every other message was intercepting EVERY 404 in the
// app (receipt not found, invoice not found, ...) and rethrowing from
// inside an ExceptionFilter, which Nest does not catch the same way as a
// route handler throw, causing an unhandled rejection instead of the
// normal 404 response for all of those unrelated routes.
export class FeeScheduleNotFoundException extends NotFoundException {
  constructor() {
    super('Parametrage des frais introuvable');
  }
}
