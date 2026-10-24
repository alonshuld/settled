import { Module } from '@nestjs/common';
import { DigestService } from '../digest/digest.service';
import { FxModule } from '../fx/fx.module';
import { GroupsModule } from '../groups/groups.module';
import { RemindersModule } from '../reminders/reminders.module';
import { UploadsModule } from '../uploads/uploads.module';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';

@Module({
  imports: [GroupsModule, FxModule, RemindersModule, UploadsModule],
  controllers: [CronController],
  providers: [CronService, DigestService],
})
export class CronModule {}
