import { cn } from '@/lib/cn';

// Avatar palette from the design handoff; index 0 is "you". Same order the API assigns member colours in.
export const AVATAR_COLORS = ['#C6F135', '#FFB59A', '#9CC8FF', '#E2B6FF', '#FFE08A', '#9EE6CF'] as const;

export const avatarColor = (index: number) => AVATAR_COLORS[((index % 6) + 6) % 6]!;

/** Initial on a pastel circle. Pass the server's `color` when known, otherwise it follows the member index. */
export function MemberAvatar({
  name,
  index = 0,
  color,
  size = 32,
  ring,
  className,
}: {
  name?: string;
  index?: number;
  color?: string;
  size?: number;
  /** Surface-coloured outline for overlapping stacks. */
  ring?: boolean;
  className?: string;
}) {
  const initial = name ? ([...name.trim()][0]?.toUpperCase() ?? '') : '';
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: color ?? avatarColor(index) }}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-full font-semibold text-accent-ink',
        ring && 'border-2 border-surface',
        className,
      )}
    >
      {initial}
    </span>
  );
}

/**
 * Overlapping avatars. The group-list API only gives a member count, so with `total` alone the circles are
 * anonymous; pass `members` where names are known (join preview, group page).
 */
export function GroupAvatarStack({
  members,
  total,
  max = 4,
  size = 32,
}: {
  members?: { name: string; color?: string }[];
  total?: number;
  max?: number;
  size?: number;
}) {
  const count = total ?? members?.length ?? 0;
  const shown = Math.min(count, max);
  const extra = count - shown;
  return (
    <span className="flex items-center" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <MemberAvatar
          key={i}
          index={i}
          name={members?.[i]?.name}
          color={members?.[i]?.color}
          size={size}
          ring
          className="-me-2"
        />
      ))}
      {extra > 0 && (
        <span
          style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
          className="inline-flex flex-none items-center justify-center rounded-full border-2 border-surface bg-surface2 font-semibold text-muted"
          dir="ltr"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
