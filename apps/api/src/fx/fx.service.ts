import { Injectable, Logger } from '@nestjs/common';
import { CURRENCIES, crossRate, isCurrency } from '@settled/core';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { FxFeed } from './fx-feed';
import type { CurrencyListDto } from './fx.dto';

export interface ResolvedRate {
  /** Base units per 1 unit of the original currency, decimal string. */
  rate: string;
  /** Date of the rate actually used (can be older than asked when the feed is down). */
  date: string | null;
  source: 'same' | 'market';
}

const today = () => new Date().toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** A date we already asked the feed for is not asked again for this long, even if it had no rows for that exact day. */
const REFETCH_AFTER_MS = 60 * 60 * 1000;
/** After a failed fetch, wait this long before hitting the feeds again so an outage doesn't slow every request. */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

@Injectable()
export class FxService {
  private readonly log = new Logger(FxService.name);
  private readonly inflight = new Map<string, Promise<void>>();
  /** date → time before which the feed is not asked for that date again */
  private readonly holdUntil = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: FxFeed,
  ) {}

  currencies(): CurrencyListDto {
    return Object.entries(CURRENCIES)
      .map(([code, { decimals }]) => ({ code, decimals }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Rate for converting `from` into `to` on `date` (design §4.2). Future dates use today's rate. */
  async rateFor(from: string, to: string, date: string = today()): Promise<ResolvedRate> {
    for (const code of [from, to]) {
      if (!isCurrency(code)) throw new AppError('UNSUPPORTED_CURRENCY', 400, `Unsupported currency: ${code}`);
    }
    if (from === to) return { rate: '1', date: null, source: 'same' };

    const wanted = date > today() ? today() : date;
    const [f, t] = await Promise.all([this.perUsd(from, wanted), this.perUsd(to, wanted)]);
    // Cross rate from two different days is still better than none, but report the older day
    const used = f.date < t.date ? f.date : t.date;
    return { rate: crossRate(f.perUsd, t.perUsd), date: used, source: 'market' };
  }

  /** Stores today's rates when we have none yet. Called by the daily cron task. */
  async ensureToday(): Promise<void> {
    const d = today();
    const have = await this.prisma.exchangeRate.count({ where: { date: asDate(d) } });
    if (have === 0) await this.fetchInto(d);
  }

  /** Newest stored rate on or before `date`; fetches the day first if we have no row for it. */
  private async perUsd(currency: string, date: string): Promise<{ perUsd: string; date: string }> {
    if (currency === 'USD') return { perUsd: '1', date };
    const find = () =>
      this.prisma.exchangeRate.findFirst({
        where: { currency, date: { lte: asDate(date) } },
        orderBy: { date: 'desc' },
      });
    let row = await find();
    if (!row || dayOf(row.date) !== date) {
      await this.fetchInto(date).catch((e) => this.log.warn(`rate fetch for ${date} failed: ${(e as Error).message}`));
      row = await find();
    }
    if (!row) {
      // Nothing on or before the date: any row at all is better than refusing (backdated expense, empty cache)
      row = await this.prisma.exchangeRate.findFirst({ where: { currency }, orderBy: { date: 'asc' } });
    }
    if (!row) throw new AppError('FX_RATE_UNAVAILABLE', 503, `No exchange rate for ${currency}`);
    return { perUsd: row.perUsd.toFixed(), date: dayOf(row.date) };
  }

  private fetchInto(date: string): Promise<void> {
    const running = this.inflight.get(date);
    if (running) return running;
    if (Date.now() < (this.holdUntil.get(date) ?? 0)) return Promise.resolve();
    const p = this.doFetch(date).finally(() => this.inflight.delete(date));
    this.inflight.set(date, p);
    return p;
  }

  private async doFetch(date: string): Promise<void> {
    try {
      // Today has no dated package until the feed rolls over, so ask for the latest one
      const day = await this.feed.fetchDay(date === today() ? 'latest' : date);
      await this.prisma.exchangeRate.createMany({
        data: Object.entries(day.perUsd).map(([currency, perUsd]) => ({
          date: asDate(day.date),
          currency,
          perUsd,
          source: day.source,
        })),
        skipDuplicates: true,
      });
      this.holdUntil.set(date, Date.now() + REFETCH_AFTER_MS);
    } catch (e) {
      this.holdUntil.set(date, Date.now() + RETRY_AFTER_FAILURE_MS);
      throw e;
    }
  }
}
