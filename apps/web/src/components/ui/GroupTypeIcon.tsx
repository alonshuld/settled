import { Ellipsis, Gift, House, Plane, Star, Utensils, type LucideIcon } from 'lucide-react';
import type { GroupType } from '@/api/groups';
import { cn } from '@/lib/cn';

// Literal class names so Tailwind can see them.
const TYPES: Record<GroupType, { Icon: LucideIcon; tint: string }> = {
  trip: { Icon: Plane, tint: 'bg-tint-trip' },
  home: { Icon: House, tint: 'bg-tint-home' },
  event: { Icon: Star, tint: 'bg-tint-event' },
  meal: { Icon: Utensils, tint: 'bg-tint-meal' },
  gift: { Icon: Gift, tint: 'bg-tint-gift' },
  other: { Icon: Ellipsis, tint: 'bg-tint-other' },
};

/** Tinted rounded tile with the group-type glyph (cards, previews, tiles). */
export function GroupTypeIcon({
  type,
  size = 48,
  className,
}: {
  type: GroupType;
  size?: number;
  className?: string;
}) {
  const { Icon, tint } = TYPES[type] ?? TYPES.other;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.29) }}
      className={cn('inline-flex flex-none items-center justify-center text-accent-ink', tint, className)}
    >
      <Icon size={Math.round(size * 0.45)} strokeWidth={1.8} />
    </span>
  );
}
