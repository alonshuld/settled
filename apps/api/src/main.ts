import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { configureApp } from './setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  // Behind Render's proxy: trust one hop so req.ip (rate limits) and secure cookies see the client
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  configureApp(app);
  await app.listen(app.get(ConfigService<Env, true>).get('PORT', { infer: true }));
}

void bootstrap();
