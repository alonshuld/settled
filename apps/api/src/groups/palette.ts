/** Avatar palette (design handoff); the first colour is "you", so the creator gets it. */
export const AVATAR_COLORS = ['#C6F135', '#FFB59A', '#9CC8FF', '#E2B6FF', '#FFE08A', '#9EE6CF'];

export const colorFor = (index: number) => AVATAR_COLORS[index % AVATAR_COLORS.length]!;
