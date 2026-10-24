import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { z } from 'zod';
import { IS_PUBLIC } from '../common/decorators';
import { getReturns } from '../common/returns';
import { ZodPipe } from '../common/zod.pipe';

/**
 * Builds the OpenAPI 3.0 spec for `/api/v1` straight from the Nest controllers (design §1, §8):
 * routes and verbs come from the decorators, request bodies and queries from the `ZodPipe` schemas
 * already used for validation, so the spec cannot drift from what the API accepts. Responses are
 * described by the `@Returns` Zod schema of each handler (io: 'output', JSON as sent on the wire).
 * Schemas registered with `.meta({ id: 'Name' })` become named `components/schemas`.
 *
 * Reads decorator metadata only: it never instantiates a module, so it needs no database or env.
 */

type Ctor = new (...args: never[]) => object;
type ModuleRef = Ctor | { module: Ctor; imports?: unknown[]; controllers?: Ctor[] };

const PATH = 'path';
const METHOD = 'method';
const HTTP_CODE = '__httpCode__';
const ROUTE_ARGS = '__routeArguments__';
// @nestjs/common RouteParamtypes
const BODY = 3;
const QUERY = 4;

const METHODS: Partial<Record<number, 'get' | 'post' | 'put' | 'patch' | 'delete'>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/** Routes that are not part of the public contract. */
const EXCLUDED = new Set(['POST /internal/cron', 'GET /healthz', 'GET /readyz']);

type Json = Record<string, unknown>;

export function collectControllers(root: ModuleRef): Ctor[] {
  const seen = new Set<unknown>();
  const found = new Set<Ctor>();
  const visit = (ref: unknown) => {
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    const dyn = ref as { module?: Ctor; imports?: unknown[]; controllers?: Ctor[] };
    const mod = (typeof ref === 'function' ? ref : dyn.module) as Ctor;
    // Async dynamic modules (logger etc.) are promises and never carry controllers
    if (typeof mod !== 'function') return;
    const imports = [...(Reflect.getMetadata('imports', mod) ?? []), ...(dyn.imports ?? [])];
    const controllers: Ctor[] = [...(Reflect.getMetadata('controllers', mod) ?? []), ...(dyn.controllers ?? [])];
    controllers.forEach((c) => found.add(c));
    imports.forEach(visit);
  };
  visit(root);
  return [...found];
}

function schemaOf(proto: object, key: string, kind: number): z.ZodType | undefined {
  const args = Reflect.getMetadata(ROUTE_ARGS, proto.constructor, key) as Record<string, { pipes: unknown[] }> | undefined;
  for (const [id, arg] of Object.entries(args ?? {})) {
    if (Number(id.split(':')[0]) !== kind) continue;
    const pipe = arg.pipes.find((p): p is ZodPipe<z.ZodType> => p instanceof ZodPipe);
    if (pipe) return (pipe as unknown as { schema: z.ZodType }).schema;
  }
  return undefined;
}

/** Named schemas (`.meta({ id })`) hoisted out of every converted schema, keyed by id. */
type Defs = Record<string, Json>;

function jsonSchema(schema: z.ZodType, defs: Defs, io: 'input' | 'output' = 'input'): Json {
  const { $schema: _ignored, $defs, definitions, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'openapi-3.0' }) as Json & {
    $defs?: Defs;
    definitions?: Defs;
  };
  for (const [id, def] of Object.entries({ ...$defs, ...definitions })) {
    const known = defs[id];
    if (known && JSON.stringify(known) !== JSON.stringify(def)) {
      throw new Error(`Two different schemas share the OpenAPI id "${id}"; ids must be unique`);
    }
    defs[id] = def;
  }
  // Named schemas are hoisted to components/schemas, so refs must point there (zod emits `definitions` or `$defs`)
  return JSON.parse(JSON.stringify(rest).replaceAll('"#/$defs/', '"#/components/schemas/').replaceAll('"#/definitions/', '"#/components/schemas/'));
}

function responseOf(handler: unknown, status: number, defs: Defs): Json {
  const meta = getReturns(handler);
  if (status === 204 || (meta && 'none' in meta)) return { description: 'No content' };
  // Routes without @Returns stay untyped (unknown) until annotated; test/returns.spec.ts lists them
  if (!meta) return { description: 'Success', content: { 'application/json': { schema: {} } } };
  return { description: 'Success', content: { 'application/json': { schema: jsonSchema(meta.schema, defs, 'output') } } };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ERROR_RESPONSE = {
  description: 'Error (design §4.4). `error.code` is stable and what clients switch on.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
};

export interface RouteInfo {
  controller: Ctor;
  key: string;
  handler: (...args: never[]) => unknown;
  verb: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express-style path under /api/v1, e.g. `/groups/:groupId` */
  route: string;
  prefix: string;
  isPublic: boolean;
  status: number;
}

/** Every public-contract route (the set the spec and the response-schema enforcement test cover). */
export function collectRoutes(root: ModuleRef): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const controller of collectControllers(root)) {
    const prefix = (Reflect.getMetadata(PATH, controller) as string | undefined) ?? '';
    const proto = controller.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      const handler = proto[key];
      if (key === 'constructor' || typeof handler !== 'function') continue;
      const verb = METHODS[Reflect.getMetadata(METHOD, handler) as number];
      if (!verb) continue;
      const sub = (Reflect.getMetadata(PATH, handler) as string | undefined) ?? '';
      const route = '/' + [prefix, sub].map((p) => p.replace(/^\/|\/$/g, '')).filter(Boolean).join('/');
      if (EXCLUDED.has(`${verb.toUpperCase()} ${route}`)) continue;
      routes.push({
        controller,
        key,
        handler: handler as RouteInfo['handler'],
        verb,
        route,
        prefix,
        isPublic: Boolean(Reflect.getMetadata(IS_PUBLIC, handler) ?? Reflect.getMetadata(IS_PUBLIC, controller)),
        status: (Reflect.getMetadata(HTTP_CODE, handler) as number | undefined) ?? (verb === 'post' ? 201 : 200),
      });
    }
  }
  return routes;
}

export function buildOpenApi(root: ModuleRef, version = '1.0.0'): Json {
  const paths: Record<string, Record<string, Json>> = {};
  const operationIds = new Set<string>();
  const defs: Defs = {};

  for (const { controller, key, handler, verb, route, prefix, isPublic, status } of collectRoutes(root)) {
    const proto = controller.prototype as object;
      const openApiPath = route.replace(/:(\w+)/g, '{$1}');
      const operationId = lowerFirst(controller.name.replace(/Controller$/, '')) + upperFirst(key);
      if (operationIds.has(operationId)) throw new Error(`Duplicate operationId ${operationId}`);
      operationIds.add(operationId);

      const parameters: Json[] = [...route.matchAll(/:(\w+)/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));

      const query = schemaOf(proto, key, QUERY);
      if (query) {
        const js = jsonSchema(query, defs) as { properties?: Record<string, Json>; required?: string[] };
        for (const [name, schema] of Object.entries(js.properties ?? {})) {
          parameters.push({ name, in: 'query', required: js.required?.includes(name) ?? false, schema });
        }
      }

      const body = schemaOf(proto, key, BODY);
      const op: Json = {
        operationId,
        tags: [prefix.split('/')[0] || 'root'],
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(body, defs) } } } } : {}),
        security: isPublic ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }],
        responses: {
          [status]: responseOf(handler, status, defs),
          default: ERROR_RESPONSE,
        },
      };
      (paths[openApiPath] ??= {})[verb] = op;
  }

  const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.0.3',
    info: {
      title: 'Settled (Shulam) API',
      version,
      description: 'Generated from the NestJS controllers. Do not edit by hand; run `pnpm --filter @settled/api openapi`.',
    },
    servers: [{ url: '/api/v1' }],
    paths: sorted,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Session token from the `set-auth-token` header of a Better Auth sign-in (mobile).' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Web: HttpOnly session cookie.' },
      },
      schemas: {
        ...Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))),
        ApiError: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'requestId'],
              properties: {
                code: { type: 'string', description: 'Stable error code, see design §4.4' },
                message: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}
