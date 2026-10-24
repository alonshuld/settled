import { BedDouble, Car, Ellipsis, Fuel, ShoppingCart, Ticket, Utensils, type LucideIcon } from 'lucide-react';
import type { Category } from '@/api/expenses';

/** Tint colours come from the design's expense-category pastels (also used for the breakdown bar). */
export const CATEGORY_META: Record<Category, { Icon: LucideIcon; color: string }> = {
  food: { Icon: Utensils, color: '#FFB59A' },
  stay: { Icon: BedDouble, color: '#9CC8FF' },
  transport: { Icon: Car, color: '#FFE08A' },
  fuel: { Icon: Fuel, color: '#FFE08A' },
  shopping: { Icon: ShoppingCart, color: '#E2B6FF' },
  activities: { Icon: Ticket, color: '#9EE6CF' },
  other: { Icon: Ellipsis, color: '#D5D9E0' },
};

export function CategoryIcon({ category, size = 44 }: { category: Category; size?: number }) {
  const { Icon, color } = CATEGORY_META[category] ?? CATEGORY_META.other;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, background: color, borderRadius: Math.round(size * 0.3) }}
      className="inline-flex flex-none items-center justify-center text-accent-ink"
    >
      <Icon size={Math.round(size * 0.47)} strokeWidth={1.8} />
    </span>
  );
}
