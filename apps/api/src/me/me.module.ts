import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { DashboardService } from './dashboard.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({ imports: [GroupsModule], controllers: [MeController], providers: [MeService, DashboardService] })
export class MeModule {}
