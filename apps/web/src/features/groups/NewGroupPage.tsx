import { idempotencyKey } from '@settled/api-client';
import { ArrowLeft, CalendarDays, Plus, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { GROUP_TYPES, useCreateGroupMutation, useCurrencies, type CreateGroupBody, type GroupType } from '@/api/groups';
import { Button, buttonClass } from '@/components/ui/Button';
import { GroupTypeIcon } from '@/components/ui/GroupTypeIcon';
import { Input, inputClass } from '@/components/ui/Input';
import { GroupAvatarStack, MemberAvatar } from '@/components/ui/MemberAvatar';
import { useSession } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { parseMemberInput, type NewMember } from '@/lib/members';

const QUICK_CURRENCIES = [
  { code: 'ILS', symbol: '₪' },
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
];
const MAX_MEMBERS = 49; // the API allows 50 including the creator

const card = 'rounded-card border border-line bg-surface p-5 md:p-7';
const label = 'text-sm font-medium text-muted';

export function Component() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const currencies = useCurrencies();
  const create = useCreateGroupMutation();

  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('trip');
  const [currency, setCurrency] = useState('ILS');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [members, setMembers] = useState<NewMember[]>([]);
  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState<{ name?: string; dates?: string }>({});
  // One key per distinct payload: a retry of the same submit replays it, an edited form gets a fresh one.
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  const me = session?.user.name?.trim() || session?.user.email || '';
  const trimmed = name.trim();
  const otherCurrencies = useMemo(
    () => (currencies.data ?? []).map((c) => c.code).filter((c) => !QUICK_CURRENCIES.some((q) => q.code === c)).sort(),
    [currencies.data],
  );
  const currencyName = useMemo(() => {
    try {
      const dn = new Intl.DisplayNames(i18n.language, { type: 'currency' });
      return (code: string) => dn.of(code) ?? code;
    } catch {
      return (code: string) => code;
    }
  }, [i18n.language]);

  function addMember() {
    const m = parseMemberInput(draft);
    if (!m || members.length >= MAX_MEMBERS) return;
    setMembers((prev) => [...prev, m]);
    setDraft('');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const next: typeof errors = {};
    if (!trimmed) next.name = t('newGroup.nameRequired');
    if (startDate && endDate && endDate < startDate) next.dates = t('newGroup.dateOrder');
    setErrors(next);
    if (next.name || next.dates) return;

    const body: CreateGroupBody = {
      name: trimmed,
      type,
      currency,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      members,
    };
    const sig = JSON.stringify(body);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: idempotencyKey() };
    create.mutate(
      { body, key: attempt.current.key },
      { onSuccess: (g) => navigate(`/groups/${g.id}`, { replace: true }) },
    );
  }

  const count = members.length + 1;

  return (
    <div className="mx-auto flex max-w-300 flex-col gap-6 px-5 pt-4 pb-10 md:px-8 md:pt-8 md:pb-14">
      <div className="flex flex-col gap-2.5">
        <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control font-medium text-muted hover:text-ink">
          <ArrowLeft size={18} className="rtl:-scale-x-100" aria-hidden="true" />
          {t('newGroup.back')}
        </Link>
        <h1 className="text-[30px] font-bold tracking-tight md:text-[38px]">{t('newGroup.title')}</h1>
        <p className="text-base text-muted">{t('newGroup.sub')}</p>
      </div>

      <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div className={cn(card, 'flex flex-col gap-6')}>
            <div className="flex flex-col gap-2">
              <label htmlFor="gname" className={label}>
                {t('newGroup.nameLabel')}
              </label>
              <Input
                id="gname"
                value={name}
                maxLength={80}
                autoFocus
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'gname-err' : undefined}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('newGroup.namePh')}
                className="min-h-14 text-xl font-medium"
              />
              {errors.name && (
                <p id="gname-err" role="alert" className="text-sm text-neg">
                  {errors.name}
                </p>
              )}
            </div>

            <fieldset className="flex flex-col gap-2.5">
              <legend className={cn(label, 'mb-2.5')}>{t('newGroup.typeLabel')}</legend>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5">
                {GROUP_TYPES.map((ty) => (
                  <button
                    key={ty}
                    type="button"
                    aria-pressed={type === ty}
                    onClick={() => setType(ty)}
                    className={cn(
                      'flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] px-2.5 py-3.5 text-sm font-medium',
                      type === ty ? 'border-ink bg-surface shadow-[0_0_0_1px_var(--ink)]' : 'border-line bg-surface2 hover:border-muted',
                    )}
                  >
                    <GroupTypeIcon type={ty} size={40} />
                    {t(`groupType.${ty}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap gap-4">
              <fieldset className="flex min-w-60 flex-1 flex-col gap-2">
                <legend className={cn(label, 'mb-2')}>{t('newGroup.currency')}</legend>
                <div className="flex gap-1 rounded-control border border-line bg-surface2 p-1">
                  {QUICK_CURRENCIES.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      aria-pressed={currency === c.code}
                      onClick={() => setCurrency(c.code)}
                      className={cn(
                        'min-h-11 flex-1 cursor-pointer rounded-[10px] px-3 text-[15px] font-medium',
                        currency === c.code ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,.12)]' : 'text-muted',
                      )}
                    >
                      <span dir="ltr">{c.symbol} {c.code}</span>
                    </button>
                  ))}
                </div>
                {otherCurrencies.length > 0 && (
                  <select
                    aria-label={t('newGroup.currencyOther')}
                    value={QUICK_CURRENCIES.some((q) => q.code === currency) ? '' : currency}
                    onChange={(e) => e.target.value && setCurrency(e.target.value)}
                    className={cn(inputClass, 'min-h-11')}
                  >
                    <option value="">{t('newGroup.currencyOther')}</option>
                    {otherCurrencies.map((c) => (
                      <option key={c} value={c}>
                        {c} · {currencyName(c)}
                      </option>
                    ))}
                  </select>
                )}
              </fieldset>

              <div className="flex min-w-60 flex-1 flex-col gap-2">
                <span className={label}>
                  <CalendarDays size={14} className="me-1.5 inline align-[-2px]" aria-hidden="true" />
                  {t('newGroup.dates')}
                </span>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    aria-label={t('newGroup.startDate')}
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="min-w-0"
                  />
                  <Input
                    type="date"
                    aria-label={t('newGroup.endDate')}
                    value={endDate}
                    min={startDate || undefined}
                    aria-invalid={!!errors.dates}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="min-w-0"
                  />
                </div>
                {errors.dates && (
                  <p role="alert" className="text-sm text-neg">
                    {errors.dates}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className={cn(card, 'flex flex-col gap-4.5')}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold">{t('newGroup.members')}</h2>
              <span className="text-sm text-muted">{t('home.members', { count })}</span>
            </div>
            <div className="flex gap-2.5">
              <Input
                aria-label={t('newGroup.addPh')}
                value={draft}
                maxLength={120}
                placeholder={t('newGroup.addPh')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter adds a member instead of submitting the whole form.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addMember();
                  }
                }}
              />
              <Button variant="ghost" onClick={addMember} className="flex-none">
                <Plus size={18} aria-hidden="true" />
                {t('newGroup.add')}
              </Button>
            </div>
            <ul className="flex flex-wrap gap-2">
              <li className="inline-flex items-center gap-2 rounded-full border border-line bg-surface2 p-1 pe-3">
                <MemberAvatar name={me} index={0} size={32} />
                <span className="text-[15px] font-medium">{me}</span>
                <span className="text-xs text-muted">{t('newGroup.you')}</span>
              </li>
              {members.map((m, i) => (
                <li key={i} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface2 p-1">
                  <MemberAvatar name={m.displayName} index={i + 1} size={32} />
                  <span className="text-[15px] font-medium">{m.displayName}</span>
                  <button
                    type="button"
                    aria-label={t('newGroup.remove', { name: m.displayName })}
                    onClick={() => setMembers((prev) => prev.filter((_, j) => j !== i))}
                    className="inline-flex size-11 -my-2 cursor-pointer items-center justify-center rounded-full text-muted hover:text-ink"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-sm leading-normal text-muted">{t('newGroup.membersNote')}</p>
          </div>
        </div>

        <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          <span className={label}>{t('newGroup.preview')}</span>
          <div className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6">
            <div className="flex items-center gap-3.5">
              <GroupTypeIcon type={type} size={56} />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-xl font-semibold">{trimmed || t('newGroup.untitled')}</span>
                <span className="text-sm text-muted">
                  {t(`groupType.${type}`)} · <span dir="ltr">{currency}</span>
                </span>
              </div>
            </div>
            <GroupAvatarStack
              size={36}
              max={6}
              members={[{ name: me }, ...members.map((m) => ({ name: m.displayName }))]}
            />
            <div className="rounded-2xl border border-line bg-surface2 p-4 text-sm text-muted">{t('newGroup.inviteNote')}</div>
            <Button type="submit" size="lg" loading={create.isPending}>
              {create.isPending ? t('newGroup.creating') : t('newGroup.create')}
            </Button>
          </div>
        </aside>
      </form>
    </div>
  );
}
