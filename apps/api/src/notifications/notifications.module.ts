import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

@Global()
@Module({ providers: [NotificationsService, PushService], exports: [NotificationsService, PushService] })
export class NotificationsModule {}
