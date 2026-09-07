import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { SessionUser } from '../types/session-user.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | undefined => {
    const req = context.switchToHttp().getRequest<Request>();
    return req.session?.user;
  },
);
