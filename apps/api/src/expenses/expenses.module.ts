import { Module } from '@nestjs/common';
import { GroupMemberGuard } from '../common/guards/group-member.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { FxModule } from '../fx/fx.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [FxModule, UploadsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, GroupMemberGuard, IdempotencyInterceptor],
})
export class ExpensesModule {}
