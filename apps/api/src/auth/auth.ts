import { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { anonymous, bearer, emailOTP, phoneNumber } from 'better-auth/plugins';
import { emailEnabled, type Env } from '../config/env';
import type { EmailService } from '../email/email.service';
import { mergeGuestInto } from './guest-merge';
import { NoSmsProvider, type SmsProvider } from './sms.provider';

export interface AuthDeps {
  prisma: PrismaClient;
  env: Env;
  email: Pick<EmailService, 'sendLoginCode'>;
  sms?: SmsProvider;
}

const DAY = 60 * 60 * 24;

export function createAuth({ prisma, env, email, sms = new NoSmsProvider() }: AuthDeps) {
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    // Browsers reach the API through the web app's same-origin proxy, so APP_URL is the public origin.
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Native apps send no Origin (bearer token, no cookies); MOBILE_ORIGINS covers deep-link callbacks
    trustedOrigins: [env.APP_URL, ...env.MOBILE_ORIGINS],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    socialProviders: googleEnabled
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
      : {},
    plugins: [
      bearer(),
      ...(emailEnabled(env)
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: 600,
              allowedAttempts: 3,
              sendVerificationOTP: async ({ email: to, otp }) => {
                await email.sendLoginCode(to, otp);
              },
            }),
          ]
        : []),
      anonymous({
        emailDomainName: 'guest.shulam.app',
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await prisma.$transaction((tx) => mergeGuestInto(tx, anonymousUser.user.id, newUser.user.id));
        },
      }),
      ...(env.AUTH_PHONE_OTP_ENABLED
        ? [
            phoneNumber({
              otpLength: 6,
              expiresIn: 600,
              allowedAttempts: 3,
              sendOTP: async ({ phoneNumber: to, code }) => {
                await sms.send(to, `Shulam code: ${code}`);
              },
              signUpOnVerification: {
                getTempEmail: (phone) => `${phone.replace('+', '')}@phone.shulam.app`,
                getTempName: (phone) => phone,
              },
            }),
          ]
        : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
