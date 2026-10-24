import { Module } from '@nestjs/common';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { ActivityController, GroupActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  controllers: [ActivityController, GroupActivityController],
  providers: [ActivityService, GroupMemberGuard],
  exports: [ActivityService],
})
export class ActivityModule {}
