import type { ActivityItem } from '@/api/activity';

export type ActivityGlyph = 'expense' | 'payment' | 'reminder' | 'member' | 'group';

export interface ActivityDescription {
  /** i18n key under `activity.ev.*`. */
  key: string;
  params: Record<string, string>;
  glyph: ActivityGlyph;
  /** Trailing amount (design shows it for expenses, payments and reminders). */
  amount?: { text: string; tone: 'neutral' | 'pos' };
}

type Payload = Record<string, unknown>;
const str = (p: Payload, k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
const num = (p: Payload, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : undefined);

/**
 * Maps a feed row to a translation key + params. Wording is passive or name-led ("added by Maya", "a new
 * member: Dana") so Hebrew never has to guess a person's gender. Unknown events fall back to a generic line.
 */
export function describeActivity(
  item: Pick<ActivityItem, 'event' | 'type' | 'actor' | 'payload' | 'groupName'>,
  money: (minor: number, currency: string) => string,
): ActivityDescription {
  const p: Payload = item.payload ?? {};
  const actor = str(p, 'actor') || item.actor?.name || '';
  const group = item.groupName;
  const amountOf = (minorKey: string, currencyKey: string) => {
    const minor = num(p, minorKey);
    const cur = str(p, currencyKey);
    return minor !== undefined && cur ? money(minor, cur) : '';
  };
  const withAmount = (text: string, tone: 'neutral' | 'pos' = 'neutral') => (text ? { text, tone } : undefined);

  switch (item.event) {
    case 'expense.created':
    case 'expense.updated':
    case 'expense.deleted': {
      const amount = amountOf('amount', 'currency');
      return {
        key: `activity.ev.${item.event}`,
        params: { desc: str(p, 'description'), actor, group, amount },
        glyph: 'expense',
        amount: withAmount(amount),
      };
    }
    case 'payment.claimed':
    case 'payment.confirmed':
    case 'payment.rejected':
    case 'payment.undone': {
      const amount = amountOf('amount', 'currency');
      return {
        key: `activity.ev.${item.event}`,
        params: { from: str(p, 'fromName'), to: str(p, 'toName'), actor, group, amount },
        glyph: 'payment',
        amount: withAmount(amount, item.event === 'payment.confirmed' ? 'pos' : 'neutral'),
      };
    }
    case 'reminder.sent':
    case 'reminder.received':
    case 'reminder.nudge': {
      const amount = amountOf('amount', 'currency');
      return {
        key: `activity.ev.${item.event}`,
        params: { debtor: str(p, 'debtorName'), creditor: str(p, 'creditorName'), group: str(p, 'groupName') || group, amount },
        glyph: 'reminder',
        amount: withAmount(amount),
      };
    }
    case 'member.joined':
    case 'member.added':
      return { key: 'activity.ev.member.joined', params: { name: str(p, 'name') || item.actor?.name || '', group }, glyph: 'member' };
    case 'member.left':
      return { key: 'activity.ev.member.left', params: { name: item.actor?.name ?? '', group }, glyph: 'member' };
    case 'group.created':
    case 'group.closed':
    case 'group.reopened':
      return { key: `activity.ev.${item.event}`, params: { name: str(p, 'name') || group }, glyph: 'group' };
    default:
      return { key: 'activity.ev.unknown', params: { group }, glyph: item.type };
  }
}

export type DaySection = 'today' | 'yesterday' | 'earlier';

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function sectionOf(iso: string, now: Date): DaySection {
  const diff = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86_400_000);
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : 'earlier';
}

/** Items arrive newest first; keeps that order and drops empty sections. */
export function groupByDay<T extends { createdAt: string }>(items: T[], now: Date): { section: DaySection; items: T[] }[] {
  const out: { section: DaySection; items: T[] }[] = [];
  for (const it of items) {
    const section = sectionOf(it.createdAt, now);
    const last = out[out.length - 1];
    if (last && last.section === section) last.items.push(it);
    else out.push({ section, items: [it] });
  }
  return out;
}

/** The newest unread reminder addressed to me (the "you got a reminder" card). */
export function latestReminderToMe(items: ActivityItem[]): ActivityItem | undefined {
  return items.find((i) => i.event === 'reminder.received' && i.unread);
}
