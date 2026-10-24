import { AlertCircle, ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

const RESEND_SECONDS = 45;

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, () => setLeft(seconds)] as const;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export interface OtpStepProps {
  method: 'email' | 'phone';
  /** Shown (and read) as a left-to-right island: the email or masked phone. */
  target: string;
  /** Message for the alert under the boxes, or null. */
  error: string | null;
  verifying: boolean;
  onBack: () => void;
  onResend: () => Promise<void>;
  children: React.ReactNode;
  onVerify: () => void;
  canVerify: boolean;
}

/** Layout of the "enter your code" step (Main board OTP state / PhoneVerify). The boxes come in as children. */
export function OtpStep({ method, target, error, verifying, onBack, onResend, children, onVerify, canVerify }: OtpStepProps) {
  const { t } = useTranslation();
  const [left, restart] = useCountdown(RESEND_SECONDS);
  const [resending, setResending] = useState(false);

  async function resend() {
    setResending(true);
    try {
      await onResend();
      restart();
    } finally {
      setResending(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canVerify && !verifying) onVerify();
      }}
    >
      <Button variant="text" onClick={onBack} className="self-start font-medium text-muted">
        <ChevronLeft size={18} aria-hidden="true" className="rtl:-scale-x-100" />
        {t('common.back')}
      </Button>
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[32px] font-bold tracking-tight">{t('login.otpTitle')}</h2>
        <p className="text-base leading-normal text-muted">
          {method === 'email' ? t('login.otpSubEmail') : t('login.otpSubPhone')}{' '}
          <bdi dir="ltr" className="font-semibold text-ink">
            {target}
          </bdi>
        </p>
      </div>
      {children}
      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-control bg-neg-bg px-3.5 py-3 text-sm font-medium text-neg">
          <AlertCircle size={18} aria-hidden="true" className="flex-none" />
          {error}
        </div>
      )}
      <Button type="submit" loading={verifying} disabled={!canVerify && !verifying} size="lg">
        {verifying ? t('login.verifying') : t('login.verify')}
      </Button>
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted">
        {t('login.noCode')}
        {left > 0 ? (
          <span className="font-semibold text-ink">
            {t('login.resendIn')} <bdi dir="ltr">{mmss(left)}</bdi>
          </span>
        ) : (
          <Button variant="text" loading={resending} onClick={resend} className="font-semibold">
            {t('login.resend')}
          </Button>
        )}
      </div>
    </form>
  );
}
