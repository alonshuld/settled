import { Bell, Check, Plus, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ActivityItem } from '@/api/activity';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { cn } from '@/lib/cn';
import { describeActivity, type ActivityGlyph, type DaySection } from '@/lib/activityText';
import { formatDate, formatMoney, type Lang } from '@/lib/format';

const GLYPHS: Record<ActivityGlyph, { Icon: LucideIcon; bg: string }> = {
  expense: { Icon: Plus, bg: '#9CC8FF' },
  payment: { Icon: Check, bg: '#C6F135' },
  reminder: { Icon: Bell, bg: '#FFB59A' },
  member: { Icon: Users, bg: '#E2B6FF' },
  group: { Icon: Users, bg: '#9EE6CF' },
};

export function activityTime(iso: string, lang: Lang, section: DaySection | 'compact') {
  const time = { hour: '2-digit', minute: '2-digit' } as const;
  return section === 'earlier' || section === 'compact'
    ? formatDate(iso, lang, { day: 'numeric', month: 'short', ...time })
    : formatDate(iso, lang, time);
}

/** One feed row, shared by the Activity page and the Home side panel. */
export function ActivityRow({ item, section, compact }: { item: ActivityItem; section: DaySection | 'compact'; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const d = describeActivity(item, (minor, cur) => formatMoney(minor, cur, lang));
  const { Icon, bg } = GLYPHS[d.glyph];
  const size = compact ? 36 : 44;

  return (
    <li>
      <Link
        to={`/groups/${item.groupId}`}
        className={cn('flex items-start rounded-2xl hover:bg-surface2', compact ? 'gap-3 p-2.5' : 'gap-3.5 p-4')}
      >
        <span className="relative flex-none">
          <MemberAvatar name={item.actor?.name ?? item.groupName} color={item.actor?.color} size={size} />
          <span
            style={{ background: bg }}
            className={cn(
              'absolute -end-1 -bottom-1 inline-flex items-center justify-center rounded-full border-2 border-surface text-accent-ink',
              compact ? 'size-5' : 'size-6',
            )}
          >
            <Icon size={compact ? 10 : 12} strokeWidth={2.6} aria-hidden="true" />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('leading-snug', compact ? 'text-sm' : 'text-[15px]')}>{t(d.key, d.params)}</span>
          <span className="truncate text-[13px] text-muted">
            {item.groupName} · {activityTime(item.createdAt, lang, section)}
          </span>
        </span>
        {d.amount && !compact && (
          <span className={cn('text-base font-semibold', d.amount.tone === 'pos' && 'text-pos')}>{d.amount.text}</span>
        )}
        {item.unread && (
          <>
            <span aria-hidden="true" className="mt-2 size-2 flex-none rounded-full bg-neg" />
            <span className="sr-only">{t('activity.unread')}</span>
          </>
        )}
      </Link>
    </li>
  );
}
