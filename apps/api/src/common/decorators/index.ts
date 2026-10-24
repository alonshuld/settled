import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'isPublic';
/** Opts a route out of the global SessionGuard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  isAnonymous: boolean;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  return (ctx.switchToHttp().getRequest<Request & { user: SessionUser }>()).user;
});
