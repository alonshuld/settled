import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { CurrentMember, type GroupMember } from '../common/decorators';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { ZodPipe } from '../common/zod.pipe';
import { SettlementsService } from './settlements.service';

const MAX_AMOUNT = 100_000_000;
const id = z.string().min(1);
const createSettlement = z
  .object({
    fromMemberId: id,
    toMemberId: id,
    amount: z.number().int().positive().max(MAX_AMOUNT),
    // Currency validity is checked in the service so the client gets UNSUPPORTED_CURRENCY, not a field error
    currency: z.string().length(3).toUpperCase().optional(),
    fxRate: z
      .string()
      .regex(/^(?!0+(\.0+)?$)\d{1,10}(\.\d{1,10})?$/, 'Use a positive decimal like 3.9821')
      .nullable()
      .optional(),
    method: z.enum(['bit', 'paybox', 'paypal', 'revolut', 'bank', 'cash', 'other']).nullable().optional(),
  })
  .strict();

@Controller('groups/:groupId')
@UseGuards(GroupMemberGuard)
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('settle')
  settle(@CurrentMember() me: GroupMember) {
    return this.settlements.settleView(me);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post('settlements')
  create(@CurrentMember() me: GroupMember, @Body(new ZodPipe(createSettlement)) body: z.infer<typeof createSettlement>) {
    return this.settlements.create(me, body);
  }

  @HttpCode(200)
  @Post('settlements/:settlementId/confirm')
  confirm(@CurrentMember() me: GroupMember, @Param('settlementId') settlementId: string) {
    return this.settlements.confirm(me, settlementId);
  }

  @HttpCode(200)
  @Post('settlements/:settlementId/reject')
  reject(@CurrentMember() me: GroupMember, @Param('settlementId') settlementId: string) {
    return this.settlements.reject(me, settlementId);
  }

  @HttpCode(204)
  @Delete('settlements/:settlementId')
  undo(@CurrentMember() me: GroupMember, @Param('settlementId') settlementId: string) {
    return this.settlements.undo(me, settlementId);
  }
}
