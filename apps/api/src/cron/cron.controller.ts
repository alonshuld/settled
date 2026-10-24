import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Env } from '../config/env';
import { CronService } from './cron.service';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Called by cron-job.org every 5 minutes with the shared secret (design §10, §11.1). */
@Controller('internal')
export class CronController {
  constructor(
    private readonly cron: CronService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @HttpCode(200)
  @Post('cron')
  async run(@Req() req: Request) {
    const given = req.header('x-cron-secret') ?? '';
    // Hash both sides so the comparison is constant-time regardless of length
    if (!timingSafeEqual(digest(given), digest(this.config.get('CRON_SECRET', { infer: true })))) {
      throw new AppError('UNAUTHENTICATED', 401);
    }
    return { ran: await this.cron.tick() };
  }
}
