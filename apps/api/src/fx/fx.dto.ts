import { z } from 'zod';

/** One supported ISO 4217 currency and its minor-unit size (design §4.2). */
export const CurrencyDto = z.object({ code: z.string(), decimals: z.number().int() }).meta({ id: 'Currency' });
export type CurrencyDto = z.infer<typeof CurrencyDto>;

export const CurrencyListDto = z.array(CurrencyDto);
export type CurrencyListDto = z.infer<typeof CurrencyListDto>;

/** GET /fx/rate: base units per 1 unit of `from`, as a decimal string. */
export const FxRateDto = z
  .object({
    rate: z.string(),
    /** Calendar date (YYYY-MM-DD) of the rate actually used. */
    date: z.string(),
    source: z.enum(['same', 'market']),
  })
  .meta({ id: 'FxRate' });
export type FxRateDto = z.infer<typeof FxRateDto>;
