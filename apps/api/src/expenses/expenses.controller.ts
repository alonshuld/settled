import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { CurrentMember, type GroupMember } from '../common/decorators';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { ZodPipe } from '../common/zod.pipe';
import { ExpensesService } from './expenses.service';

export const MAX_AMOUNT = 100_000_000;

const categories = ['food', 'stay', 'transport', 'fuel', 'shopping', 'activities', 'other'] as const;
const memberId = z.string().min(1);
// Currency validity is checked in the service so the client gets UNSUPPORTED_CURRENCY, not a field error
const currency = z.string().length(3).toUpperCase();
const amount = z.number().int().positive().max(MAX_AMOUNT);
const rate = z.string().regex(/^(?!0+(\.0+)?$)\d{1,10}(\.\d{1,10})?$/, 'Use a positive decimal like 3.9821');

const split = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('equal'), included: z.array(memberId).min(1).max(100) }).strict(),
  z.object({ mode: z.literal('exact'), amounts: z.record(memberId, z.number().int().nonnegative().max(MAX_AMOUNT)) }).strict(),
  z.object({ mode: z.literal('shares'), shares: z.record(memberId, z.number().int().nonnegative().max(1000)) }).strict(),
]);

const fields = {
  amount,
  currency,
  fxRate: rate.nullable(),
  description: z.string().trim().min(1).max(120),
  category: z.enum(categories),
  paidByMemberId: memberId,
  date: z.iso.date(),
  receiptKey: z.string().min(1).max(200).nullable(),
  split,
};

const createExpense = z
  .object({ ...fields, currency: currency.optional(), fxRate: fields.fxRate.optional(), receiptKey: fields.receiptKey.optional() })
  .strict();
const updateExpense = z.object({ ...fields }).partial().extend({ version: z.number().int().positive() }).strict();

const listQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  category: z.enum(categories).optional(),
  memberId: memberId.optional(),
});

@Controller('groups/:groupId/expenses')
@UseGuards(GroupMemberGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@CurrentMember() me: GroupMember, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.expenses.list(me.groupId, q);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post()
  create(@CurrentMember() me: GroupMember, @Body(new ZodPipe(createExpense)) body: z.infer<typeof createExpense>) {
    return this.expenses.create(me, body);
  }

  @Get(':expenseId')
  get(@CurrentMember() me: GroupMember, @Param('expenseId') expenseId: string) {
    return this.expenses.get(me.groupId, expenseId);
  }

  @Patch(':expenseId')
  update(
    @CurrentMember() me: GroupMember,
    @Param('expenseId') expenseId: string,
    @Body(new ZodPipe(updateExpense)) body: z.infer<typeof updateExpense>,
  ) {
    return this.expenses.update(me, expenseId, body);
  }

  @HttpCode(204)
  @Delete(':expenseId')
  remove(@CurrentMember() me: GroupMember, @Param('expenseId') expenseId: string) {
    return this.expenses.remove(me, expenseId);
  }
}
