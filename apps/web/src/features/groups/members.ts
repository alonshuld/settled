import type { GroupDetail, GroupMemberView } from '@/api/groupDetail';

/** Members still in the group, in the order the API returns them. */
export const activeMembers = (group: Pick<GroupDetail, 'members'>) => group.members.filter((m) => !m.leftAt);

/** Every member by id, including people who left (old expenses still name them). */
export const memberMap = (group: Pick<GroupDetail, 'members'>) => new Map<string, GroupMemberView>(group.members.map((m) => [m.id, m]));
