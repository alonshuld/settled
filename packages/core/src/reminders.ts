import { formatMoney } from './money.js';
import type { PaymentDetails } from './payLinks.js';

export type ReminderTone = 'friendly' | 'neutral' | 'firm';

export interface ReminderInput {
  tone: ReminderTone;
  locale: 'he' | 'en';
  /** Grammar of the person being reminded (Hebrew verbs); unknown → neutral forms. */
  gender?: 'male' | 'female' | null;
  debtorName: string;
  creditorName: string;
  /** Minor units of `currency`. */
  amount: number;
  currency: string;
  groupName: string;
  paymentDetails?: PaymentDetails | null;
}

/** Payment lines as they are appended to a reminder. Empty when there is nothing to show. */
export function paymentLines(d: PaymentDetails | null | undefined, locale: 'he' | 'en'): string[] {
  if (!d) return [];
  const he = locale === 'he';
  const lines: string[] = [];
  if (d.bitPhone) lines.push(`Bit: ${d.bitPhone}`);
  if (d.payboxPhone) lines.push(`PayBox: ${d.payboxPhone}`);
  if (d.paypalMe) lines.push(`PayPal: paypal.me/${d.paypalMe.replace(/^@/, '')}`);
  if (d.revolutTag) lines.push(`Revolut: revolut.me/${d.revolutTag.replace(/^@/, '')}`);
  if (d.bankDetails) lines.push(`${he ? 'העברה בנקאית' : 'Bank transfer'}: ${d.bankDetails}`);
  return lines;
}

/** Message body, without payment details (those are appended by `appendPaymentDetails`). */
export function renderReminder(i: ReminderInput): string {
  const money = formatMoney(i.amount, i.currency, i.locale);
  if (i.locale === 'he') {
    // Hebrew past/present forms agree with the debtor's gender; unknown uses the slash form
    const you = i.gender === 'male' ? 'אתה' : i.gender === 'female' ? 'את' : 'את/ה';
    const pay = i.gender === 'male' ? 'תעביר' : i.gender === 'female' ? 'תעבירי' : 'תעביר/י';
    const body = {
      friendly: `היי ${i.debtorName} 🙂 לפי קבוצת "${i.groupName}", ${you} חייב/ת ל${i.creditorName} ${money}. כשנוח לך, אפשר להעביר? תודה!`,
      neutral: `שלום ${i.debtorName}, לפי קבוצת "${i.groupName}" יש יתרה של ${money} לטובת ${i.creditorName}. פרטי התשלום מצורפים.`,
      firm: `${i.debtorName}, היתרה של ${money} ל${i.creditorName} בקבוצת "${i.groupName}" עדיין פתוחה. ${pay} אותה בהקדם, בבקשה.`,
    }[i.tone];
    return i.gender ? body.replace('חייב/ת', i.gender === 'male' ? 'חייב' : 'חייבת') : body;
  }
  return {
    friendly: `Hi ${i.debtorName} 🙂 per the "${i.groupName}" group, you owe ${i.creditorName} ${money}. Could you send it when you get a chance? Thanks!`,
    neutral: `Hi ${i.debtorName}, per the "${i.groupName}" group, there's a balance of ${money} owed to ${i.creditorName}. Payment details are attached.`,
    firm: `${i.debtorName}, the ${money} you owe ${i.creditorName} in "${i.groupName}" is still open. Please pay it as soon as possible.`,
  }[i.tone];
}

/**
 * Adds the payment lines unless the message already carries them (the user may have kept or edited the template).
 */
export function appendPaymentDetails(message: string, d: PaymentDetails | null | undefined, locale: 'he' | 'en'): string {
  const lines = paymentLines(d, locale);
  if (lines.length === 0) return message;
  const values = [d?.bitPhone, d?.payboxPhone, d?.paypalMe, d?.revolutTag, d?.bankDetails].filter((v): v is string => Boolean(v));
  if (values.some((v) => message.includes(v))) return message;
  return `${message}\n\n${lines.join('\n')}`;
}

/** wa.me link; the number is E.164 with the leading + dropped. */
export function whatsappLink(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** sms: link. iOS wants `&body=` after the number, everything else `?body=`. */
export function smsLink(phoneE164: string, text: string, platform: 'ios' | 'other' = 'other'): string {
  return `sms:${phoneE164}${platform === 'ios' ? '&' : '?'}body=${encodeURIComponent(text)}`;
}
