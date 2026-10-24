import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { IS_PUBLIC } from '../decorators';
import { AppError } from '../errors';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const session = await this.authService.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      // A credential was sent but is no longer valid: tell the client to sign in again.
      const sentCredential = Boolean(req.headers.authorization || req.headers.cookie?.includes('session_token'));
      throw new AppError(sentCredential ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED', 401);
    }
    const u = session.user as { id: string; name: string; email?: string | null; isAnonymous?: boolean | null };
    req.user = { id: u.id, name: u.name, email: u.isAnonymous ? null : (u.email ?? null), isAnonymous: Boolean(u.isAnonymous) };
    return true;
  }
}
