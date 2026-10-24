import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { from, map, Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionUser } from '../decorators';
import { AppError } from '../errors';

const HTTP_CODE_METADATA = '__httpCode__';

/**
 * Creating endpoints accept an `Idempotency-Key` header (design §4.5). A repeat with the same key by the
 * same user returns the original response instead of creating a duplicate. Keys are kept for 24h.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  /** A second request with a key that is still running waits for the first one (single process in v1). */
  private readonly running = new Map<string, Promise<{ status: number; body: unknown }>>();

  constructor(private readonly prisma: PrismaService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { user?: SessionUser }>();
    const res = http.getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key || !req.user) return next.handle();
    if (key.length > 128) throw new AppError('VALIDATION_FAILED', 400, 'Idempotency-Key is too long');

    const route = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
    const send = map((r: { status: number; body: unknown }) => {
      res.status(r.status);
      return r.body;
    });
    const mapKey = `${req.user.id}:${key}`;

    const stored = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: req.user.id, key } } });
    if (stored) {
      if (stored.route !== route) throw new AppError('VALIDATION_FAILED', 400, 'Idempotency-Key was used for another request');
      return from(Promise.resolve({ status: stored.statusCode, body: stored.response })).pipe(send);
    }

    const inflight = this.running.get(mapKey);
    if (inflight) return from(inflight).pipe(send);

    const status = Reflect.getMetadata(HTTP_CODE_METADATA, ctx.getHandler()) ?? (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
    const userId = req.user.id;
    const run = (async () => {
      const body = await new Promise<unknown>((resolve, reject) => {
        next.handle().subscribe({ next: resolve, error: reject });
      });
      await this.prisma.idempotencyKey
        .create({ data: { key, userId, route, statusCode: status, response: (body ?? null) as Prisma.InputJsonValue } })
        .catch(() => undefined); // lost a race with the same key: the first response stays
      return { status, body };
    })().finally(() => this.running.delete(mapKey));
    this.running.set(mapKey, run);
    return from(run).pipe(send);
  }
}
