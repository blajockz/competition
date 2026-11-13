// Small client for the platform API. Never throws: every call resolves to
// { ok: true, ...data } or { ok: false, error, status, retryAfter }.

const KEY = (role) => `ucp.token.${role}`;

export const session = {
  get(role) {
    try {
      return localStorage.getItem(KEY(role)) || '';
    } catch {
      return '';
    }
  },
  set(role, token) {
    try {
      localStorage.setItem(KEY(role), token);
    } catch {
      /* private mode: the session lasts until the tab closes */
    }
  },
  clear(role) {
    try {
      localStorage.removeItem(KEY(role));
    } catch {
      /* ignore */
    }
  },
};

export async function request(path, { method = 'POST', token, body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        status: res.status,
        error: data.error || (res.status === 429 ? 'Too many requests, slow down.' : `Request failed (${res.status})`),
        retryAfter: data.retryAfter || 0,
      };
    }
    return { ok: true, ...data };
  } catch {
    return { ok: false, status: 0, error: 'Connection problem. Check the network and try again.' };
  }
}

export function login(role, payload) {
  return request(`/api/auth/${role}`, { body: payload });
}

/** Returns a function act(action, payload) bound to a role and token. */
export function actor(role, token) {
  const path = role === 'admin' ? '/api/admin' : '/api/team';
  return (action, payload = {}) => request(path, { token, body: { action, ...payload } });
}
