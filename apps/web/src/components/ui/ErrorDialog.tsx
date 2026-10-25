import * as RD from '@radix-ui/react-dialog';
import { Check, CircleAlert, Copy, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { closeErrorDialog, useErrorDialog } from '@/lib/errorDialog';
import { Button } from './Button';

/** Alert dialog from the Errors board: icon tile, title, body, support id with copy, retry / dismiss. Mount once. */
export function ErrorDialog() {
  const { t } = useTranslation();
  const state = useErrorDialog();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCopied(false), [state]);

  const offline = state?.code === 'NETWORK';
  const Icon = offline ? WifiOff : CircleAlert;

  async function copy() {
    if (!state?.requestId) return;
    try {
      await navigator.clipboard.writeText(state.requestId);
      setCopied(true);
    } catch {
      /* clipboard blocked: the id stays visible for manual copy */
    }
  }

  async function retry() {
    if (!state?.retry) return;
    setBusy(true);
    try {
      closeErrorDialog();
      await state.retry();
    } finally {
      setBusy(false);
    }
  }

  return (
    <RD.Root open={!!state} onOpenChange={(o) => !o && closeErrorDialog()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-70 bg-black/50 data-[state=open]:animate-fade-up" />
        <RD.Content
          role="alertdialog"
          aria-describedby="error-dialog-body"
          className="fixed inset-0 z-70 m-auto flex h-fit w-[calc(100%-2rem)] max-w-sm flex-col gap-3.5 rounded-[22px] border border-line bg-surface p-6 shadow-[0_20px_50px_rgba(0,0,0,.22)] data-[state=open]:animate-fade-up"
        >
          <span
            aria-hidden="true"
            className={cn('inline-flex size-12 items-center justify-center rounded-[14px]', offline ? 'bg-surface2 text-ink' : 'bg-neg-bg text-neg')}
          >
            <Icon size={24} />
          </span>
          <div className="flex flex-col gap-1.5">
            <RD.Title className="text-[19px] font-semibold">{t(offline ? 'errorDialog.offlineTitle' : 'errorDialog.serverTitle')}</RD.Title>
            <RD.Description id="error-dialog-body" className="text-sm leading-relaxed text-muted">
              {state ? t(`errors.${state.code}`) : ''}
            </RD.Description>
          </div>
          {state?.requestId && (
            <div className="flex items-center gap-2 rounded-control bg-surface2 ps-3 pe-1 text-[13px] text-muted">
              <span className="flex-none">{t('errorDialog.requestId')}</span>
              <span dir="ltr" className="min-w-0 flex-1 py-2 text-start font-mono text-xs break-all text-ink">
                {state.requestId}
              </span>
              <button
                type="button"
                onClick={copy}
                aria-label={t('errorDialog.copy')}
                className="inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-control hover:bg-line"
              >
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              </button>
              <span role="status" className="sr-only">
                {copied ? t('errorDialog.copied') : ''}
              </span>
            </div>
          )}
          <div className="mt-1 flex gap-2">
            {state?.retry ? (
              <>
                <RD.Close asChild>
                  <Button variant="ghost" className="flex-1">
                    {t('common.close')}
                  </Button>
                </RD.Close>
                <Button className="flex-1" loading={busy} onClick={retry}>
                  {t('common.retry')}
                </Button>
              </>
            ) : (
              <RD.Close asChild>
                <Button className="flex-1">{t('common.close')}</Button>
              </RD.Close>
            )}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
