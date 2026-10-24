import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { z } from 'zod';
import { describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { ResponseValidationInterceptor } from '../src/common/interceptors/response-validation.interceptor';
import { getReturns, Returns } from '../src/common/returns';
import { collectRoutes } from '../src/openapi/build';

/**
 * Response-DTO enforcement: every public-contract route (the same set as the OpenAPI spec) must declare
 * `@Returns(Schema)` or `@Returns.none()`. While modules are being migrated the failure message lists the
 * routes still missing it. Flip ENFORCE to true (or delete the flag) when the last module is done.
 */
const ENFORCE = false; // TODO(response-dto): set to true once every module has @Returns

const missing = collectRoutes(AppModule)
  .filter((r) => !getReturns(r.handler))
  .map((r) => `${r.verb.toUpperCase()} ${r.route}  (${r.controller.name}.${r.key})`)
  .sort();

describe('every route declares its response schema', () => {
  (ENFORCE ? it : it.skip)('has @Returns or @Returns.none() on all routes', () => {
    expect(missing, `Routes lacking @Returns / @Returns.none():\n  ${missing.join('\n  ')}\n`).toEqual([]);
  });

  it('reports progress (not an assertion on the missing count)', () => {
    console.info(`[returns] ${missing.length} route(s) still lack @Returns`);
    expect(Array.isArray(missing)).toBe(true);
  });
});

describe('@Returns and the response validator', () => {
  const Dto = z.object({ at: z.string(), n: z.number() });
  const run = (body: unknown) => {
    class C {
      @Returns(Dto)
      h(): z.infer<typeof Dto> {
        return body as z.infer<typeof Dto>;
      }
    }
    const ctx = { getHandler: () => C.prototype.h, getClass: () => C } as unknown as ExecutionContext;
    return lastValueFrom(new ResponseValidationInterceptor(new Reflector()).intercept(ctx, { handle: () => of(body) }));
  };

  it('validates the JSON-serialized form (Date becomes an ISO string)', async () => {
    await expect(run({ at: new Date(0), n: 1 })).resolves.toBeDefined();
  });

  it('fails loudly on drift and on BigInt', async () => {
    await expect(run({ at: 'x', n: '1' })).rejects.toMatchObject({ code: 'INTERNAL', status: 500 });
    await expect(run({ at: 'x', n: 1n })).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('rejects a handler whose return type disagrees with the schema at compile time', () => {
    class C {
      // @ts-expect-error returns a number where the schema says string
      @Returns(z.object({ a: z.string() }))
      bad(): { a: number } {
        return { a: 1 };
      }
    }
    expect(C).toBeDefined();
  });
});
