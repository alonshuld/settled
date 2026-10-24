import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildOpenApi } from '../src/openapi/build';

/** Writes the OpenAPI spec the API client package is generated from. */
const out = resolve(__dirname, '../../../packages/api-client/openapi.json');
writeFileSync(out, JSON.stringify(buildOpenApi(AppModule), null, 2) + '\n');
console.log(`wrote ${out}`);
