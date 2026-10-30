import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatMoney, simplifyDebts } from '@settled/core';
import { emailEnabled, type Env } from '../config/env';
import { BalancesService } from '../groups/balances.service';
import { EmailService } from '../email/email.service';
import { PushService } from '../notifications/push.service';
import { PrismaService } from '../prisma/prisma.service';

type Locale = 'he' | 'en';

/** `digest.weekly` (design §10): "who owes whom" for users who turned on the weekly summary. */
@Injectable()
export class DigestService {
  private readonly log = new Logger(DigestService.name);
  private readonly emailOn: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: BalancesService,
    private readonly email: EmailService,
    private readonly push: PushService,
    config: ConfigService<Env, true>,
  ) {
    this.emailOn = emailEnabled({ NODE_ENV: config.get('NODE_ENV', { infer: true }), RESEND_API_KEY: config.get('RESEND_API_KEY', { infer: true }) });
  }

  async run(): Promise<{ sent: number; skipped: number; failed: number }> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, notificationPrefs: { is: { weeklySummary: true } } },
      select: { id: true, name: true, email: true, isAnonymous: true, locale: true },
    });
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const u of users) {
      try {
        const lines = await this.lines(u.id, u.locale);
        if (lines.length === 0) {
          skipped++;
          continue;
        }
        await this.deliver(u, lines);
        sent++;
      } catch (e) {
        failed++;
        this.log.warn(`weekly digest for a user failed: ${(e as Error).message}`);
      }
    }
    return { sent, skipped, failed };
  }

  /** One line per simplified transfer the user is part of, across their open groups. */
  async lines(userId: string, locale: Locale): Promise<string[]> {
    const he = locale === 'he';
    const members = await this.prisma.member.findMany({
      where: { userId, leftAt: null, group: { closedAt: null } },
      select: { id: true, groupId: true, group: { select: { name: true, currency: true, members: { select: { id: true, displayName: true } } } } },
    });
    const balances = await this.balances.forGroups(members.map((m) => m.groupId));
    const out: string[] = [];
    for (const m of members) {
      const names = new Map(m.group.members.map((x) => [x.id, x.displayName]));
      for (const t of simplifyDebts(balances.get(m.groupId)!.balances)) {
        const money = formatMoney(t.amount, m.group.currency, locale);
        if (t.fromMemberId === m.id) out.push(he ? `${m.group.name}: את/ה חייב/ת ל${names.get(t.toMemberId)} ${money}` : `${m.group.name}: you owe ${names.get(t.toMemberId)} ${money}`);
        else if (t.toMemberId === m.id) out.push(he ? `${m.group.name}: ${names.get(t.fromMemberId)} חייב/ת לך ${money}` : `${m.group.name}: ${names.get(t.fromMemberId)} owes you ${money}`);
      }
    }
    return out;
  }

  private async deliver(u: { id: string; name: string; email: string | null; isAnonymous: boolean | null; locale: Locale }, lines: string[]) {
    const he = u.locale === 'he';
    const title = he ? 'הסיכום השבועי שלך בשולם' : 'Your weekly Shulam summary';
    const text = `${he ? `היי ${u.name}, כך זה נראה השבוע:` : `Hi ${u.name}, here is where things stand:`}\n\n${lines.join('\n')}`;
    const tasks: Promise<unknown>[] = [this.push.send(u.id, { title, body: lines.length === 1 ? lines[0]! : he ? `${lines.length} חובות פתוחים` : `${lines.length} open balances`, url: '/' })];
    if (this.emailOn && u.email && !u.isAnonymous) tasks.push(this.email.send({ to: u.email, subject: title, text }));
    const results = await Promise.allSettled(tasks);
    const rejected = results.find((r) => r.status === 'rejected');
    if (rejected && results.every((r) => r.status === 'rejected')) throw (rejected as PromiseRejectedResult).reason;
  }
}
