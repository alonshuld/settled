import { toMajorString } from './money.js';

export interface PaymentDetails {
  bitPhone?: string | null;
  payboxPhone?: string | null;
  paypalMe?: string | null;
  revolutTag?: string | null;
  bankDetails?: string | null;
}

export type PayMethod = 'paypal' | 'revolut' | 'bit' | 'paybox' | 'bank';

export interface PayOption {
  method: PayMethod;
  label: string;
  /** Opens directly when a documented link format exists. */
  url?: string;
  /** What the client copies to the clipboard (and shows) when there is no link or the link can't carry the amount. */
  copyText?: string;
  /** True when `url` already contains the amount. */
  amountPrefilled: boolean;
}

const clean = (v: string | null | undefined) => v?.trim() || null;
const handle = (v: string) => v.replace(/^@/, '').replace(/[^\w.-]/g, '');

/**
 * Turns the creditor's payment details into pay actions for the debtor (design §9.8.1).
 * Only PayPal has a documented link that carries the amount; Bit and PayBox have no public link format,
 * so they are copy-only until one is found.
 */
export function buildPayOptions(details: PaymentDetails | null | undefined, amount: number, currency: string): PayOption[] {
  if (!details) return [];
  const major = toMajorString(amount, currency);
  const out: PayOption[] = [];

  const paypal = clean(details.paypalMe) && handle(clean(details.paypalMe)!);
  if (paypal) out.push({ method: 'paypal', label: 'PayPal', url: `https://paypal.me/${paypal}/${major}${currency}`, amountPrefilled: true });

  const revolut = clean(details.revolutTag) && handle(clean(details.revolutTag)!);
  if (revolut) out.push({ method: 'revolut', label: 'Revolut', url: `https://revolut.me/${revolut}`, copyText: `${major} ${currency}`, amountPrefilled: false });

  const bit = clean(details.bitPhone);
  if (bit) out.push({ method: 'bit', label: 'Bit', copyText: `${bit}\n${major} ${currency}`, amountPrefilled: false });

  const paybox = clean(details.payboxPhone);
  if (paybox) out.push({ method: 'paybox', label: 'PayBox', copyText: `${paybox}\n${major} ${currency}`, amountPrefilled: false });

  const bank = clean(details.bankDetails);
  if (bank) out.push({ method: 'bank', label: 'Bank transfer', copyText: `${bank}\n${major} ${currency}`, amountPrefilled: false });

  return out;
}
