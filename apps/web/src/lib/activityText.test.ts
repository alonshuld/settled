import { describe, expect, it } from 'vite-plus/test';
import type { ActivityItem } from '@/api/activity';
import { describeActivity, groupByDay, latestReminderToMe, sectionOf } from './activityText';

const money = (m: number, c: string) => `${c}${m / 100}`;
const base = { groupName: 'Crete', actor: { memberId: 'm1', name: 'Maya', color: '#fff' } };
const mk = (event: string, payload: Record<string, unknown> | null, over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: event,
  groupId: 'g1',
  type: event.split('.')[0] as ActivityItem['type'],
  event,
  payload,
  createdAt: '2026-10-25T10:00:00Z',
  unread: false,
  ...base,
  ...over,
});

describe('describeActivity', () => {
  it('describes expenses with description, actor and amount', () => {
    const d = describeActivity(mk('expense.created', { description: 'Boat', amount: 136000, currency: 'ILS', actor: 'Maya' }), money);
    expect(d.key).toBe('activity.ev.expense.created');
    expect(d.params).toMatchObject({ desc: 'Boat', actor: 'Maya', amount: 'ILS1360' });
    expect(d.glyph).toBe('expense');
    expect(d.amount).toEqual({ text: 'ILS1360', tone: 'neutral' });
  });

  it('falls back to the actor member name when the payload has none', () => {
    const d = describeActivity(mk('expense.deleted', { description: 'x', amount: 100, currency: 'EUR' }), money);
    expect(d.params.actor).toBe('Maya');
  });

  it('marks confirmed payments positive', () => {
    const d = describeActivity(
      mk('payment.confirmed', { fromName: 'Noa', toName: 'Maya', amount: 50000, currency: 'ILS' }),
      money,
    );
    expect(d.params).toMatchObject({ from: 'Noa', to: 'Maya' });
    expect(d.amount?.tone).toBe('pos');
    expect(describeActivity(mk('payment.claimed', { amount: 1, currency: 'ILS' }), money).amount?.tone).toBe('neutral');
  });

  it('maps reminder variants and member/group events', () => {
    expect(describeActivity(mk('reminder.received', { creditorName: 'Roni', groupName: 'Flat', amount: 34000, currency: 'ILS' }), money).params).toMatchObject({
      creditor: 'Roni',
      group: 'Flat',
      amount: 'ILS340',
    });
    expect(describeActivity(mk('reminder.sent', { debtorName: 'Itay' }), money).params.debtor).toBe('Itay');
    expect(describeActivity(mk('member.added', { name: 'Dana' }), money).key).toBe('activity.ev.member.joined');
    expect(describeActivity(mk('member.left', {}), money).params.name).toBe('Maya');
    expect(describeActivity(mk('group.closed', { name: 'Gift' }), money)).toMatchObject({ key: 'activity.ev.group.closed', glyph: 'group' });
  });

  it('never throws on unknown events or missing payloads', () => {
    const d = describeActivity(mk('something.new', null), money);
    expect(d.key).toBe('activity.ev.unknown');
    expect(d.amount).toBeUndefined();
  });
});

describe('day grouping', () => {
  const now = new Date(2026, 9, 25, 15, 0);
  it('buckets by local calendar day', () => {
    expect(sectionOf(new Date(2026, 9, 25, 0, 5).toISOString(), now)).toBe('today');
    expect(sectionOf(new Date(2026, 9, 24, 23, 59).toISOString(), now)).toBe('yesterday');
    expect(sectionOf(new Date(2026, 9, 20, 12, 0).toISOString(), now)).toBe('earlier');
  });

  it('keeps order and merges adjacent items', () => {
    const items = [
      { createdAt: new Date(2026, 9, 25, 14).toISOString() },
      { createdAt: new Date(2026, 9, 25, 9).toISOString() },
      { createdAt: new Date(2026, 9, 24, 9).toISOString() },
      { createdAt: new Date(2026, 9, 1, 9).toISOString() },
    ];
    expect(groupByDay(items, now).map((g) => [g.section, g.items.length])).toEqual([
      ['today', 2],
      ['yesterday', 1],
      ['earlier', 1],
    ]);
  });
});

describe('latestReminderToMe', () => {
  it('picks the first unread reminder.received', () => {
    const a = mk('reminder.received', {}, { id: 'a', unread: false });
    const b = mk('reminder.received', {}, { id: 'b', unread: true });
    const c = mk('reminder.received', {}, { id: 'c', unread: true });
    expect(latestReminderToMe([a, b, c])?.id).toBe('b');
    expect(latestReminderToMe([a])).toBeUndefined();
  });
});
