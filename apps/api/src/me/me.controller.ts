import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { isCurrency } from '@settled/core';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AccountService } from './account.service';
import { DashboardService } from './dashboard.service';
import { MeService } from './me.service';
import { SettingsService } from './settings.service';

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

const text = (max: number, re?: RegExp, msg?: string) => {
  const base = z.string().trim().max(max);
  // Empty string clears the field
  return z.preprocess((v) => (v === '' ? null : v), (re ? base.regex(re, msg) : base).nullable()).default(null);
};
const paymentDetails = z
  .object({
    bitPhone: text(32, /^\+?[\d\s-]{6,20}$/, 'Use a phone number'),
    payboxPhone: text(32, /^\+?[\d\s-]{6,20}$/, 'Use a phone number'),
    paypalMe: text(40, /^[A-Za-z0-9.]{1,40}$/, 'Use your PayPal.me username'),
    revolutTag: text(40, /^@?[A-Za-z0-9_.]{1,40}$/, 'Use your Revolut @username'),
    bankDetails: text(300),
  })
  .strict();
const notificationPrefs = z
  .object({ remindersToMe: z.boolean(), newExpenses: z.boolean(), paymentsReceived: z.boolean(), weeklySummary: z.boolean() })
  .partial()
  .strict();
const pushSubscription = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('webpush'),
      endpoint: z.url({ protocol: /^https$/ }).max(1000),
      keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
    }),
    z.object({ kind: z.literal('expo'), endpoint: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/, 'Not an Expo push token').max(200) }),
  ]);
const statsQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional() });
const deleteMe = z.object({ confirm: z.literal('DELETE') }).strict();

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly dashboard: DashboardService,
    private readonly settings: SettingsService,
    private readonly account: AccountService,
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

  @Get('payment-details')
  getPaymentDetails(@CurrentUser() user: SessionUser) {
    return this.settings.getPaymentDetails(user.id);
  }

  @Put('payment-details')
  putPaymentDetails(@CurrentUser() user: SessionUser, @Body(new ZodPipe(paymentDetails)) body: z.infer<typeof paymentDetails>) {
    return this.settings.putPaymentDetails(user.id, body);
  }

  @Get('notification-prefs')
  getPrefs(@CurrentUser() user: SessionUser) {
    return this.settings.getPrefs(user.id);
  }

  @Patch('notification-prefs')
  patchPrefs(@CurrentUser() user: SessionUser, @Body(new ZodPipe(notificationPrefs)) body: z.infer<typeof notificationPrefs>) {
    return this.settings.patchPrefs(user.id, body);
  }

  @Post('push-subscriptions')
  addPush(@CurrentUser() user: SessionUser, @Body(new ZodPipe(pushSubscription)) body: z.infer<typeof pushSubscription>) {
    return this.settings.addPush(user.id, body);
  }

  @HttpCode(204)
  @Delete('push-subscriptions/:id')
  async removePush(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.settings.removePush(user.id, id);
  }

  @Get('stats')
  stats(@CurrentUser() user: SessionUser, @Query(new ZodPipe(statsQuery)) q: z.infer<typeof statsQuery>) {
    return this.settings.stats(user.id, q.month ?? new Date().toISOString().slice(0, 7));
  }

  @HttpCode(204)
  @Delete()
  async deleteAccount(@CurrentUser() user: SessionUser, @Body(new ZodPipe(deleteMe)) _body: z.infer<typeof deleteMe>) {
    await this.account.delete(user.id);
  }
}
