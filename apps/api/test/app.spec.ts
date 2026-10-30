import 'reflect-metadata';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SplitError } from '@settled/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { AppError } from '../src/common/errors';
import { emailEnabled, validateEnv } from '../src/config/env';
import { configureApp } from '../src/setup';
import { Public } from '../src/common/decorators';

@Public()
@Controller('boom')
class BoomController {
  @Get('app')
  app() {
    throw new AppError('GROUP_CLOSED', 409, 'closed', { groupId: 'g1' });
  }
  @Get('split')
  split() {
    throw new SplitError('SPLIT_SUM_MISMATCH', 'nope', { expected: 2, actual: 1 });
  }
  @Get('crash')
  crash() {
    throw new Error('secret internals');
  }
}

describe('app', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule], controllers: [BoomController] }).compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /healthz', async () => {
    await request(app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' });
  });

  it('GET /readyz hits the database', async () => {
    await request(app.getHttpServer()).get('/readyz').expect(200, { status: 'ready' });
  });

  it('wraps AppError in the envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/app').set('x-request-id', 'req_1').expect(409);
    expect(res.body).toEqual({
      error: { code: 'GROUP_CLOSED', message: 'closed', details: { groupId: 'g1' }, requestId: 'req_1' },
    });
  });

  it('maps SplitError to 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/split').expect(400);
    expect(res.body.error).toMatchObject({ code: 'SPLIT_SUM_MISMATCH', details: { expected: 2, actual: 1 } });
  });

  it('maps unknown route to NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('hides internals on crash', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/crash').expect(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL', message: 'Internal server error' });
  });
});

describe('env', () => {
  it('rejects a short CRON_SECRET', () => {
    expect(() => validateEnv({ DATABASE_URL: 'x', CRON_SECRET: 'short', BETTER_AUTH_SECRET: 'a'.repeat(32) })).toThrow(/CRON_SECRET/);
  });
  it('defaults phone OTP off', () => {
    expect(validateEnv({ DATABASE_URL: 'x', CRON_SECRET: 'a'.repeat(16), BETTER_AUTH_SECRET: 'a'.repeat(32) }).AUTH_PHONE_OTP_ENABLED).toBe(false);
  });
  it('turns email off in production without Resend', () => {
    expect(emailEnabled({ NODE_ENV: 'production', RESEND_API_KEY: undefined })).toBe(false);
    expect(emailEnabled({ NODE_ENV: 'production', RESEND_API_KEY: 're_x' })).toBe(true);
    expect(emailEnabled({ NODE_ENV: 'development', RESEND_API_KEY: undefined })).toBe(true);
  });
});
