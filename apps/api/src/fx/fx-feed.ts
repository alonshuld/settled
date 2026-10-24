import { Injectable, Logger } from '@nestjs/common';
import { CURRENCIES } from '@settled/core';

export interface FeedDay {
  /** Date the feed says the rates are for (can be earlier than requested, e.g. weekends on ECB). */
  date: string;
  source: 'fawazahmed0' | 'frankfurter';
  /** Units of each currency per 1 USD, as decimal strings. Only currencies in the core table. */
  perUsd: Record<string, string>;
}

const TIMEOUT_MS = 8000;

/** Plain decimal text for a JSON number: no exponent, no trailing zeros. */
function decimalString(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(10).replace(/\.?0+$/, '');
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

/** Free public rate feeds (design §4.2): fawazahmed0 first, Frankfurter as the fallback. Tests replace this class. */
@Injectable()
export class FxFeed {
  private readonly log = new Logger(FxFeed.name);

  /** `date` is YYYY-MM-DD or `latest`. Throws when both feeds fail. */
  async fetchDay(date: string): Promise<FeedDay> {
    try {
      return await this.primary(date);
    } catch (e) {
      this.log.warn(`fawazahmed0 failed for ${date}: ${(e as Error).message}`);
    }
    return this.fallback(date);
  }

  private async primary(date: string): Promise<FeedDay> {
    const body = await getJson(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`);
    const perUsd: Record<string, string> = {};
    for (const [code, value] of Object.entries(body.usd ?? {})) {
      const upper = code.toUpperCase();
      const text = typeof value === 'number' ? decimalString(value) : null;
      if (text && Object.hasOwn(CURRENCIES, upper)) perUsd[upper] = text;
    }
    if (Object.keys(perUsd).length === 0) throw new Error('empty rate table');
    return { date: body.date, source: 'fawazahmed0', perUsd };
  }

  private async fallback(date: string): Promise<FeedDay> {
    const path = date === 'latest' ? 'latest' : date;
    const body = await getJson(`https://api.frankfurter.dev/v1/${path}?base=USD`);
    const perUsd: Record<string, string> = { USD: '1' };
    for (const [code, value] of Object.entries(body.rates ?? {})) {
      const text = typeof value === 'number' ? decimalString(value) : null;
      if (text && Object.hasOwn(CURRENCIES, code)) perUsd[code] = text;
    }
    return { date: body.date, source: 'frankfurter', perUsd };
  }
}
