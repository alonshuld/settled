import { formatMoney } from '@settled/core';

type Locale = 'he' | 'en';
type Payload = Record<string, any>;

export interface Rendered {
  title: string;
  body: string;
}

const money = (p: Payload, locale: Locale) => formatMoney(p.amount, p.currency, locale);

/** Text for a push notification, in the recipient's language. Null = this event is not pushed. */
export function renderNotification(event: string, p: Payload, locale: Locale, groupName: string): Rendered | null {
  const he = locale === 'he';
  switch (event) {
    case 'expense.created':
      return {
        title: groupName,
        body: he ? `${p.actor} הוסיף/ה "${p.description}" · ${money(p, locale)}` : `${p.actor} added "${p.description}" · ${money(p, locale)}`,
      };
    case 'expense.updated':
      return { title: groupName, body: he ? `${p.actor} עדכן/ה את "${p.description}"` : `${p.actor} edited "${p.description}"` };
    case 'expense.deleted':
      return { title: groupName, body: he ? `${p.actor} מחק/ה את "${p.description}"` : `${p.actor} deleted "${p.description}"` };
    case 'payment.claimed':
      return {
        title: groupName,
        body: he ? `${p.fromName} אומר/ת ששילם/ה לך ${money(p, locale)}. לאשר?` : `${p.fromName} says they paid you ${money(p, locale)}. Confirm?`,
      };
    case 'payment.confirmed':
      return {
        title: groupName,
        body: he ? `${p.toName} קיבל/ה ${money(p, locale)} מ${p.fromName}` : `${p.toName} received ${money(p, locale)} from ${p.fromName}`,
      };
    case 'payment.rejected':
      return {
        title: groupName,
        body: he ? `${p.toName} לא אישר/ה את התשלום של ${money(p, locale)}` : `${p.toName} did not confirm your ${money(p, locale)} payment`,
      };
    case 'reminder.received':
      return { title: groupName, body: p.message };
    case 'reminder.nudge':
      return {
        title: groupName,
        body: he ? `זמן להזכיר ל${p.debtorName} שוב: ${money(p, locale)}` : `Time to remind ${p.debtorName} again: ${money(p, locale)}`,
      };
    default:
      return null;
  }
}
