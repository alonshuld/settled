import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button, IconButton } from './Button';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Sticks to the bottom of the panel (action buttons). */
  footer?: ReactNode;
  className?: string;
}

function Header({ title, description }: Pick<BaseProps, 'title' | 'description'>) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <RD.Title className="text-lg font-semibold">{title}</RD.Title>
        {description ? (
          <RD.Description className="text-[15px] text-muted">{description}</RD.Description>
        ) : null}
      </div>
      <RD.Close asChild>
        <IconButton aria-label={t('common.close')} className="-me-1.5 -mt-1.5 border-0 bg-transparent">
          <X size={20} aria-hidden="true" />
        </IconButton>
      </RD.Close>
    </div>
  );
}

// Radix warns when a dialog has no Description; an explicit undefined says that is intended.
const noDescription = (description?: string) => (description ? {} : { 'aria-describedby': undefined });

const overlay = 'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-fade-up';

/** Centered modal (Radix: focus trap, Esc, scroll lock). */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: BaseProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlay} />
        <RD.Content
         
          className={cn(
            'fixed inset-0 z-50 m-auto flex h-fit max-h-[90dvh] w-[calc(100%-2rem)] max-w-md flex-col gap-4 overflow-y-auto rounded-card border border-line bg-surface p-5 shadow-[0_20px_60px_rgba(0,0,0,.3)] data-[state=open]:animate-fade-up',
            className,
          )}
        >
          <Header title={title} description={description} />
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-2.5">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/**
 * Bottom sheet below `md`, side drawer at the inline end from `md` up. The body scrolls, header and footer stay.
 * Add-expense and remind reuse it on phone.
 */
export function Sheet({ open, onOpenChange, title, description, children, footer, className }: BaseProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlay} />
        <RD.Content
         
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-line bg-surface shadow-[0_-10px_40px_rgba(0,0,0,.25)] data-[state=open]:animate-fade-up md:inset-x-auto md:inset-y-0 md:end-0 md:max-h-none md:w-110 md:rounded-none md:rounded-s-3xl',
            className,
          )}
        >
          <div className="p-5 pb-3">
            <Header title={title} description={description} />
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2.5 border-t border-line p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Yes/no confirmation. `onConfirm` is the caller's mutation; the dialog stays open while it runs. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading,
  danger,
}: Omit<BaseProps, 'children' | 'footer' | 'className'> & {
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
