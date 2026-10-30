import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators';
import { Returns } from '../common/returns';
import { ConfigDto } from './config.dto';
import { emailEnabled, type Env } from './env';

@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Public()
  @Returns(ConfigDto)
  @Get()
  get(): ConfigDto {
    const get = <K extends keyof Env>(k: K) => this.config.get(k, { infer: true });
    const email = emailEnabled({ NODE_ENV: get('NODE_ENV'), RESEND_API_KEY: get('RESEND_API_KEY') });
    return {
      auth: {
        google: Boolean(get('GOOGLE_CLIENT_ID') && get('GOOGLE_CLIENT_SECRET')),
        emailOtp: email,
        phoneOtp: get('AUTH_PHONE_OTP_ENABLED'),
        guest: true,
      },
      // sms and whatsapp are links the sender's device opens; no provider is involved (design §9.9)
      // The client needs this to subscribe to Web Push; null = web push is off
      push: { vapidPublicKey: get('VAPID_PUBLIC_KEY') ?? null },
      reminderChannels: email ? ['push', 'email', 'whatsapp', 'sms'] : ['push', 'whatsapp', 'sms'],
    };
  }
}
