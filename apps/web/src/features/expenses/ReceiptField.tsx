import { Camera, ImageOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isReceiptType, RECEIPT_MAX_BYTES, useUploadReceiptMutation, useUploadsAvailable } from '@/api/uploads';
import { IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/lib/toast';

/**
 * Receipt picker: presign -> direct PUT to R2. Renders nothing when storage isn't configured (the API answers 503
 * UPLOADS_UNAVAILABLE) unless the expense already has a receipt to show or remove.
 */
export function ReceiptField({
  groupId,
  receiptKey,
  existingUrl,
  onChange,
  onBusyChange,
  labelClass,
}: {
  groupId: string;
  receiptKey: string | null;
  /** Signed view URL of the receipt the expense already has. */
  existingUrl?: string | null;
  onChange: (key: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  labelClass: string;
}) {
  const { t } = useTranslation();
  const available = useUploadsAvailable();
  const upload = useUploadReceiptMutation(groupId);
  const input = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<{ url: string; name: string } | null>(null);
  const [broken, setBroken] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => () => void (local && URL.revokeObjectURL(local.url)), [local]);
  useEffect(() => onBusyChange(upload.isPending), [upload.isPending, onBusyChange]);

  if (!receiptKey && !upload.isPending && !available) return null;

  function pick(file: File | undefined) {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!isReceiptType(file.type)) return setProblem(t('expense.receiptType'));
    if (file.size > RECEIPT_MAX_BYTES) return setProblem(t('expense.receiptSize'));
    setProblem(null);
    upload.mutate(file, {
      onSuccess: (key) => {
        setBroken(false);
        setLocal({ url: URL.createObjectURL(file), name: file.name });
        onChange(key);
      },
      onError: (e) => toast.error(e),
    });
  }

  const src = local?.url ?? existingUrl ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={labelClass}>{t('expense.receipt')}</span>
      {receiptKey ? (
        <div className="flex items-center gap-3 rounded-control border border-line bg-surface2 p-2">
          {src && !broken ? (
            <img
              src={src}
              alt={t('expense.receiptPreview')}
              onError={() => setBroken(true)}
              className="size-14 flex-none rounded-[10px] object-cover"
            />
          ) : (
            <span aria-hidden="true" className="inline-flex size-14 flex-none items-center justify-center rounded-[10px] bg-surface text-muted">
              <ImageOff size={22} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{local?.name ?? t('expense.receiptAttached')}</span>
          <IconButton
            aria-label={t('expense.receiptRemove')}
            onClick={() => {
              setLocal(null);
              setBroken(false);
              onChange(null);
            }}
            className="border-0 bg-transparent"
          >
            <X size={20} aria-hidden="true" />
          </IconButton>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-busy={upload.isPending || undefined}
          className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-dashed border-line bg-surface px-4 font-medium text-muted hover:bg-surface2 aria-busy:cursor-progress"
        >
          {upload.isPending ? <Spinner size={18} /> : <Camera size={18} aria-hidden="true" />}
          {upload.isPending ? t('expense.receiptUploading') : t('expense.receiptAdd')}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={upload.isPending}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {problem && (
        <p role="alert" className="text-sm text-neg">
          {problem}
        </p>
      )}
    </div>
  );
}
