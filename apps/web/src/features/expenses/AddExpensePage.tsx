import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useExpense } from '@/api/expenses';
import { useGroup } from '@/api/groupDetail';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Skeleton } from '@/components/ui/Skeleton';
import { errorCode } from '@/lib/errors';
import { Lock } from 'lucide-react';
import { ExpenseForm } from './ExpenseForm';

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-300 px-5 pt-8 md:px-8 md:pt-10">{children}</div>;
}

function FormSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="mx-auto flex max-w-300 flex-wrap items-start gap-6 px-5 pt-6 md:px-8 md:pt-8">
      <span role="status" className="sr-only">
        {t('common.loading')}
      </span>
      <Skeleton className="h-130 min-w-0 flex-[999_1_560px] rounded-card" />
      <Skeleton className="h-80 min-w-0 flex-[1_1_320px] rounded-card" />
    </div>
  );
}

/** `/groups/:id/expenses/new` and `/groups/:id/expenses/:eid/edit`. */
export function Component() {
  const { id = '', eid } = useParams();
  const { t } = useTranslation();
  const group = useGroup(id);
  const expense = useExpense(id, eid);
  const back = (
    <Link to={`/groups/${id}`} className={buttonClass('ghost')}>
      {t('group.backShort')}
    </Link>
  );

  if (group.isPending || (eid && expense.isPending)) return <FormSkeleton />;
  if (group.isError) {
    const missing = ['NOT_FOUND', 'NOT_A_MEMBER'].includes(errorCode(group.error));
    return (
      <Frame>
        <ErrorState
          error={group.error}
          title={missing ? t('group.notFoundTitle') : undefined}
          retrying={group.isFetching}
          onRetry={missing ? undefined : () => void group.refetch()}
          action={back}
        />
      </Frame>
    );
  }
  if (eid && expense.isError) {
    return (
      <Frame>
        <ErrorState
          error={expense.error}
          title={t('expense.loadFailed')}
          retrying={expense.isFetching}
          onRetry={() => void expense.refetch()}
          action={back}
        />
      </Frame>
    );
  }
  if (group.data.closedAt) {
    return (
      <Frame>
        <EmptyState icon={Lock} title={t('expense.closedTitle')} body={t('group.closedBanner')} action={back} />
      </Frame>
    );
  }
  return (
    <ExpenseForm
      // A newer version remounts the form so its draft starts from what the server has now.
      key={expense.data?.version ?? 'new'}
      group={group.data}
      expense={expense.data}
      onReload={() => expense.refetch()}
    />
  );
}
