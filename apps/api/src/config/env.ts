import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),
  CRON_SECRET: z.string().min(16),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Email: Resend when a key is set, otherwise Mailpit's HTTP API (local dev)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Shulam <onboarding@resend.dev>'),
  MAILPIT_URL: z.string().url().default('http://localhost:8025'),
  // Receipts: Cloudflare R2 (S3 API). Unset = receipt uploads answer 503 UPLOADS_UNAVAILABLE.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // Phone OTP is built in step 2 but stays off until an SMS provider exists.
  AUTH_PHONE_OTP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
