import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentEcole = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const req = context.switchToHttp().getRequest();
    return req.session?.user?.ecoleId ?? null;
  },
);
