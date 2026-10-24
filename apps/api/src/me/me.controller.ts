import { Body, Controller, Get, Patch } from '@nestjs/common';
import { isCurrency } from '@settled/core';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DashboardService } from './dashboard.service';
import { MeService } from './me.service';

const updateMe = z
  .object({
    name: z.string().trim().min(1).max(60),
    locale: z.enum(['he', 'en']),
    theme: z.enum(['light', 'dark', 'system']),
    defaultCurrency: z.string().refine(isCurrency, 'Unsupported currency'),
    gender: z.enum(['male', 'female']).nullable(),
    // E.164, unverified: only used to build WhatsApp / SMS reminder links
    contactPhone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +972501234567').nullable(),
  })
  .partial()
  .strict();

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.me.get(user.id);
  }

  @Get('dashboard')
  async getDashboard(@CurrentUser() user: SessionUser) {
    const { defaultCurrency } = await this.me.get(user.id);
    return this.dashboard.get(user.id, defaultCurrency);
  }

  @Patch()
  update(@CurrentUser() user: SessionUser, @Body(new ZodPipe(updateMe)) body: z.infer<typeof updateMe>) {
    return this.me.update(user.id, body);
  }
}
