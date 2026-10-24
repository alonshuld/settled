import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { CurrentMember, type GroupMember } from '../common/decorators';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { ZodPipe } from '../common/zod.pipe';
import { RemindersService } from './reminders.service';

const tone = z.enum(['friendly', 'neutral', 'firm']);
const channel = z.enum(['whatsapp', 'sms', 'email', 'push']);

const createReminder = z
  .object({
    toMemberId: z.string().min(1),
    tone,
    channel,
    message: z.string().trim().min(1).max(1000).optional(),
    autoRepeat: z.boolean().default(false),
  })
  .strict();
const createAll = z.object({ tone, channel, autoRepeat: z.boolean().default(false) }).strict();
const historyQuery = z.object({
  toMemberId: z.string().min(1).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

@Controller('groups/:groupId/reminders')
@UseGuards(GroupMemberGuard)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  history(@CurrentMember() me: GroupMember, @Query(new ZodPipe(historyQuery)) q: z.infer<typeof historyQuery>) {
    return this.reminders.history(me, q);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post()
  create(@CurrentMember() me: GroupMember, @Body(new ZodPipe(createReminder)) body: z.infer<typeof createReminder>) {
    return this.reminders.create(me, body);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post('all')
  createAll(@CurrentMember() me: GroupMember, @Body(new ZodPipe(createAll)) body: z.infer<typeof createAll>) {
    return this.reminders.createAll(me, body);
  }

  @HttpCode(200)
  @Post(':reminderId/stop')
  stop(@CurrentMember() me: GroupMember, @Param('reminderId') reminderId: string) {
    return this.reminders.stop(me, reminderId);
  }
}
