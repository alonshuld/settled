import { describe, expect, it } from 'vite-plus/test';
import type { Reminder, SettleTransfer, SettleView } from '@/api/settle';
import {
  activeAutoRepeat,
  ago,
  buildReminderMessage,
  canUndo,
  channelAvailability,
  cooldownLeftMs,
  firstAvailable,
  formatAgo,
  handoffUrl,
  isSafeHandoff,
  roleOf,
  sortTransfers,
  summarize,
  transferStatus,
} from './settle';

const tr = (from: string, to: string, amount: number, extra: Partial<SettleTransfer> = {}): SettleTransfer => ({
  fromMemberId: from,
  toMemberId: to,
  amount,
  lastReminder: null,
  pendingClaim: null,
  ...extra,
});

const view = (outstanding: SettleTransfer[], settled = 0, total = 0): SettleView => ({
  currency: 'ILS',
  outstanding,
  settled: [],
  progress: { settled, total },
  myPaymentDetails: null,
  myPayOptions: [],
});

describe('transfer status', () => {
  it('prefers a pending claim over a reminder over open', () => {
    const reminded = { sentAt: '2026-10-20T10:00:00Z', channel: 'whatsapp' as const, autoRepeat: false };
    expect(transferStatus(tr('n', 'me', 900))).toBe('open');
    expect(transferStatus(tr('n', 'me', 900, { lastReminder: reminded }))).toBe('reminded');
    expect(transferStatus(tr('n', 'me', 900, { lastReminder: reminded, pendingClaim: { settlementId: 's', amount: 900 } }))).toBe('claimPending');
  });

  it('classifies the viewer role', () => {
    expect(roleOf(tr('n', 'me', 1), 'me')).toBe('creditor');
    expect(roleOf(tr('me', 'n', 1), 'me')).toBe('debtor');
    expect(roleOf(tr('a', 'b', 1), 'me')).toBe('other');
    expect(roleOf(tr('a', 'b', 1), undefined)).toBe('other');
  });
});

describe('summarize', () => {
  it('splits what is owed to me, by me and between others, with rounded progress', () => {
    const s = summarize(view([tr('n', 'me', 900), tr('me', 'i', 300), tr('a', 'b', 100)], 500, 1800), 'me');
    expect(s).toMatchObject({ owedToMe: 900, iOwe: 300, others: 100, percent: 28, allSettled: false, empty: false });
  });

  it('is settled once nothing is outstanding after a payment', () => {
    expect(summarize(view([], 1800, 1800), 'me')).toMatchObject({ allSettled: true, percent: 100, empty: false });
  });

  it('is empty with no transfers and no payments', () => {
    expect(summarize(view([]), 'me')).toMatchObject({ empty: true, allSettled: false, percent: 0 });
  });
});

it('sorts my transfers first, stable within a group', () => {
  const list = [tr('a', 'b', 1), tr('me', 'x', 2), tr('y', 'me', 3), tr('z', 'me', 4)];
  expect(sortTransfers(list, 'me').map((x) => x.amount)).toEqual([3, 4, 2, 1]);
});

describe('channels', () => {
  it('only narrows down placeholders', () => {
    expect(channelAvailability(undefined)).toEqual({ whatsapp: true, sms: true, email: true, push: true });
    expect(channelAvailability({ isPlaceholder: false, email: null, phone: null }).email).toBe(true);
    expect(channelAvailability({ isPlaceholder: true, email: 'a@b.co', phone: null })).toEqual({
      whatsapp: false,
      sms: false,
      email: true,
      push: false,
    });
  });

  it('picks the first reachable channel', () => {
    expect(firstAvailable({ whatsapp: false, sms: false, email: true, push: false })).toBe('email');
    expect(firstAvailable({ whatsapp: false, sms: false, email: false, push: false })).toBeNull();
  });
});

describe('hand-off links', () => {
  const base = { link: 'https://wa.me/972501234567?text=hi', waUrl: 'https://wa.me/972501234567?text=hi' };
  it('returns the deep link only for whatsapp and sms', () => {
    expect(handoffUrl({ channel: 'whatsapp', ...base })).toBe(base.waUrl);
    expect(handoffUrl({ channel: 'sms', link: 'sms:+972501234567?body=hi' })).toBe('sms:+972501234567?body=hi');
    expect(handoffUrl({ channel: 'email', ...base })).toBeNull();
    expect(handoffUrl({ channel: 'whatsapp' })).toBeNull();
  });

  it('accepts wa.me and sms links only', () => {
    expect(isSafeHandoff('https://wa.me/1?text=x')).toBe(true);
    expect(isSafeHandoff('sms:+1?body=x')).toBe(true);
    expect(isSafeHandoff('javascript:alert(1)')).toBe(false);
    expect(isSafeHandoff('https://evil.example/wa.me/')).toBe(false);
  });
});

describe('buildReminderMessage', () => {
  const input = {
    tone: 'friendly' as const,
    lang: 'en' as const,
    debtor: { displayName: 'Noa', gender: 'female' as const },
    creditorName: 'Alon',
    amount: 90000,
    currency: 'ILS',
    groupName: 'Crete trip',
  };

  it('renders the tone template with names, amount and group', () => {
    const m = buildReminderMessage(input);
    expect(m).toContain('Hi Noa');
    expect(m).toContain('Alon');
    expect(m).toContain('Crete trip');
    expect(m).toContain('900');
    expect(buildReminderMessage({ ...input, tone: 'firm' })).toContain('still open');
  });

  it('appends payment lines once', () => {
    const details = { bitPhone: '050-1234567', bankDetails: 'Leumi 800-123' };
    const m = buildReminderMessage({ ...input, details });
    expect(m).toContain('Bit: 050-1234567');
    expect(m).toContain('Bank transfer: Leumi 800-123');
    expect(m.match(/Bit:/g)).toHaveLength(1);
  });

  it('writes Hebrew with the debtor gender', () => {
    const m = buildReminderMessage({ ...input, lang: 'he', debtor: { displayName: 'איתי', gender: 'male' } });
    expect(m).toContain('חייב ל');
    expect(m).not.toContain('חייב/ת');
  });
});

describe('timing', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  it('buckets elapsed time', () => {
    expect(ago('2026-10-24T11:59:40Z', now)).toBeNull();
    expect(ago('2026-10-24T11:30:00Z', now)).toEqual({ unit: 'minute', value: 30 });
    expect(ago('2026-10-24T07:00:00Z', now)).toEqual({ unit: 'hour', value: 5 });
    expect(ago('2026-10-22T11:00:00Z', now)).toEqual({ unit: 'day', value: 2 });
  });

  it('formats it relative to the language', () => {
    expect(formatAgo('2026-10-22T11:00:00Z', 'en', now)).toBe('2 days ago');
    expect(formatAgo('2026-10-24T11:59:50Z', 'en', now, 'just now')).toBe('just now');
  });

  it('computes the remaining reminder cooldown', () => {
    expect(cooldownLeftMs(null, now)).toBe(0);
    expect(cooldownLeftMs('2026-10-24T06:00:00Z', now)).toBe(6 * 3600_000);
    expect(cooldownLeftMs('2026-10-23T06:00:00Z', now)).toBe(0);
  });

  it('allows undo for 24 hours', () => {
    expect(canUndo('2026-10-24T01:00:00Z', now)).toBe(true);
    expect(canUndo('2026-10-23T11:00:00Z', now)).toBe(false);
    expect(canUndo(null, now)).toBe(false);
  });
});

it('finds the running auto-repeat chain I started', () => {
  const r = (over: Partial<Reminder>) => ({ id: 'r', fromMemberId: 'me', nextRunAt: null, stoppedAt: null, ...over }) as Reminder;
  const list = [r({ id: 'a', stoppedAt: '2026-10-01T00:00:00Z', nextRunAt: null }), r({ id: 'b', nextRunAt: '2026-10-27T00:00:00Z' }), r({ id: 'c', fromMemberId: 'x', nextRunAt: '2026-10-27T00:00:00Z' })];
  expect(activeAutoRepeat(list, 'me')?.id).toBe('b');
  expect(activeAutoRepeat([], 'me')).toBeUndefined();
});
