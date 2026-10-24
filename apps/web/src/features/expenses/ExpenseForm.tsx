import { idempotencyKey } from '@settled/api-client';
import { Check, Minus, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, useNavigate } from 'react-router';
import {
  CATEGORIES,
  useCreateExpenseMutation,
  useDeleteExpenseMutation,
  useUpdateExpenseMutation,
  type CreateExpenseBody,
  type ExpenseDetail,
  type SplitMode,
  type UpdateExpenseBody,
} from '@/api/expenses';
import { useFxRate } from '@/api/fx';
import type { GroupDetail, GroupMemberView } from '@/api/groupDetail';
import { useCurrencies } from '@/api/groups';
import { Button, IconButton } from '@/components/ui/Button';
import { CATEGORY_META } from '@/components/ui/CategoryIcon';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Input, inputClass } from '@/components/ui/Input';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { PrefControls } from '@/components/ui/PrefControls';
import { cn } from '@/lib/cn';
import { errorCode } from '@/lib/errors';
import {
  buildCreateBody,
  buildUpdateBody,
  computeExpense,
  draftFromExpense,
  draftSignature,
  emptyDraft,
  MAX_DESCRIPTION,
  MAX_SHARES,
  sanitizeAmount,
  type ExpenseDraft,
  type FormError,
} from '@/lib/expenseForm';
import { effectFor } from '@/lib/expenses';
import { formatDate, formatMoney, type Lang } from '@/lib/format';
import { toast } from '@/lib/toast';
import { ReceiptField } from './ReceiptField';

const card = 'rounded-card border border-line bg-surface p-5 md:p-7';
const label = 'text-sm font-medium text-muted';
const stepper =
  'inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-[10px] border border-line bg-surface text-ink hover:bg-surface2';
const QUICK_CURRENCIES = ['ILS', 'EUR', 'USD'];
const MODES: SplitMode[] = ['equal', 'exact', 'shares'];

function currencySymbol(currency: string, lang: string) {
  try {
    return (
      new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-neg">
      {children}
    </p>
  );
}

/** Add / edit an expense. Pass `expense` to edit; the parent remounts this (new `key`) to load a newer version. */
export function ExpenseForm({
  group,
  expense,
  onReload,
}: {
  group: GroupDetail;
  expense?: ExpenseDetail;
  onReload?: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const navigate = useNavigate();
  const groupPath = `/groups/${group.id}`;
  const currencies = useCurrencies();

  // Members who left stay selectable only on expenses that already involve them.
  const members = useMemo(() => {
    const involved = new Set(expense ? [expense.paidByMemberId, ...expense.shares.map((s) => s.memberId)] : []);
    return group.members.filter((m) => !m.leftAt || involved.has(m.id));
  }, [group.members, expense]);
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const meId = group.members.find((m) => m.isMe)?.id;

  const [initial] = useState(() =>
    expense
      ? draftFromExpense(expense, memberIds)
      : emptyDraft({ currency: group.currency, memberIds, paidBy: meId && memberIds.includes(meId) ? meId : (memberIds[0] ?? '') }),
  );
  const [draft, setDraft] = useState(initial);
  const patch = (p: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...p }));
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);

  const foreign = draft.currency !== group.currency;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(draft.date);
  const fx = useFxRate(draft.currency, group.currency, draft.date, foreign && dateOk);
  // An untouched edit keeps the rate it was saved with; the server only re-resolves it when amount, currency or date change.
  const marketRate =
    expense && expense.fxSource === 'market' && draft.currency === expense.currency && draft.date === expense.date
      ? expense.fxRate
      : (fx.data?.rate ?? null);

  const ctx = useMemo(() => ({ groupCurrency: group.currency, memberIds, marketRate }), [group.currency, memberIds, marketRate]);
  const computed = useMemo(() => computeExpense(draft, ctx), [draft, ctx]);
  const dirty = draftSignature(draft) !== draftSignature(initial);

  const create = useCreateExpenseMutation(group.id);
  const update = useUpdateExpenseMutation(group.id, expense?.id ?? '');
  const del = useDeleteExpenseMutation(group.id);
  const pending = create.isPending || update.isPending;
  // One key per distinct payload: retrying the same submit replays it, an edited form gets a fresh one.
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  const saved = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saved.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const done = (message: string) => {
    saved.current = true;
    toast.success(message);
    navigate(groupPath, { replace: true });
  };

  function onSaveError(err: unknown) {
    if (errorCode(err) === 'VERSION_CONFLICT') setConflict(true);
    else toast.error(err, { label: t('common.retry'), onClick: () => submit() });
  }

  function submit() {
    setSubmitted(true);
    if (pending || uploading) return;
    if (!computed.valid) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (expense) {
      const body = buildUpdateBody(draft, expense, ctx);
      update.mutate(body as UpdateExpenseBody, { onSuccess: () => done(t('expense.updated')), onError: onSaveError });
    } else {
      const body = buildCreateBody(draft, ctx) as CreateExpenseBody;
      const sig = JSON.stringify(body);
      if (attempt.current?.sig !== sig) attempt.current = { sig, key: idempotencyKey() };
      create.mutate({ body, key: attempt.current.key }, { onSuccess: () => done(t('expense.created')), onError: onSaveError });
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onBusy = useCallback((busy: boolean) => setUploading(busy), []);

  const money = (minor: number, currency = group.currency) => formatMoney(minor, currency, lang);
  const errText = (e?: FormError) =>
    e ? t(`expense.err.${e.code}`, { amount: e.params?.diff === undefined ? '' : money(Number(e.params.diff), draft.currency) }) : '';
  const show = (e?: FormError) => (submitted ? e : undefined);
  const errs = computed.errors;

  const currencyOptions = useMemo(() => {
    const all = (currencies.data ?? []).map((c) => c.code);
    const rest = all.filter((c) => c !== group.currency && c !== draft.currency && !QUICK_CURRENCIES.includes(c)).sort();
    const head = [group.currency, draft.currency, ...QUICK_CURRENCIES.filter((c) => !all.length || all.includes(c))];
    return [...new Set([...head, ...rest])];
  }, [currencies.data, group.currency, draft.currency]);

  const symbol = currencySymbol(draft.currency, lang);
  const nameOf = (m: GroupMemberView) => (m.isMe ? t('expense.you') : m.displayName);
  const payer = members.find((m) => m.id === draft.paidBy);

  const effect = useMemo(() => {
    if (!computed.shares || computed.baseMinor === null) return null;
    return effectFor(
      {
        paidByMemberId: draft.paidBy,
        baseAmount: computed.baseMinor,
        shares: [...computed.shares].map(([memberId, amount]) => ({ memberId, amount, originalAmount: null, shares: null })),
      },
      meId,
    );
  }, [computed.shares, computed.baseMinor, draft.paidBy, meId]);

  const participantCount = computed.shares
    ? computed.shares.size
    : draft.mode === 'equal'
      ? draft.included.length
      : draft.mode === 'shares'
        ? Object.values(draft.shares).filter((n) => n > 0).length
        : Object.values(draft.exact).filter((v) => v.trim() !== '' && Number(v.replace(',', '.')) > 0).length;

  const rateValue = draft.rate ?? marketRate ?? '';
  const saveLabel = pending ? t('expense.saving') : expense ? t('expense.saveChanges') : t('expense.save');
  const amountErr = show(errs.amount);
  const splitErr = show(errs.split);
  const exactLive = draft.mode === 'exact' && computed.minor !== null ? computed.exactSum - computed.minor : null;

  const saveButton = (
    <Button type="submit" size="lg" loading={pending} disabled={uploading}>
      {saveLabel}
    </Button>
  );

  return (
    <div className="mx-auto max-w-300 px-5 pt-3 pb-10 md:px-8 md:pt-8 md:pb-14">
      <div className="mb-4 flex items-center gap-2 md:mb-6 md:gap-4">
        <IconButton aria-label={t('common.close')} onClick={() => navigate(groupPath)}>
          <X size={20} aria-hidden="true" />
        </IconButton>
        <div className="flex min-w-0 flex-1 flex-col max-md:items-center">
          <h1 className="text-base font-semibold md:text-[28px] md:font-bold md:tracking-tight">
            {expense ? t('expense.titleEdit') : t('expense.titleNew')}
          </h1>
          <span className="truncate text-xs text-muted md:text-sm">{group.name}</span>
        </div>
        <div className="flex gap-2 md:hidden">
          <PrefControls />
        </div>
      </div>

      <form ref={form} onSubmit={onSubmit} noValidate className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <section className={cn(card, 'flex flex-col gap-6 md:gap-7')}>
            <div className="flex flex-col items-center gap-1.5 pt-1">
              <label htmlFor="amt" className={label}>
                {t('expense.amount')}
              </label>
              <div dir="ltr" className="flex max-w-full items-baseline justify-center gap-1.5">
                <span aria-hidden="true" className="text-3xl font-medium text-muted md:text-[40px]">
                  {symbol}
                </span>
                <input
                  id="amt"
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus={!expense}
                  placeholder="0"
                  value={draft.amount}
                  aria-invalid={!!amountErr}
                  aria-describedby={amountErr ? 'amt-err' : undefined}
                  onChange={(e) => patch({ amount: sanitizeAmount(e.target.value) })}
                  style={{ width: `${Math.min(10, Math.max(2, draft.amount.length + 0.5))}ch` }}
                  className="min-w-0 bg-transparent text-center text-[60px] font-bold tracking-[-0.03em] text-ink outline-none placeholder:text-line md:text-[72px]"
                />
              </div>
              <span aria-hidden="true" className="h-[3px] w-30 rounded-sm bg-accent" />
              <div className="mt-1 flex items-center gap-2">
                <label htmlFor="cur" className="sr-only">
                  {t('expense.currency')}
                </label>
                <select
                  id="cur"
                  dir="ltr"
                  value={draft.currency}
                  onChange={(e) => patch({ currency: e.target.value, rate: null })}
                  className={cn(inputClass, 'min-h-11 w-auto text-[15px] font-medium')}
                >
                  {currencyOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {amountErr && <FieldError id="amt-err">{errText(amountErr)}</FieldError>}
            </div>

            {foreign && (
              <div className="flex flex-col gap-2">
                <label htmlFor="fx-rate" className={label}>
                  {t('expense.rate')}
                </label>
                <div dir="ltr" className="flex items-center gap-2.5">
                  <span className="whitespace-nowrap text-muted">{t('expense.rateEq', { from: draft.currency })}</span>
                  <Input
                    id="fx-rate"
                    inputMode="decimal"
                    autoComplete="off"
                    value={rateValue}
                    aria-invalid={!!show(errs.rate)}
                    aria-describedby="fx-note"
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.]/g, '');
                      patch({ rate: v === marketRate ? null : v });
                    }}
                    className="min-w-0 max-w-48"
                  />
                  <span className="text-muted">{group.currency}</span>
                </div>
                <p id="fx-note" className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
                  {draft.rate !== null ? (
                    <>
                      {t('expense.rateManual')}
                      <button type="button" onClick={() => patch({ rate: null })} className="min-h-11 cursor-pointer font-medium text-ink underline">
                        {t('expense.rateReset')}
                      </button>
                    </>
                  ) : fx.isFetching && marketRate === null ? (
                    t('expense.rateLoading')
                  ) : fx.isError && marketRate === null ? (
                    t('expense.rateFailed')
                  ) : (
                    t('expense.rateMarket', { date: formatDate(draft.date, lang, { dateStyle: 'medium' }) })
                  )}
                </p>
                {show(errs.rate) && <FieldError id="fx-err">{errText(errs.rate)}</FieldError>}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="desc" className={label}>
                {t('expense.what')}
              </label>
              <Input
                id="desc"
                value={draft.description}
                maxLength={MAX_DESCRIPTION}
                placeholder={t('expense.whatPh')}
                aria-invalid={!!show(errs.description)}
                aria-describedby={show(errs.description) ? 'desc-err' : undefined}
                onChange={(e) => patch({ description: e.target.value })}
                className="min-h-13.5 text-lg"
              />
              {show(errs.description) && <FieldError id="desc-err">{errText(errs.description)}</FieldError>}
            </div>

            <fieldset className="flex flex-col gap-2.5">
              <legend className={cn(label, 'mb-2.5')}>{t('expense.category')}</legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const { Icon } = CATEGORY_META[c];
                  const on = draft.category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patch({ category: c })}
                      className={cn(
                        'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-medium',
                        on ? 'border-ink bg-ink text-bg' : 'border-line bg-surface2 text-ink hover:border-muted',
                      )}
                    >
                      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                      {t(`group.categories.${c}`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2.5">
              <legend className={cn(label, 'mb-2.5')}>{t('expense.paidBy')}</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {members.map((m, i) => {
                  const on = draft.paidBy === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patch({ paidBy: m.id })}
                      className="flex min-w-16 cursor-pointer flex-col items-center gap-2 p-1 text-sm font-medium"
                    >
                      <span className={cn('inline-flex size-14 items-center justify-center rounded-full border-[2.5px] p-[3px]', on ? 'border-ink' : 'border-transparent')}>
                        <MemberAvatar name={m.displayName} color={m.color} index={i} size={46} />
                      </span>
                      <span className="max-w-20 truncate">{nameOf(m)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-55 flex-1 flex-col gap-2">
                <label htmlFor="dt" className={label}>
                  {t('expense.date')}
                </label>
                <Input
                  id="dt"
                  type="date"
                  value={draft.date}
                  aria-invalid={!!show(errs.date)}
                  onChange={(e) => patch({ date: e.target.value })}
                />
                {show(errs.date) && <FieldError id="dt-err">{errText(errs.date)}</FieldError>}
              </div>
              <div className="flex min-w-55 flex-1 flex-col">
                <ReceiptField
                  groupId={group.id}
                  receiptKey={draft.receiptKey}
                  existingUrl={expense?.receiptKey && draft.receiptKey === expense.receiptKey ? expense.receiptUrl : null}
                  onChange={(receiptKey) => patch({ receiptKey })}
                  onBusyChange={onBusy}
                  labelClass={label}
                />
              </div>
            </div>
          </section>

          <section className={cn(card, 'flex flex-col gap-4.5')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">{t('expense.split')}</h2>
              <div role="group" aria-label={t('expense.modesLabel')} className="flex min-w-60 gap-1 rounded-control border border-line bg-surface2 p-1 max-md:w-full">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={draft.mode === m}
                    onClick={() => patch({ mode: m })}
                    className={cn(
                      'min-h-10 flex-1 cursor-pointer rounded-[10px] px-3.5 text-[15px] font-medium',
                      draft.mode === m ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,.14)]' : 'text-muted',
                    )}
                  >
                    {t(`expense.modes.${m}`)}
                  </button>
                ))}
              </div>
            </div>

            <ul className="flex flex-col gap-0.5">
              {members.map((m, i) => {
                const share = computed.shares?.get(m.id);
                const avatar = <MemberAvatar name={m.displayName} color={m.color} index={i} size={36} />;
                if (draft.mode === 'equal') {
                  const on = draft.included.includes(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => patch({ included: on ? draft.included.filter((id) => id !== m.id) : [...draft.included, m.id] })}
                        className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[14px] p-3 text-start hover:bg-surface2"
                      >
                        <span
                          aria-hidden="true"
                          className={cn('inline-flex size-6.5 flex-none items-center justify-center rounded-lg border-[1.5px]', on ? 'border-accent bg-accent text-accent-ink' : 'border-line')}
                        >
                          {on && <Check size={16} strokeWidth={3} />}
                        </span>
                        {avatar}
                        <span className="min-w-0 flex-1 truncate text-base font-medium">{nameOf(m)}</span>
                        <span className={cn('text-[17px] font-semibold', on ? 'text-ink' : 'text-muted')}>
                          {on ? (share !== undefined ? money(share) : '—') : t('expense.notIncluded')}
                        </span>
                      </button>
                    </li>
                  );
                }
                if (draft.mode === 'exact') {
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-3 py-1.5">
                      {avatar}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium">{nameOf(m)}</span>
                        {foreign && share !== undefined && <span className="text-[13px] text-muted">{money(share)}</span>}
                      </span>
                      <span dir="ltr" className="inline-flex items-center gap-1.5">
                        <span className="text-muted" aria-hidden="true">
                          {symbol}
                        </span>
                        <input
                          aria-label={nameOf(m)}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          value={draft.exact[m.id] ?? ''}
                          onChange={(e) => patch({ exact: { ...draft.exact, [m.id]: sanitizeAmount(e.target.value) } })}
                          className="min-h-11 w-28 rounded-[10px] border border-line bg-surface2 px-3 text-end text-base text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
                        />
                      </span>
                    </li>
                  );
                }
                const n = draft.shares[m.id] ?? 0;
                const set = (v: number) => patch({ shares: { ...draft.shares, [m.id]: Math.min(MAX_SHARES, Math.max(0, v)) } });
                return (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-1.5">
                    {avatar}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base font-medium">{nameOf(m)}</span>
                      <span className="text-[13px] text-muted">{n > 0 && share !== undefined ? money(share) : n > 0 ? '—' : t('expense.notIncluded')}</span>
                    </span>
                    <button type="button" aria-label={`${t('expense.less')}: ${nameOf(m)}`} onClick={() => set(n - 1)} className={stepper}>
                      <Minus size={18} aria-hidden="true" />
                    </button>
                    <span dir="ltr" className="w-8 text-center text-[17px] font-semibold">
                      {n}
                    </span>
                    <button type="button" aria-label={`${t('expense.more')}: ${nameOf(m)}`} onClick={() => set(n + 1)} className={stepper}>
                      <Plus size={18} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>

            {draft.mode === 'exact' && exactLive !== null && computed.exactSum > 0 && (
              <div
                role="status"
                className={cn(
                  'flex justify-between gap-3 rounded-control p-3 text-sm font-medium',
                  exactLive === 0 ? 'bg-pos-bg text-pos' : 'bg-neg-bg text-neg',
                )}
              >
                <span>
                  {exactLive === 0
                    ? t('expense.exactOk')
                    : exactLive < 0
                      ? t('expense.exactUnder', { amount: money(-exactLive, draft.currency) })
                      : t('expense.exactOver', { amount: money(exactLive, draft.currency) })}
                </span>
                <span>{money(computed.exactSum, draft.currency)}</span>
              </div>
            )}
            {splitErr && !(draft.mode === 'exact' && exactLive !== null && computed.exactSum > 0 && ['exactUnder', 'exactOver'].includes(splitErr.code)) && (
              <FieldError id="split-err">{errText(splitErr)}</FieldError>
            )}
            {show(errs.paidBy) && <FieldError id="payer-err">{errText(errs.paidBy)}</FieldError>}
          </section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <div className={cn(card, 'flex flex-col gap-4.5 md:p-6')}>
            <h2 className="text-lg font-semibold">{t('expense.summary')}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-[15px]">
              <dt className="text-muted">{t('expense.total')}</dt>
              <dd className="text-end font-semibold">{computed.minor !== null ? money(computed.minor, draft.currency) : '—'}</dd>
              {foreign && (
                <>
                  <dt className="text-muted">{t('expense.inGroup')}</dt>
                  <dd className="text-end font-semibold">{computed.baseMinor !== null ? money(computed.baseMinor) : '—'}</dd>
                </>
              )}
              <dt className="text-muted">{t('expense.paidByShort')}</dt>
              <dd className="truncate text-end font-semibold">{payer ? nameOf(payer) : '—'}</dd>
              <dt className="text-muted">{t('expense.splitBetween')}</dt>
              <dd className="text-end font-semibold">{t('expense.people', { count: participantCount })}</dd>
            </dl>
            <div aria-live="polite" className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface2 p-4">
              <span className="text-[13px] text-muted">{t('expense.impact')}</span>
              <span
                className={cn(
                  'text-base font-semibold',
                  effect?.kind === 'lent' ? 'text-pos' : effect?.kind === 'borrowed' ? 'text-neg' : 'text-muted',
                )}
              >
                {!effect
                  ? t('expense.impactEmpty')
                  : effect.kind === 'lent'
                    ? t('expense.impactLent', { amount: money(effect.amount) })
                    : effect.kind === 'borrowed'
                      ? t('expense.impactOwe', { name: payer?.displayName ?? '', amount: money(effect.amount) })
                      : t('expense.impactNone')}
              </span>
            </div>
            <div className="max-md:hidden">{saveButton}</div>
            <Button variant="ghost" onClick={() => navigate(groupPath)} className="max-md:hidden">
              {t('expense.cancel')}
            </Button>
            {expense && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={18} aria-hidden="true" />
                {t('expense.delete')}
              </Button>
            )}
          </div>
        </aside>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden">
          {saveButton}
        </div>
      </form>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title={t('expense.discardTitle')}
        description={t('expense.discardBody')}
        confirmLabel={t('expense.discard')}
        danger
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />

      {expense && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          danger
          title={t('group.detail.deleteTitle')}
          description={t('group.detail.deleteBody', { name: expense.description })}
          confirmLabel={t('group.detail.delete')}
          loading={del.isPending}
          onConfirm={() =>
            del.mutate(expense.id, {
              onSuccess: () => {
                setConfirmDelete(false);
                done(t('group.detail.deleted'));
              },
            })
          }
        />
      )}

      <Dialog
        open={conflict}
        onOpenChange={setConflict}
        title={t('expense.conflictTitle')}
        description={t('expense.conflictBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflict(false)}>
              {t('expense.keepEditing')}
            </Button>
            <Button
              loading={reloading}
              onClick={() => {
                setReloading(true);
                void Promise.resolve(onReload?.()).finally(() => setReloading(false));
              }}
            >
              {t('expense.conflictReload')}
            </Button>
          </>
        }
      />
    </div>
  );
}
