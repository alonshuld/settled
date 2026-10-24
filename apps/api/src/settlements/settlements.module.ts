import { Module } from '@nestjs/common';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { FxModule } from '../fx/fx.module';
import { GroupsModule } from '../groups/groups.module';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

@Module({
  imports: [FxModule, GroupsModule],
  controllers: [SettlementsController],
  providers: [SettlementsService, GroupMemberGuard, IdempotencyInterceptor],
})
export class SettlementsModule {}
