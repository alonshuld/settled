import { Injectable } from '@nestjs/common';
import type { Gender, Locale, Theme } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PREFS } from './settings.service';

export interface UpdateMe {
  name?: string;
  locale?: Locale;
  theme?: Theme;
  defaultCurrency?: string;
  gender?: Gender | null;
  contactPhone?: string | null;
}

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: { select: { providerId: true } }, notificationPrefs: true },
    });
    if (!user) throw new AppError('NOT_FOUND', 404);
    const isGuest = Boolean(user.isAnonymous);
    const providers = new Set(user.accounts.map((a) => a.providerId));
    return {
      id: user.id,
      name: user.name,
      email: isGuest ? null : user.email,
      contactPhone: user.contactPhone,
      image: user.image,
      locale: user.locale,
      theme: user.theme,
      defaultCurrency: user.defaultCurrency,
      gender: user.gender,
      isGuest,
      methods: {
        google: providers.has('google'),
        email: !isGuest && Boolean(user.email) && user.emailVerified,
        phone: Boolean(user.phoneNumberVerified),
      },
      notificationPrefs: user.notificationPrefs
        ? {
            remindersToMe: user.notificationPrefs.remindersToMe,
            newExpenses: user.notificationPrefs.newExpenses,
            paymentsReceived: user.notificationPrefs.paymentsReceived,
            weeklySummary: user.notificationPrefs.weeklySummary,
          }
        : DEFAULT_PREFS,
    };
  }

  async update(userId: string, data: UpdateMe) {
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.get(userId);
  }
}
