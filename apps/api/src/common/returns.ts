import { SetMetadata } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Response contract of a route (design "Response DTOs"). The Zod schema describes the JSON exactly as it
 * goes on the wire: dates are ISO strings (never `Date`), money is integer minor units, absent values are
 * `null` or an optional key as the schema says. It feeds three things:
 *  - the OpenAPI spec (`openapi/build.ts`), so the generated client has real response types;
 *  - the compile-time check below, so a handler cannot return a different shape than it declares;
 *  - the dev/test response validator (`ResponseValidationInterceptor`), so the schema cannot lie at runtime.
 *
 * Usage (the handler's return type is checked against the schema, a mismatch does not compile):
 *
 *   @Returns(GroupDto)
 *   @Get(':groupId')
 *   async get(...): Promise<GroupDto> { return this.groups.get(...); }
 *
 * where `GroupDto` is both the schema const and `export type GroupDto = z.infer<typeof GroupDto>`.
 * Routes with no body (204) use `@Returns.none()`.
 */
export const RETURNS = 'settled:returns';

export type ReturnsMeta = { schema: z.ZodType } | { none: true };

type Handler<T> = (...args: never[]) => T | Promise<T>;

/** Method decorator; TS rejects it when the method's return type is not assignable to `z.output<S>`. */
export function Returns<S extends z.ZodType>(schema: S) {
  return <F extends Handler<z.output<S>>>(target: object, key: string | symbol, descriptor: TypedPropertyDescriptor<F>): void => {
    SetMetadata(RETURNS, { schema } satisfies ReturnsMeta)(target, key, descriptor as PropertyDescriptor);
  };
}

/** For routes that send no body (204). The handler must return `void`. */
Returns.none = () => {
  return <F extends Handler<void>>(target: object, key: string | symbol, descriptor: TypedPropertyDescriptor<F>): void => {
    SetMetadata(RETURNS, { none: true } satisfies ReturnsMeta)(target, key, descriptor as PropertyDescriptor);
  };
};

/** Reads the metadata from a controller handler. */
export function getReturns(handler: unknown): ReturnsMeta | undefined {
  return Reflect.getMetadata(RETURNS, handler as object) as ReturnsMeta | undefined;
}
