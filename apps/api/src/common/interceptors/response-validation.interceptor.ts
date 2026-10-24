import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { z } from 'zod';
import { AppError } from '../errors';
import { RETURNS, ReturnsMeta } from '../returns';

/**
 * Dev/test only (registered in AppModule when NODE_ENV is not `production`): parses every response with the
 * route's `@Returns` schema and answers 500 INTERNAL when they disagree, so a schema can never lie about
 * what the API sends. The body is validated in its JSON-serialized form (what Express puts on the wire), so
 * `Date` becomes an ISO string, Prisma `Decimal` a string, and a leaked `BigInt` fails loudly.
 */
@Injectable()
export class ResponseValidationInterceptor implements NestInterceptor {
  private readonly log = new Logger('ResponseValidation');

  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<ReturnsMeta | undefined>(RETURNS, ctx.getHandler());
    if (!meta || 'none' in meta) return next.handle();
    const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;

    return next.handle().pipe(
      map((body) => {
        let wire: unknown;
        try {
          // Same serialization Express applies; undefined (no body) stays undefined
          wire = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
        } catch (e) {
          return this.fail(route, `response is not JSON-serializable: ${(e as Error).message}`);
        }
        const parsed = meta.schema.safeParse(wire);
        if (!parsed.success) return this.fail(route, z.prettifyError(parsed.error));
        return body;
      }),
    );
  }

  private fail(route: string, detail: string): never {
    this.log.error(`Response of ${route} does not match its @Returns schema:\n${detail}`);
    throw new AppError('INTERNAL', 500, `Response of ${route} does not match its @Returns schema`);
  }
}
