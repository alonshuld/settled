import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Deleting an account (design §11.3). */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One transaction. The person stays in every group as a placeholder with their display name, so other members'
   * balances and history are unchanged. Groups with nobody else left are deleted; ownership passes to the
   * longest-standing remaining member.
   */
  async delete(userId: string): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) return;
      const mine = await tx.member.findMany({ where: { userId }, select: { id: true, groupId: true, role: true, leftAt: true } });

      for (const m of mine) {
        const others = await tx.member.findMany({
          where: { groupId: m.groupId, userId: { not: null }, NOT: { userId }, leftAt: null },
          orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, role: true },
        });
        if (others.length === 0) {
          // Shares and settlements point at members without a cascade, so they go first
          await tx.expense.deleteMany({ where: { groupId: m.groupId } });
          await tx.settlement.deleteMany({ where: { groupId: m.groupId } });
          await tx.group.delete({ where: { id: m.groupId } });
        } else if (m.role === 'owner' && !others.some((o) => o.role === 'owner')) {
          await tx.member.update({ where: { id: others[0]!.id }, data: { role: 'owner' } });
        }
      }

      // Groups deleted above took their member rows with them
      await tx.member.updateMany({ where: { userId }, data: { userId: null, role: 'member' } });
      await tx.paymentDetails.deleteMany({ where: { userId } });
      await tx.notificationPrefs.deleteMany({ where: { userId } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      await tx.activity.deleteMany({ where: { audienceUserId: userId } });
      await tx.idempotencyKey.deleteMany({ where: { userId } });
      if (user.email) await tx.verification.deleteMany({ where: { identifier: { contains: user.email } } });

      await tx.user.update({
        where: { id: userId },
        data: { name: 'Deleted user', email: null, phoneNumber: null, contactPhone: null, image: null, deletedAt: new Date() },
      });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
