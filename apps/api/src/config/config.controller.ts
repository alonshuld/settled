import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators';
import type { Env } from './env';

@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Public()
  @Get()
  get() {
    const get = <K extends keyof Env>(k: K) => this.config.get(k, { infer: true });
    return {
      auth: {
        google: Boolean(get('GOOGLE_CLIENT_ID') && get('GOOGLE_CLIENT_SECRET')),
        emailOtp: true,
        phoneOtp: get('AUTH_PHONE_OTP_ENABLED'),
        guest: true,
      },
      // sms and whatsapp are links the sender's device opens; no provider is involved (design §9.9)
      reminderChannels: ['push', 'email', 'whatsapp', 'sms'],
    };
  }
}
