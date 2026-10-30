import { useState } from 'react';
import { useNavigate } from 'react-router';
import { signOut } from '@/lib/auth';
import { toast } from '@/lib/toast';

/** Signs out and returns to /login. `busy` covers the request; errors surface as a toast. */
export function useSignOut() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function out() {
    setBusy(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (e) {
      setBusy(false);
      toast.error(e);
    }
  }

  return { out, busy };
}
