import { describe, expect, it } from 'vite-plus/test';
import { pushSupport, toSubscriptionBody, urlBase64ToUint8Array } from './push';

describe('pushSupport', () => {
  it('is unsupported without browser APIs, regardless of key', () => {
    expect(pushSupport('k', { hasApis: false, permission: 'default' })).toBe('unsupported');
  });
  it('needs the server VAPID key', () => {
    expect(pushSupport(null, { hasApis: true, permission: 'default' })).toBe('no-key');
    expect(pushSupport('', { hasApis: true, permission: 'default' })).toBe('no-key');
  });
  it('reports a blocked permission', () => {
    expect(pushSupport('k', { hasApis: true, permission: 'denied' })).toBe('denied');
  });
  it('is ready otherwise', () => {
    expect(pushSupport('k', { hasApis: true, permission: 'default' })).toBe('ready');
    expect(pushSupport('k', { hasApis: true, permission: 'granted' })).toBe('ready');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url without padding', () => {
    // bytes 251, 255, 190 -> "+/++" in base64, "-_--" in base64url
    expect([...urlBase64ToUint8Array('-_--')]).toEqual([251, 255, 190]);
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQI')]).toEqual([1, 2]);
  });
});

describe('toSubscriptionBody', () => {
  const keys = { p256dh: 'p', auth: 'a' };
  it('builds the webpush body', () => {
    expect(toSubscriptionBody({ endpoint: 'https://push.example/abc', keys })).toEqual({
      kind: 'webpush',
      endpoint: 'https://push.example/abc',
      keys,
    });
  });
  it('rejects incomplete or non-https subscriptions', () => {
    expect(toSubscriptionBody({ endpoint: 'https://x', keys: { p256dh: 'p' } })).toBeNull();
    expect(toSubscriptionBody({ endpoint: 'http://x', keys })).toBeNull();
    expect(toSubscriptionBody({ keys })).toBeNull();
  });
});
