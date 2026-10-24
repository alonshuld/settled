import { Module } from '@nestjs/common';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { GroupsModule } from '../groups/groups.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [GroupsModule],
  controllers: [RemindersController],
  providers: [RemindersService, GroupMemberGuard, IdempotencyInterceptor],
  exports: [RemindersService],
})
export class RemindersModule {}
