import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionUser } from '../types/session-user.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | undefined => {
    const req = context.switchToHttp().getRequest();
    return req.session?.user;
  },
);