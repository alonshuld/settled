import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { isCurrency } from '@settled/core';
import { z } from 'zod';
import { CurrentMember, CurrentUser, Public, type GroupMember, type SessionUser } from '../common/decorators';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { ZodPipe } from '../common/zod.pipe';
import { GroupsService } from './groups.service';
import { InvitesService } from './invites.service';
import { InvitePreviewLimitGuard } from './ip-rate-limit.guard';

const currency = z.string().refine(isCurrency, 'Unsupported currency');
const date = z.iso.date();
const contact = {
  email: z.email().max(254).optional(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +972501234567').optional(),
};
const newMember = z.object({ displayName: z.string().trim().min(1).max(60), ...contact }).strict();

const createGroup = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(['trip', 'home', 'event', 'meal', 'gift', 'other']),
    currency,
    startDate: date.optional(),
    endDate: date.optional(),
    members: z.array(newMember).max(50).default([]),
  })
  .strict();

const updateGroup = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(['trip', 'home', 'event', 'meal', 'gift', 'other']),
    currency,
    startDate: date.nullable(),
    endDate: date.nullable(),
  })
  .partial()
  .strict();

const updateMember = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    gender: z.enum(['male', 'female']).nullable(),
    email: contact.email.nullable(),
    phone: contact.phone.nullable(),
  })
  .partial()
  .strict();

const listQuery = z.object({ status: z.enum(['active', 'closed']).default('active') });
const joinBody = z.preprocess((v) => v ?? {}, z.object({ claimMemberId: z.string().min(1).optional() }).strict());

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.groups.list(user.id, q.status);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body(new ZodPipe(createGroup)) body: z.infer<typeof createGroup>) {
    return this.groups.create(user.id, user.name, body);
  }

  @UseGuards(GroupMemberGuard)
  @Get(':groupId')
  get(@CurrentUser() user: SessionUser, @Param('groupId') groupId: string) {
    return this.groups.detail(groupId, user.id);
  }

  @UseGuards(GroupMemberGuard)
  @Patch(':groupId')
  update(@CurrentMember() me: GroupMember, @Body(new ZodPipe(updateGroup)) body: z.infer<typeof updateGroup>) {
    return this.groups.update(me, body);
  }

  @UseGuards(GroupMemberGuard)
  @HttpCode(200)
  @Post(':groupId/close')
  close(@CurrentMember() me: GroupMember) {
    return this.groups.setClosed(me, true);
  }

  @UseGuards(GroupMemberGuard)
  @HttpCode(200)
  @Post(':groupId/reopen')
  reopen(@CurrentMember() me: GroupMember) {
    return this.groups.setClosed(me, false);
  }

  @UseGuards(GroupMemberGuard)
  @HttpCode(204)
  @Delete(':groupId')
  remove(@CurrentMember() me: GroupMember) {
    return this.groups.remove(me);
  }

  // ---- members ----

  @UseGuards(GroupMemberGuard)
  @Post(':groupId/members')
  addMember(@CurrentMember() me: GroupMember, @Body(new ZodPipe(newMember)) body: z.infer<typeof newMember>) {
    return this.groups.addPlaceholder(me, body);
  }

  @UseGuards(GroupMemberGuard)
  @Patch(':groupId/members/:memberId')
  updateMember(
    @CurrentMember() me: GroupMember,
    @Param('memberId') memberId: string,
    @Body(new ZodPipe(updateMember)) body: z.infer<typeof updateMember>,
  ) {
    return this.groups.updateMember(me, memberId, body);
  }

  @UseGuards(GroupMemberGuard)
  @HttpCode(204)
  @Delete(':groupId/members/:memberId')
  removeMember(@CurrentMember() me: GroupMember, @Param('memberId') memberId: string) {
    return this.groups.removePlaceholder(me, memberId);
  }

  @UseGuards(GroupMemberGuard)
  @HttpCode(204)
  @Post(':groupId/leave')
  leave(@CurrentMember() me: GroupMember) {
    return this.groups.leave(me);
  }
}

@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @UseGuards(GroupMemberGuard)
  @Get('groups/:groupId/invite')
  get(@CurrentMember() me: GroupMember) {
    return this.invites.get(me);
  }

  @UseGuards(GroupMemberGuard)
  @HttpCode(200)
  @Post('groups/:groupId/invite/rotate')
  rotate(@CurrentMember() me: GroupMember) {
    return this.invites.rotate(me);
  }

  @Public()
  @UseGuards(InvitePreviewLimitGuard)
  @Get('invites/:code')
  preview(@Param('code') code: string) {
    return this.invites.preview(code);
  }

  @HttpCode(200)
  @Post('invites/:code/join')
  join(
    @CurrentUser() user: SessionUser,
    @Param('code') code: string,
    @Body(new ZodPipe(joinBody)) body: z.infer<typeof joinBody>,
  ) {
    return this.invites.join(user.id, user.name, code, body.claimMemberId);
  }
}
