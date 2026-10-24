/** Local Israeli input ("050-123-4567") or an already international number to E.164. */
export function toE164(input: string, defaultCountry = '972'): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  const international = trimmed.startsWith('+') ? digits : digits.startsWith('00') ? digits.slice(2) : null;
  const full = international ?? `${defaultCountry}${digits.replace(/^0+/, '')}`;
  return full.length >= 8 && full.length <= 15 ? `+${full}` : null;
}

/** "+972501234567" -> "+972 50-•••-4567" for the OTP screen subtitle. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  if (d.length < 8) return e164;
  const cc = d.startsWith('972') ? '972' : d.slice(0, d.length - 9);
  const rest = d.slice(cc.length);
  return `+${cc} ${rest.slice(0, 2)}-•••-${rest.slice(-4)}`;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
