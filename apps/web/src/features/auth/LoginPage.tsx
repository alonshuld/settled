import { AlertCircle, ChevronRight, Mail, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useConfig } from '@/api/config';
import { Button, buttonClass } from '@/components/ui/Button';
import { Input, inputClass } from '@/components/ui/Input';
import { LogoMark } from '@/components/ui/Logo';
import { PrefControls } from '@/components/ui/PrefControls';
import { Stamp } from '@/components/ui/Stamp';
import { authClient, resetSessionData, useSession } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { errorCode, errorMessage } from '@/lib/errors';
import { safeNext } from '@/lib/nav';
import { isEmail, maskPhone, toE164 } from '@/lib/phone';
import { toast } from '@/lib/toast';
import { useGuestSignIn } from './useGuestSignIn';
import { LoginHeroCompact, LoginHeroWide } from './LoginHero';
import { OTP_LENGTH, OtpInput } from './OtpInput';
import { OtpStep } from './OtpStep';

type Method = 'email' | 'phone';
type Step = 'start' | 'otp' | 'done';
const ATTEMPTS = 3; // server `allowedAttempts`

export function Component() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { data: config } = useConfig();
  const { data: session } = useSession();
  const guestSignIn = useGuestSignIn();

  const auth = config?.auth;
  const methods: Method[] = [...(auth?.emailOtp ? (['email'] as const) : []), ...(auth?.phoneOtp ? (['phone'] as const) : [])];

  const [step, setStep] = useState<Step>('start');
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [startError, setStartError] = useState<string | null>(params.get('error') ? t('login.googleFailed') : null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [wrongCode, setWrongCode] = useState(false);
  const [failures, setFailures] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState<'google' | 'guest' | null>(null);

  const activeMethod = methods.includes(method) ? method : (methods[0] ?? 'email');
  const target = activeMethod === 'email' ? email.trim() : (toE164(phone) ?? '');

  // A real account has nothing to do here; a guest may still upgrade by signing in (the server merges them).
  useEffect(() => {
    if (step !== 'done') return;
    const id = setTimeout(() => navigate(next, { replace: true }), 1600);
    return () => clearTimeout(id);
  }, [step, next, navigate]);

  if (step === 'start' && session && !session.user.isAnonymous) return <Navigate to={next} replace />;

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (sending) return;
    if (activeMethod === 'email' && !isEmail(email)) return setStartError(t('login.invalidEmail'));
    if (activeMethod === 'phone' && !toE164(phone)) return setStartError(t('login.invalidPhone'));
    setStartError(null);
    setSending(true);
    try {
      await requestCode();
      setCode('');
      setCodeError(null);
      setWrongCode(false);
      setFailures(0);
      setStep('otp');
    } catch (err) {
      setStartError(errorMessage(t, err));
    } finally {
      setSending(false);
    }
  }

  async function requestCode() {
    const res =
      activeMethod === 'email'
        ? await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' })
        : await authClient.phoneNumber.sendOtp({ phoneNumber: target });
    if (res.error) throw res.error;
  }

  async function resend() {
    try {
      await requestCode();
      setCode('');
      setCodeError(null);
      setWrongCode(false);
      setFailures(0);
      toast.success(t('login.resent'));
    } catch (err) {
      toast.error(err);
      throw err;
    }
  }

  async function verify(value: string) {
    if (verifying || value.length !== OTP_LENGTH) return;
    setVerifying(true);
    setCodeError(null);
    try {
      const res =
        activeMethod === 'email'
          ? await authClient.signIn.emailOtp({ email: email.trim(), otp: value })
          : await authClient.phoneNumber.verify({ phoneNumber: target, code: value });
      if (res.error) throw res.error;
      resetSessionData();
      setStep('done');
    } catch (err) {
      if (errorCode(err) === 'INVALID_OTP') {
        const left = ATTEMPTS - (failures + 1);
        setFailures(failures + 1);
        setWrongCode(true);
        setCodeError(left > 0 ? t('login.wrongCode', { count: left }) : t('errors.TOO_MANY_ATTEMPTS'));
      } else {
        setWrongCode(false);
        setCodeError(errorMessage(t, err));
        setCode('');
      }
    } finally {
      setVerifying(false);
    }
  }

  async function google() {
    setBusy('google');
    setStartError(null);
    const res = await authClient.signIn.social({
      provider: 'google',
      callbackURL: next,
      errorCallbackURL: '/login?error=google',
    });
    // On success the browser is already navigating to Google.
    if (res.error) {
      setBusy(null);
      setStartError(errorMessage(t, res.error));
    }
  }

  async function guest() {
    setBusy('guest');
    setStartError(null);
    const error = await guestSignIn();
    if (error) {
      setBusy(null);
      return setStartError(error);
    }
    navigate(next, { replace: true });
  }

  const hasOtp = methods.length > 0;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center gap-2 px-5 py-4 md:gap-3 md:px-8 md:py-5">
        <span className="flex items-center gap-2.5">
          <LogoMark size={40} />
          <span className="text-[19px] font-bold tracking-tight md:text-[22px]">{t('brand')}</span>
        </span>
        <div className="flex-1" />
        <PrefControls />
      </header>

      <main className="mx-auto flex w-full max-w-350 flex-1 flex-wrap gap-6 px-5 pb-8 md:px-8">
        <div className="hidden min-w-0 flex-1 basis-130 lg:flex">
          <LoginHeroWide />
        </div>
        <div className="flex min-w-0 flex-1 basis-105 flex-col items-center justify-center gap-8 py-2 md:py-6">
          <div className={cn('w-full max-w-105 lg:hidden', step !== 'start' && 'max-md:hidden')}>
            <LoginHeroCompact />
          </div>

          <div className="flex w-full max-w-105 flex-col gap-5.5">
            {step === 'start' && (
              <>
                <div className="flex flex-col gap-2.5">
                  <h2 className="text-[34px] font-bold tracking-tight">{t('login.welcome')}</h2>
                  <p className="text-base leading-normal text-muted">{t('login.welcomeSub')}</p>
                </div>

                {auth?.google && (
                  <Button variant="ghost" size="lg" loading={busy === 'google'} onClick={google}>
                    {busy !== 'google' && (
                      <span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full bg-ink text-sm font-bold text-bg">
                        G
                      </span>
                    )}
                    {t('login.google')}
                  </Button>
                )}

                {auth?.google && hasOtp && (
                  <div className="flex items-center gap-3.5 text-sm text-muted">
                    <span className="h-px flex-1 bg-line" />
                    {t('login.or')}
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}

                {hasOtp && (
                  <form className="flex flex-col gap-3" onSubmit={sendCode} noValidate>
                    {methods.length > 1 && (
                      <div role="group" aria-label={t('login.method')} className="flex gap-1 rounded-control border border-line bg-surface2 p-1">
                        {methods.map((m) => (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={activeMethod === m}
                            onClick={() => {
                              setMethod(m);
                              setStartError(null);
                            }}
                            className={cn(
                              'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] px-3.5 text-[15px] font-medium',
                              activeMethod === m ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,.14)]' : 'text-muted',
                            )}
                          >
                            {m === 'email' ? <Mail size={17} aria-hidden="true" /> : <Smartphone size={17} aria-hidden="true" />}
                            {t(`login.${m}`)}
                          </button>
                        ))}
                      </div>
                    )}

                    {activeMethod === 'email' ? (
                      <div className="flex flex-col gap-2">
                        <label htmlFor="login-email" className="text-sm font-medium text-muted">
                          {t('login.emailLabel')}
                        </label>
                        <Input
                          id="login-email"
                          type="email"
                          dir="ltr"
                          autoComplete="email"
                          inputMode="email"
                          placeholder="name@example.com"
                          value={email}
                          aria-invalid={!!startError || undefined}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setStartError(null);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <label htmlFor="login-phone" className="text-sm font-medium text-muted">
                          {t('login.phoneLabel')}
                        </label>
                        <div dir="ltr" className="flex gap-2">
                          <span className={cn(inputClass, 'inline-flex w-auto flex-none items-center gap-1.5 font-medium')}>IL +972</span>
                          <Input
                            id="login-phone"
                            type="tel"
                            autoComplete="tel-national"
                            placeholder="50-123-4567"
                            value={phone}
                            aria-invalid={!!startError || undefined}
                            onChange={(e) => {
                              setPhone(e.target.value);
                              setStartError(null);
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <Button type="submit" size="lg" loading={sending}>
                      {sending ? t('login.sending') : t('login.sendCode')}
                    </Button>
                  </form>
                )}

                {startError && (
                  <div role="alert" className="flex items-center gap-2.5 rounded-control bg-neg-bg px-3.5 py-3 text-sm font-medium text-neg">
                    <AlertCircle size={18} aria-hidden="true" className="flex-none" />
                    {startError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  {auth?.guest ? (
                    <Button variant="text" className="text-[15px] font-medium text-muted" loading={busy === 'guest'} onClick={guest}>
                      {t('login.guest')}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Link
                    to="/j"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-1.5 text-[15px] font-semibold hover:bg-surface2"
                  >
                    {t('login.haveCode')}
                    <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" className="rtl:-scale-x-100" />
                  </Link>
                </div>
                {hasOtp && <p className="text-center text-xs leading-normal text-muted">{t('login.terms')}</p>}
              </>
            )}

            {step === 'otp' && (
              <OtpStep
                method={activeMethod}
                target={activeMethod === 'email' ? email.trim() : maskPhone(target)}
                error={codeError}
                verifying={verifying}
                canVerify={code.length === OTP_LENGTH}
                onVerify={() => verify(code)}
                onResend={resend}
                onBack={() => {
                  setStep('start');
                  setCode('');
                  setCodeError(null);
                }}
              >
                <OtpInput
                  value={code}
                  error={wrongCode && !!codeError}
                  autoFocus
                  onChange={(v) => {
                    setCode(v);
                    setCodeError(null);
                    setWrongCode(false);
                  }}
                  onComplete={verify}
                />
              </OtpStep>
            )}

            {step === 'done' && (
              <div className="flex flex-col items-center gap-6 py-6 text-center">
                <Stamp iconSize={36} className="animate-stamp-in border-pos px-6.5 py-2.5 text-[44px] text-pos">
                  {t('splash.stamp')}
                </Stamp>
                <div className="flex flex-col gap-2">
                  <h2 role="status" className="text-[30px] font-bold">
                    {t('login.inTitle')}
                  </h2>
                  <p className="text-base text-muted">{t('login.inSub')}</p>
                </div>
                <Link to={next} replace className={buttonClass('primary', undefined, 'lg')}>
                  {t('login.toGroups')}
                </Link>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
