import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../common/decorators';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ActivityService } from './activity.service';

const type = z.enum(['expense', 'payment', 'reminder', 'member']);
const feedQuery = z.object({
  type: type.optional(),
  groupId: z.string().min(1).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const groupFeedQuery = feedQuery.omit({ groupId: true });
const countsQuery = z.object({ groupId: z.string().min(1).optional() });
const markRead = z.object({ upTo: z.iso.datetime().optional() }).strict();

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  feed(@CurrentUser() user: SessionUser, @Query(new ZodPipe(feedQuery)) q: z.infer<typeof feedQuery>) {
    return this.activity.feed(user.id, q);
  }

  @Get('counts')
  counts(@CurrentUser() user: SessionUser, @Query(new ZodPipe(countsQuery)) q: z.infer<typeof countsQuery>) {
    return this.activity.counts(user.id, q.groupId);
  }

  @HttpCode(204)
  @Post('mark-read')
  async markRead(@CurrentUser() user: SessionUser, @Body(new ZodPipe(markRead)) body: z.infer<typeof markRead>) {
    await this.activity.markRead(user.id, body.upTo ? new Date(body.upTo) : undefined);
  }
}

@Controller('groups/:groupId/activity')
@UseGuards(GroupMemberGuard)
export class GroupActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  feed(@CurrentUser() user: SessionUser, @Param('groupId') groupId: string, @Query(new ZodPipe(groupFeedQuery)) q: z.infer<typeof groupFeedQuery>) {
    return this.activity.feed(user.id, { ...q, groupId });
  }
}
