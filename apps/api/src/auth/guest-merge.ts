import type { Prisma } from '@prisma/client';

export interface MergeResult {
  moved: number;
  /** Groups where the target user was already a member; the guest's member is kept as a placeholder. */
  conflicts: { groupId: string; memberId: string }[];
}

/**
 * Moves a guest's group memberships to the account they just linked (design §5.2).
 * Runs before Better Auth deletes the anonymous user. When the account is already in the same group,
 * the guest's member row stays as a placeholder (userId = null) so its expenses and balances survive.
 */
export async function mergeGuestInto(
  tx: Prisma.TransactionClient,
  guestUserId: string,
  targetUserId: string,
): Promise<MergeResult> {
  const guestMembers = await tx.member.findMany({ where: { userId: guestUserId } });
  const existing = await tx.member.findMany({ where: { userId: targetUserId }, select: { groupId: true } });
  const taken = new Set(existing.map((m) => m.groupId));

  const result: MergeResult = { moved: 0, conflicts: [] };
  for (const m of guestMembers) {
    if (taken.has(m.groupId)) {
      await tx.member.update({ where: { id: m.id }, data: { userId: null } });
      result.conflicts.push({ groupId: m.groupId, memberId: m.id });
    } else {
      await tx.member.update({ where: { id: m.id }, data: { userId: targetUserId } });
      result.moved += 1;
    }
  }
  return result;
}
