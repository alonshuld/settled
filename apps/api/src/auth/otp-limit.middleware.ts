import express, { type NextFunction, type Request, type Response } from 'express';
import { AppError } from '../common/errors';
import type { OtpLimiter } from './otp-limiter';

const SEND_PATHS = new Set(['/email-otp/send-verification-otp', '/phone-number/send-otp']);
const parseJson = express.json({ limit: '10kb' });

/**
 * Applies the per-destination and per-IP send limits (design §5.1) before Better Auth's handler.
 * Mounted outside Nest's pipeline, so it writes the error envelope itself.
 */
export function otpLimitMiddleware(limiter: OtpLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST' || !SEND_PATHS.has(req.path)) return next();
    parseJson(req, res, (err?: unknown) => {
      if (err) return next(err);
      const body = (req.body ?? {}) as { email?: unknown; phoneNumber?: unknown };
      const destination = typeof body.email === 'string' ? body.email : body.phoneNumber;
      if (typeof destination !== 'string') return next(); // Better Auth rejects the malformed body
      try {
        limiter.check(destination, req.ip ?? 'unknown');
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        const retryAfter = Number(e.details?.retryAfterSeconds ?? 60);
        res
          .status(e.status)
          .set('Retry-After', String(retryAfter))
          .json({ error: { code: e.code, message: e.message, details: e.details, requestId: String(req.id ?? '') } });
        return;
      }
      next();
    });
  };
}
