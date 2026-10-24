import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FxService } from './fx.service';

const rateQuery = z.object({
  from: z.string().length(3).toUpperCase(),
  to: z.string().length(3).toUpperCase(),
  date: z.iso.date().optional(),
});

@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Public()
  @Get('currencies')
  currencies() {
    return this.fx.currencies();
  }

  @Get('rate')
  async rate(@Query(new ZodPipe(rateQuery)) q: z.infer<typeof rateQuery>) {
    const r = await this.fx.rateFor(q.from, q.to, q.date);
    return { rate: r.rate, date: r.date ?? q.date ?? new Date().toISOString().slice(0, 10), source: r.source };
  }
}
