import { Placeholder } from '@/components/layout/Placeholder';
import { useParams } from 'react-router';

export function Component() {
  const { code } = useParams();
  return <Placeholder title="pages.join" detail={code} />;
}
