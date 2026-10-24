import { appendPaymentDetails, renderReminder, type PaymentDetails, type ReminderTone } from '@settled/core';
import type { GroupMemberView } from '@/api/groupDetail';
import type { Reminder, ReminderChannel, SettleTransfer, SettleView } from '@/api/settle';

export const TONES: ReminderTone[] = ['friendly', 'neutral', 'firm'];
export const CHANNELS: ReminderChannel[] = ['whatsapp', 'sms', 'email', 'push'];

/** The server refuses a second reminder for the same pair inside this window (RemindersService). */
export const COOLDOWN_MS = 12 * 60 * 60 * 1000;

export type Role = 'creditor' | 'debtor' | 'other';
export type TransferStatus = 'claimPending' | 'reminded' | 'open';

export const roleOf = (x: Pick<SettleTransfer, 'fromMemberId' | 'toMemberId'>, meId: string | undefined): Role =>
  x.toMemberId === meId ? 'creditor' : x.fromMemberId === meId ? 'debtor' : 'other';

/** What a row says under the name: a claim waiting for the receiver beats a reminder note, which beats nothing. */
export function transferStatus(x: SettleTransfer): TransferStatus {
  if (x.pendingClaim) return 'claimPending';
  if (x.lastReminder) return 'reminded';
  return 'open';
}

export interface Summary {
  /** Owed to me / I owe / the rest of the group, in the group currency. */
  owedToMe: number;
  iOwe: number;
  others: number;
  total: number;
  /** 0-100, rounded; 0 when nothing has been settled or owed yet. */
  percent: number;
  /** Nothing outstanding and something was settled: the stamp state. */
  allSettled: boolean;
  /** No expenses or payments at all. */
  empty: boolean;
}

export function summarize(view: SettleView, meId: string | undefined): Summary {
  let owedToMe = 0;
  let iOwe = 0;
  let others = 0;
  for (const x of view.outstanding) {
    const role = roleOf(x, meId);
    if (role === 'creditor') owedToMe += x.amount;
    else if (role === 'debtor') iOwe += x.amount;
    else others += x.amount;
  }
  const { settled, total } = view.progress;
  return {
    owedToMe,
    iOwe,
    others,
    total,
    percent: total > 0 ? Math.min(100, Math.round((settled / total) * 100)) : 0,
    allSettled: view.outstanding.length === 0 && settled > 0,
    empty: view.outstanding.length === 0 && view.settled.length === 0 && total === 0,
  };
}

/** Mine first (owed to me, then what I owe), then everyone else's, each keeping the server's order. */
export function sortTransfers(list: SettleTransfer[], meId: string | undefined): SettleTransfer[] {
  const rank = { creditor: 0, debtor: 1, other: 2 } as const;
  return list.map((x, i) => ({ x, i })).sort((a, b) => rank[roleOf(a.x, meId)] - rank[roleOf(b.x, meId)] || a.i - b.i).map((e) => e.x);
}

/**
 * Which channels can reach this person. Joined members have a hidden contact set (the server decides, and answers
 * REMINDER_CHANNEL_UNAVAILABLE), so only placeholders - whose email/phone we hold - are narrowed down.
 */
export function channelAvailability(m: Pick<GroupMemberView, 'isPlaceholder' | 'email' | 'phone'> | undefined): Record<ReminderChannel, boolean> {
  if (!m || !m.isPlaceholder) return { whatsapp: true, sms: true, email: true, push: true };
  return { whatsapp: !!m.phone, sms: !!m.phone, email: !!m.email, push: false };
}

export const firstAvailable = (av: Record<ReminderChannel, boolean>): ReminderChannel | null => CHANNELS.find((c) => av[c]) ?? null;

/** WhatsApp and SMS are opened by the user's device; the server only records them and returns the deep link. */
export const isHandoff = (channel: ReminderChannel) => channel === 'whatsapp' || channel === 'sms';

export const handoffUrl = (r: Pick<Reminder, 'channel' | 'link' | 'waUrl'>): string | null =>
  isHandoff(r.channel) ? (r.waUrl ?? r.link ?? null) : null;

/** Only http(s), wa.me and sms: links are ever opened; anything else the API might send is dropped. */
export const isSafeHandoff = (url: string) => /^(https:\/\/wa\.me\/|sms:)/.test(url);

export interface MessageInput {
  tone: ReminderTone;
  lang: 'he' | 'en';
  debtor: Pick<GroupMemberView, 'displayName' | 'gender'>;
  creditorName: string;
  amount: number;
  currency: string;
  groupName: string;
  details?: PaymentDetails | null;
}

/**
 * The text shown in the composer and sent as-is, so what the creditor sees is what the debtor receives.
 * Payment lines are appended unless the template already carries them.
 */
export function buildReminderMessage(i: MessageInput): string {
  const base = renderReminder({
    tone: i.tone,
    locale: i.lang,
    gender: i.debtor.gender,
    debtorName: i.debtor.displayName,
    creditorName: i.creditorName,
    amount: i.amount,
    currency: i.currency,
    groupName: i.groupName,
  });
  return appendPaymentDetails(base, i.details, i.lang);
}

/** "Reminded ... ago" unit and value; `null` under a minute ("just now"). */
export function ago(from: string | Date, now: Date = new Date()): { unit: 'minute' | 'hour' | 'day'; value: number } | null {
  const ms = now.getTime() - new Date(from).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return null;
  if (min < 60) return { unit: 'minute', value: min };
  const hours = Math.floor(min / 60);
  if (hours < 24) return { unit: 'hour', value: hours };
  return { unit: 'day', value: Math.floor(hours / 24) };
}

export function formatAgo(from: string | Date, lang: 'he' | 'en', now: Date = new Date(), justNow = ''): string {
  const a = ago(from, now);
  if (!a) return justNow;
  return new Intl.RelativeTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', { numeric: 'auto' }).format(-a.value, a.unit);
}

/** Time left before the server accepts another reminder for the same pair; 0 when free. */
export const cooldownLeftMs = (lastSentAt: string | undefined | null, now: Date = new Date()) =>
  lastSentAt ? Math.max(0, new Date(lastSentAt).getTime() + COOLDOWN_MS - now.getTime()) : 0;

/** An active auto-repeat chain in the history: the root the stop endpoint wants. */
export const activeAutoRepeat = (history: Reminder[], meId: string | undefined): Reminder | undefined =>
  history.find((r) => r.fromMemberId === meId && r.nextRunAt !== null && r.stoppedAt === null);

/** Undo is offered for 24 h after a payment (the server enforces it and that you recorded it). */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
export const canUndo = (confirmedAt: string | null, now: Date = new Date()) =>
  !!confirmedAt && now.getTime() - new Date(confirmedAt).getTime() <= UNDO_WINDOW_MS;
