import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../common/decorators';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, ReceiptsService } from './receipts.service';

const body = z
  .object({
    groupId: z.string().min(1),
    contentType: z.enum(Object.keys(RECEIPT_TYPES) as [string, ...string[]]),
    size: z.number().int().positive().max(RECEIPT_MAX_BYTES),
  })
  .strict();

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Post('receipts')
  async receipt(@CurrentUser() user: SessionUser, @Body(new ZodPipe(body)) input: z.infer<typeof body>) {
    // groupId comes from the body here, so membership is checked by hand instead of GroupMemberGuard
    const member = await this.prisma.member.findFirst({
      where: { groupId: input.groupId, userId: user.id, leftAt: null },
      select: { id: true },
    });
    if (!member) throw new AppError('NOT_A_MEMBER', 403);
    return this.receipts.presignUpload(input.groupId, input.contentType, input.size);
  }
}
