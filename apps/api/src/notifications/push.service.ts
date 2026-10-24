import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  /** App path to open on tap, e.g. `/groups/abc`. */
  url?: string;
}

/** Web Push (VAPID) and Expo push, both free. Dead subscriptions are removed when the provider says they are gone. */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private readonly vapid: boolean;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    const pub = config.get('VAPID_PUBLIC_KEY', { infer: true });
    const priv = config.get('VAPID_PRIVATE_KEY', { infer: true });
    this.vapid = Boolean(pub && priv);
    if (pub && priv) webpush.setVapidDetails(config.get('VAPID_SUBJECT', { infer: true }), pub, priv);
  }

  async send(userId: string, msg: PushMessage): Promise<void> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          if (s.kind === 'expo') await this.sendExpo(s.endpoint, msg);
          else if (this.vapid) await this.sendWeb(s, msg);
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410 || (e as Error).message === 'DeviceNotRegistered') gone.push(s.id);
          else this.log.warn(`push to ${s.kind} subscription failed: ${(e as Error).message}`);
        }
      }),
    );
    if (gone.length > 0) await this.prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  }

  private async sendWeb(s: { endpoint: string; keys: unknown }, msg: PushMessage) {
    const keys = s.keys as { p256dh?: string; auth?: string } | null;
    if (!keys?.p256dh || !keys.auth) return;
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, JSON.stringify(msg), { TTL: 86400 });
  }

  private async sendExpo(token: string, msg: PushMessage) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: token, title: msg.title, body: msg.body, data: { url: msg.url } }),
    });
    if (!res.ok) throw Object.assign(new Error(`Expo push failed (${res.status})`), { statusCode: res.status });
    const json = (await res.json()) as { data?: { status?: string; details?: { error?: string } } };
    if (json.data?.status === 'error' && json.data.details?.error === 'DeviceNotRegistered') throw new Error('DeviceNotRegistered');
  }
}
