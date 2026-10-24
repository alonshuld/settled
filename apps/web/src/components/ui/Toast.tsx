import { Check, CircleAlert, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { dismissToast, useToasts, type ToastKind } from '@/lib/toast';

const icon: Record<ToastKind, { Icon: typeof Check; chip: string }> = {
  error: { Icon: CircleAlert, chip: 'bg-[#3a1a0e] text-[#ff9568]' },
  success: { Icon: Check, chip: 'bg-accent text-accent-ink' },
  warn: { Icon: WifiOff, chip: '' },
};

/** Mount once near the root. Dark pill for error/success, amber for warnings (Errors board). */
export function ToastViewport() {
  const { t } = useTranslation();
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex flex-col items-center gap-2 md:bottom-6">
      {toasts.map((item) => {
        const { Icon, chip } = icon[item.kind];
        const warn = item.kind === 'warn';
        return (
          <div
            key={item.id}
            role={item.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex min-h-14 w-full max-w-md items-center gap-3 rounded-[14px] py-2.5 ps-4 pe-2.5 shadow-[0_10px_30px_rgba(0,0,0,.2)]',
              warn ? 'bg-warn-bg font-medium text-warn' : 'bg-hero text-[#f2f3f5]',
            )}
          >
            {warn ? (
              <Icon size={20} aria-hidden="true" className="flex-none" />
            ) : (
              <span className={cn('inline-flex size-7 flex-none items-center justify-center rounded-full', chip)}>
                <Icon size={16} strokeWidth={2.4} aria-hidden="true" />
              </span>
            )}
            <span className="flex-1 text-[15px]">{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="min-h-11 flex-none cursor-pointer rounded-control bg-[#1f242b] px-3.5 text-sm font-semibold text-accent"
                onClick={() => {
                  dismissToast(item.id);
                  item.action!.onClick();
                }}
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label={t('common.dismiss')}
              className="inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-control opacity-70 hover:opacity-100"
              onClick={() => dismissToast(item.id)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
