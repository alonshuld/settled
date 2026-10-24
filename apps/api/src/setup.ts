import { INestApplication } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import helmet from 'helmet';
import { AuthService } from './auth/auth.service';
import { otpLimitMiddleware } from './auth/otp-limit.middleware';

/**
 * Shared by main.ts and the e2e tests. The app must be created with `bodyParser: false`:
 * Better Auth reads its own request bodies, so it is mounted before the JSON parser.
 */
export function configureApp(app: INestApplication) {
  const authService = app.get(AuthService);
  app.use(helmet());
  app.use('/api/auth', otpLimitMiddleware(authService.otpLimiter), toNodeHandler(authService.auth));
  app.use(express.json({ limit: '100kb' }));
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz'] });
  app.enableShutdownHooks();
}
