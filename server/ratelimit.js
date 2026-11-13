/*
 * In-memory request rate limiter (token buckets).
 *
 * Every request is charged against one or more buckets, for example
 *   "global:<ip>"      all requests from one address
 *   "auth:<ip>"        login attempts from one address
 *   "play:<teamId>"    game actions of one team
 * A bucket holds `capacity` tokens and refills `perSecond` tokens per second.
 * A request that finds an empty bucket is refused with HTTP 429.
 *
 * Failed logins are tracked separately: too many wrong codes from one address
 * block that address for a while (brute-force protection for access/join codes).
 *
 * The event usually runs on one Wi-Fi network, so many devices can share one
 * public address: the per-address limits are generous, the per-team ones strict.
 */

export const LIMITS = {
  global: { capacity: 900, perSecond: 60 }, // per IP, every API request
  auth: { capacity: 30, perSecond: 0.5 }, // per IP, login attempts
  stream: { capacity: 60, perSecond: 1 }, // per IP, live connections opened
  admin: { capacity: 120, perSecond: 15 }, // per admin session
  play: { capacity: 40, perSecond: 6 }, // per team
  attempt: { capacity: 8, perSecond: 0.25 }, // per team, Locked Phone answers
  skip: { capacity: 10, perSecond: 0.5 }, // per team, "skip this stage"
  buzz: { capacity: 6, perSecond: 4 }, // per team, Huruf buzzer
  challenge: { capacity: 6, perSecond: 0.2 }, // per team, challenge requests
};

// Wrong codes allowed per address before it is blocked for a while.
// Join codes: lenient, a whole room may share one address and mistype.
// Admin/host codes: strict (and they are long random codes).
export const FAIL_LIMITS = {
  team: { max: 30, windowMs: 10 * 60 * 1000, blockMs: 5 * 60 * 1000 },
  staff: { max: 8, windowMs: 10 * 60 * 1000, blockMs: 15 * 60 * 1000 },
};

export class RateLimiter {
  constructor(limits = LIMITS, now = Date.now) {
    this.limits = limits;
    this.now = now;
    this.buckets = new Map();
    this.fails = new Map(); // ip -> { times: [], blockedUntil }
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref?.();
  }

  /** Takes `cost` tokens. Returns { ok, retryAfter } (seconds). */
  take(kind, key, cost = 1) {
    const limit = this.limits[kind];
    if (!limit) return { ok: true, retryAfter: 0 };
    const id = kind + ':' + key;
    const t = this.now();
    let b = this.buckets.get(id);
    if (!b) {
      b = { tokens: limit.capacity, last: t };
      this.buckets.set(id, b);
    }
    b.tokens = Math.min(limit.capacity, b.tokens + ((t - b.last) / 1000) * limit.perSecond);
    b.last = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, retryAfter: 0 };
    }
    const missing = cost - b.tokens;
    return { ok: false, retryAfter: Math.max(1, Math.ceil(missing / limit.perSecond)) };
  }

  /** Seconds this address is still blocked for after too many wrong codes (0 = not blocked). */
  blockedFor(kind, ip) {
    const f = this.fails.get(kind + ':' + ip);
    if (!f || !f.blockedUntil) return 0;
    const left = f.blockedUntil - this.now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  recordFailure(kind, ip) {
    const limit = FAIL_LIMITS[kind];
    const id = kind + ':' + ip;
    const t = this.now();
    const f = this.fails.get(id) || { times: [], blockedUntil: 0, windowMs: limit.windowMs };
    f.times = f.times.filter((x) => t - x < limit.windowMs);
    f.times.push(t);
    if (f.times.length >= limit.max) {
      f.blockedUntil = t + limit.blockMs;
      f.times = [];
    }
    this.fails.set(id, f);
  }

  sweep() {
    const t = this.now();
    for (const [id, b] of this.buckets) {
      const kind = id.slice(0, id.indexOf(':'));
      const limit = this.limits[kind];
      // a bucket that has refilled completely carries no information
      if (!limit || b.tokens + ((t - b.last) / 1000) * limit.perSecond >= limit.capacity) this.buckets.delete(id);
    }
    for (const [id, f] of this.fails) {
      if (f.blockedUntil < t && f.times.every((x) => t - x >= f.windowMs)) this.fails.delete(id);
    }
  }

  stop() {
    clearInterval(this.sweeper);
  }
}
