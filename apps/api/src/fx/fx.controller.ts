import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../common/decorators';
import { Returns } from '../common/returns';
import { ZodPipe } from '../common/zod.pipe';
import { CurrencyListDto, FxRateDto } from './fx.dto';
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
  @Returns(CurrencyListDto)
  @Get('currencies')
  currencies(): CurrencyListDto {
    return this.fx.currencies();
  }

  @Returns(FxRateDto)
  @Get('rate')
  async rate(@Query(new ZodPipe(rateQuery)) q: z.infer<typeof rateQuery>): Promise<FxRateDto> {
    const r = await this.fx.rateFor(q.from, q.to, q.date);
    return { rate: r.rate, date: r.date ?? q.date ?? new Date().toISOString().slice(0, 10), source: r.source };
  }
}
