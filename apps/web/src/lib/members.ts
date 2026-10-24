import { isEmail, toE164 } from './phone';

export interface NewMember {
  displayName: string;
  email?: string;
  phone?: string;
}

const PHONE_AT_END = /(\+?\d[\d\s().-]{5,}\d)\s*$/;

/**
 * One text box for "Noa", "Noa noa@mail.com", "Noa 050-123-4567", or just an email / phone
 * (the name then falls back to the email's local part / the number). Null when nothing usable was typed.
 */
export function parseMemberInput(raw: string): NewMember | null {
  let rest = raw.trim();
  if (!rest) return null;
  const out: NewMember = { displayName: '' };

  const tokens = rest.split(/[\s,;]+/);
  const email = tokens.find((tok) => isEmail(tok));
  if (email) {
    out.email = email.toLowerCase();
    rest = tokens.filter((tok) => tok !== email).join(' ');
  }

  const m = PHONE_AT_END.exec(rest);
  const phone = m ? toE164(m[1]!) : null;
  if (m && phone) {
    out.phone = phone;
    rest = rest.slice(0, m.index);
  }

  out.displayName = rest.replace(/\s+/g, ' ').trim() || (out.email?.split('@')[0] ?? out.phone ?? '');
  return out.displayName ? { ...out, displayName: out.displayName.slice(0, 60) } : null;
}
