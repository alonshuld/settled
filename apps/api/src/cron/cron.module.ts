import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { RemindersModule } from '../reminders/reminders.module';
import { UploadsModule } from '../uploads/uploads.module';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';

@Module({
  imports: [FxModule, RemindersModule, UploadsModule],
  controllers: [CronController],
  providers: [CronService],
})
export class CronModule {}
