import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { GroupsModule } from '../groups/groups.module';
import { ActivityModule } from '../activity/activity.module';
import { AccountService } from './account.service';
import { DashboardService } from './dashboard.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { SettingsService } from './settings.service';

@Module({ imports: [GroupsModule, FxModule, ActivityModule], controllers: [MeController], providers: [MeService, DashboardService, SettingsService, AccountService] })
export class MeModule {}
