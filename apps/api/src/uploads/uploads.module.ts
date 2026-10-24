import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [UploadsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class UploadsModule {}
