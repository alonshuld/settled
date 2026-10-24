import { Injectable } from '@nestjs/common';
import { validateEnv } from '../config/env';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { type Auth, createAuth } from './auth';
import { OtpLimiter } from './otp-limiter';

@Injectable()
export class AuthService {
  readonly auth: Auth;
  readonly otpLimiter = new OtpLimiter();

  constructor(prisma: PrismaService, email: EmailService) {
    this.auth = createAuth({ prisma, env: validateEnv(process.env), email });
  }
}
