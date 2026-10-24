import { Placeholder } from '@/components/layout/Placeholder';
import { useParams } from 'react-router';

export function Component() {
  const { id } = useParams();
  return <Placeholder title="pages.addExpense" detail={id} />;
}
