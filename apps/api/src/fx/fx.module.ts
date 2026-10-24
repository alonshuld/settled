import { Module } from '@nestjs/common';
import { FxController } from './fx.controller';
import { FxFeed } from './fx-feed';
import { FxService } from './fx.service';

@Module({
  controllers: [FxController],
  providers: [FxService, FxFeed],
  exports: [FxService],
})
export class FxModule {}
