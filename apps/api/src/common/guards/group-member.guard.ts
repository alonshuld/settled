import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { GroupMember, SessionUser } from '../decorators';
import { AppError } from '../errors';

/** Every `/groups/:groupId/...` route: the caller must be an active member (design §5.4). */
@Injectable()
export class GroupMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user: SessionUser; member?: GroupMember }>();
    const groupId = req.params.groupId as string;
    const member = await this.prisma.member.findFirst({
      where: { groupId, userId: req.user.id, leftAt: null },
      select: { id: true, groupId: true, userId: true, role: true },
    });
    if (!member) throw new AppError('NOT_A_MEMBER', 403);
    req.member = member as GroupMember;
    return true;
  }
}
