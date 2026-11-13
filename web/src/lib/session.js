import { useCallback, useState } from 'react';
import { login, session } from './api.js';
import { toast } from '../components/common.jsx';

/** Login state for one role (admin | host | team). */
export function useSession(role) {
  const [token, setToken] = useState(() => session.get(role));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = useCallback(async (payload) => {
    setBusy(true);
    setError('');
    const res = await login(role, payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    session.set(role, res.token);
    setToken(res.token);
    return true;
  }, [role]);

  const signOut = useCallback((reason) => {
    session.clear(role);
    setToken('');
    if (reason) toast(reason, 'error');
  }, [role]);

  return { token, busy, error, signIn, signOut };
}
