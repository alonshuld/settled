import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';

/** Fixed-window per-IP limit for public lookups (invite preview: 30/min, design §9.4). In memory, like OtpLimiter. */
@Injectable()
export class InvitePreviewLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  private readonly limit = 30;
  private readonly windowMs = 60_000;

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
      // Opportunistic cleanup keeps the map from growing without bound
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    if (++entry.count > this.limit) {
      throw new AppError('RATE_LIMITED', 429, 'Too many requests', {
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
    return true;
  }
}
