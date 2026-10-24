import { Module } from '@nestjs/common';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { BalancesService } from './balances.service';
import { GroupsController, InvitesController } from './groups.controller';
import { GroupsService } from './groups.service';
import { InvitesService } from './invites.service';
import { InvitePreviewLimitGuard } from './ip-rate-limit.guard';

@Module({
  controllers: [GroupsController, InvitesController],
  providers: [GroupsService, InvitesService, BalancesService, GroupMemberGuard, InvitePreviewLimitGuard],
  exports: [GroupsService, BalancesService],
})
export class GroupsModule {}
