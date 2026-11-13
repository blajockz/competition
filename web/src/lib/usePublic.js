import { useEffect, useState } from 'react';

/** Public event status (no login). Polls gently while the page is visible. */
export function usePublic(intervalMs = 8000) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let stop = false;
    let timer = null;
    const load = async () => {
      try {
        const res = await fetch('/api/public', { cache: 'no-store' });
        if (res.ok) {
          const d = await res.json();
          if (!stop) setData({ ...d, offset: d.now - Date.now() });
        }
      } catch {
        /* offline: keep the last state */
      }
      if (!stop) timer = setTimeout(load, document.visibilityState === 'visible' ? intervalMs : intervalMs * 4);
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return data;
}
