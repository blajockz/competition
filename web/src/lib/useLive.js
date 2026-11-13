import { useEffect, useRef, useState } from 'react';
import { request } from './api.js';

/**
 * Live state from the server (Server-Sent Events).
 * - reconnects by itself after network drops
 * - calls onDenied() when the session is no longer valid
 * - keeps the offset between the server clock and this device's clock
 */
export function useLive(token, onDenied) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const deniedRef = useRef(onDenied);
  deniedRef.current = onDenied;

  useEffect(() => {
    if (!token) return undefined;
    let es = null;
    let retry = null;
    let stopped = false;
    let offlineTimer = null;

    const setOffline = () => {
      clearTimeout(offlineTimer);
      offlineTimer = setTimeout(() => setConnected(false), 1500);
    };

    const open = () => {
      if (stopped) return;
      es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
      es.addEventListener('state', (e) => {
        clearTimeout(offlineTimer);
        setConnected(true);
        let data;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        data.offset = data.now - Date.now();
        setState(data);
      });
      es.addEventListener('denied', () => {
        stopped = true;
        es.close();
        deniedRef.current?.();
      });
      es.onerror = async () => {
        setOffline();
        if (es.readyState !== EventSource.CLOSED) return; // the browser retries by itself
        // closed for good: was it the session, or the network?
        const check = await request('/api/session', { method: 'GET', token });
        if (stopped) return;
        if (!check.ok && check.status === 401) {
          stopped = true;
          deniedRef.current?.();
          return;
        }
        clearTimeout(retry);
        retry = setTimeout(open, check.status === 429 ? 5000 : 2500);
      };
    };

    open();
    // Keep-alive: some free hosts (Koyeb) put an app to sleep after a while
    // without new requests, even with live connections open. A tiny request
    // every few minutes from each open screen keeps it awake during the event.
    const keepAlive = setInterval(() => {
      if (document.visibilityState === 'visible') fetch('/api/health', { cache: 'no-store' }).catch(() => {});
    }, 4 * 60 * 1000);
    return () => {
      stopped = true;
      clearInterval(keepAlive);
      clearTimeout(retry);
      clearTimeout(offlineTimer);
      if (es) es.close();
    };
  }, [token]);

  return { state, connected };
}

/** Re-renders every `ms` milliseconds (for countdowns). */
export function useTicker(ms = 250, active = true) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setN((n) => (n + 1) % 1e9), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

/** The server's current time, from a live state. */
export function serverNow(state) {
  return Date.now() + (state?.offset || 0);
}
