const ZERO_DECIMALS = 'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF';
const THREE_DECIMALS = 'BHD IQD JOD KWD LYD OMR TND';
const TWO_DECIMALS =
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY COP CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VES WST XCD YER ZAR ZMW ZWG';

export type Decimals = 0 | 2 | 3;

export const CURRENCIES: Readonly<Record<string, { decimals: Decimals }>> = Object.freeze(
  Object.fromEntries([
    ...ZERO_DECIMALS.split(' ').map((c) => [c, { decimals: 0 as Decimals }]),
    ...TWO_DECIMALS.split(' ').map((c) => [c, { decimals: 2 as Decimals }]),
    ...THREE_DECIMALS.split(' ').map((c) => [c, { decimals: 3 as Decimals }]),
  ]),
);

export function isCurrency(code: string): boolean {
  return Object.hasOwn(CURRENCIES, code);
}

export function decimalsOf(code: string): Decimals {
  const entry = CURRENCIES[code];
  if (!entry) throw new Error(`Unsupported currency: ${code}`);
  return entry.decimals;
}

/** Parses a plain decimal string ("3.9821") into numerator / 10^scale. */
function parseDecimal(value: string): { n: bigint; scale: number } {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
  const [int = '0', frac = ''] = value.split('.');
  return { n: BigInt(int + frac), scale: frac.length };
}

/** Integer division rounding half to even. Denominator must be positive. */
function divRoundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

/** Converts minor units of `from` to minor units of `to` at `rate` (`to` units per 1 `from`). */
export function convert(amount: number, from: string, to: string, rate: string): number {
  const { n, scale } = parseDecimal(rate);
  const shift = decimalsOf(to) - decimalsOf(from);
  let num = BigInt(amount) * n;
  let den = 10n ** BigInt(scale);
  if (shift >= 0) num *= 10n ** BigInt(shift);
  else den *= 10n ** BigInt(-shift);
  return Number(divRoundHalfEven(num, den));
}

/** Base units per 1 `from`, given both currencies' rates per 1 USD. 10 decimal places. */
export function crossRate(fromPerUsd: string, toPerUsd: string): string {
  const f = parseDecimal(fromPerUsd);
  const t = parseDecimal(toPerUsd);
  if (f.n === 0n) throw new Error('Zero rate');
  const scale = 10;
  // (t / 10^ts) / (f / 10^fs) = t * 10^fs / (f * 10^ts)
  const num = t.n * 10n ** BigInt(f.scale + scale);
  const den = f.n * 10n ** BigInt(t.scale);
  const q = divRoundHalfEven(num, den).toString().padStart(scale + 1, '0');
  const int = q.slice(0, -scale);
  const frac = q.slice(-scale).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}
