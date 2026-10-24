import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { buildOpenApi } from '../src/openapi/build';

describe('OpenAPI contract', () => {
  const committed = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/api-client/openapi.json'), 'utf8'));
  const spec = buildOpenApi(AppModule) as { paths: Record<string, Record<string, { security: unknown[]; requestBody?: unknown }>> };

  it('matches packages/api-client/openapi.json (run `pnpm --filter @settled/api openapi` after changing routes)', () => {
    expect(spec).toEqual(committed);
  });

  it('keeps internal routes out, marks public routes, and types request bodies', () => {
    expect(Object.keys(spec.paths).some((p) => p.startsWith('/internal') || p.includes('healthz'))).toBe(false);
    expect(spec.paths['/config']!.get!.security).toEqual([]);
    expect(spec.paths['/me']!.get!.security).toHaveLength(2);
    expect(spec.paths['/groups/{groupId}/expenses']!.post!.requestBody).toBeDefined();
  });
});
