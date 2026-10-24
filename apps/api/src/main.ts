import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz'] });
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService<Env, true>).get('PORT', { infer: true }));
}

void bootstrap();
