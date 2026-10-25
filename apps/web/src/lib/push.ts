import type { WebPushBody } from '@/api/me';

export type PushSupport = 'unsupported' | 'no-key' | 'denied' | 'ready';

/** Web Push needs a service worker, PushManager and Notification; iOS only offers them to installed web apps. */
export function pushSupport(vapidKey: string | null | undefined, env: { hasApis: boolean; permission: string }): PushSupport {
  if (!env.hasApis) return 'unsupported';
  if (!vapidKey) return 'no-key';
  if (env.permission === 'denied') return 'denied';
  return 'ready';
}

export function browserPushEnv() {
  const hasApis =
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { hasApis, permission: hasApis ? Notification.permission : 'default' };
}

/** VAPID public keys are base64url; `applicationServerKey` wants bytes. */
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The body for `POST /me/push-subscriptions`, or null when the browser gave back an incomplete subscription. */
export function toSubscriptionBody(sub: Pick<PushSubscriptionJSON, 'endpoint' | 'keys'>): WebPushBody | null {
  const { endpoint, keys } = sub;
  if (!endpoint || !endpoint.startsWith('https://') || !keys?.p256dh || !keys.auth) return null;
  return { kind: 'webpush', endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

const SW_URL = '/sw.js';

async function registration() {
  return (await navigator.serviceWorker.getRegistration(SW_URL)) ?? (await navigator.serviceWorker.register(SW_URL));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return reg ? reg.pushManager.getSubscription() : null;
}

export type SubscribeResult = { ok: true; body: WebPushBody } | { ok: false; reason: 'denied' | 'failed' };

/** Asks permission (must run from a user gesture), subscribes, and returns what the server needs. */
export async function subscribeToPush(vapidKey: string): Promise<SubscribeResult> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };
  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
    const body = toSubscriptionBody(sub.toJSON());
    if (!body) {
      await sub.unsubscribe();
      return { ok: false, reason: 'failed' };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
