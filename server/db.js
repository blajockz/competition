/*
 * Persistence.
 *
 * The server keeps the live competition in memory (fast, one authority) and
 * saves a snapshot after every change:
 *   1. to Supabase, through the cp_save_snapshot() function (see supabase/schema.sql)
 *   2. to a local file (data/snapshot.json) as a safety copy
 *
 * On start, the newest of the two (highest version) is loaded. If Supabase is
 * unreachable, the game keeps running on the local copy and Supabase catches up
 * automatically as soon as it answers again.
 */
import fs from 'node:fs';
import path from 'node:path';

export class SupabaseRpc {
  constructor({ url, key, secret, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
    this.url = url;
    this.key = key;
    this.secret = secret;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async call(fn, args = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ p_secret: this.secret, ...args }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!res.ok) {
        const msg = body && typeof body === 'object' ? body.message || body.hint || JSON.stringify(body) : String(body);
        const e = new Error(`Supabase ${fn} failed (${res.status}): ${msg}`);
        e.status = res.status;
        e.fatal = res.status === 404 || /invalid sync secret/i.test(msg); // schema missing or wrong secret
        throw e;
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  ping() { return this.call('cp_ping'); }
  load() { return this.call('cp_load_snapshot'); }
  save(snapshot) { return this.call('cp_save_snapshot', { p_snapshot: snapshot }); }
  appendEvents(events) { return this.call('cp_append_events', { p_events: events }); }
}

export class LocalFile {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'snapshot.json');
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  save(snapshot) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, this.file);
  }
}

/**
 * Debounced, ordered saving with retries. getSnapshot() is called at save time,
 * so a burst of changes produces one write with the latest state.
 */
export class Persistence {
  constructor({ remote, local, log = console, debounceMs = 250, maxWaitMs = 1500 }) {
    this.remote = remote; // SupabaseRpc or null
    this.local = local; // LocalFile
    this.log = log;
    this.debounceMs = debounceMs;
    this.maxWaitMs = maxWaitMs;
    this.getSnapshot = null;
    this.timer = null;
    this.firstDirtyAt = 0;
    this.saving = false;
    this.again = false;
    this.remoteOk = null; // null unknown, true, false
    this.remoteVersion = 0;
    this.lastError = null;
    this.retryTimer = null;
    this.eventQueue = [];
    this.flushingEvents = false;
  }

  /** Loads the newest snapshot. Returns { snapshot, source }. */
  async load({ attempts = 6, delayMs = 2000 } = {}) {
    const local = this.local.load();
    let remote = null;
    if (this.remote) {
      for (let i = 1; i <= attempts; i++) {
        try {
          remote = await this.remote.load();
          this.remoteOk = true;
          break;
        } catch (e) {
          this.lastError = e.message;
          this.remoteOk = false;
          if (e.fatal) throw e; // wrong secret or schema not installed: stop and tell the operator
          this.log.warn(`  ! Supabase not reachable (attempt ${i}/${attempts}): ${e.message}`);
          if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    const lv = local?.version || 0;
    const rv = remote?.version || 0;
    this.remoteVersion = rv;
    if (remote && rv >= lv && rv > 0) return { snapshot: remote, source: 'supabase' };
    if (local && lv > 0) return { snapshot: local, source: 'local file' };
    return { snapshot: null, source: 'new' };
  }

  schedule() {
    if (!this.getSnapshot) return;
    const now = Date.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, this.firstDirtyAt + this.maxWaitMs - now));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    this.firstDirtyAt = 0;
    if (this.saving) {
      this.again = true;
      return;
    }
    this.saving = true;
    try {
      const snapshot = this.getSnapshot();
      try {
        this.local.save(snapshot);
      } catch (e) {
        this.log.error('  ! could not write the local copy:', e.message);
      }
      if (this.remote) {
        try {
          const out = await this.remote.save(snapshot);
          if (out && out.stale) {
            this.log.warn(`  ! Supabase holds a newer version (${out.version}); keeping the running state`);
          }
          this.remoteVersion = snapshot.version;
          if (this.remoteOk === false) this.log.log('  ✓ Supabase is reachable again, data synced');
          this.remoteOk = true;
          this.lastError = null;
        } catch (e) {
          if (this.remoteOk !== false) this.log.warn('  ! Supabase save failed, will retry:', e.message);
          this.remoteOk = false;
          this.lastError = e.message;
          clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => this.flush(), 5000);
          this.retryTimer.unref?.();
        }
      }
    } finally {
      this.saving = false;
      if (this.again) {
        this.again = false;
        this.flush();
      }
    }
  }

  logEvent(type, payload) {
    if (!this.remote) return;
    this.eventQueue.push({ type, payload, at: Date.now() });
    if (this.eventQueue.length > 500) this.eventQueue.splice(0, this.eventQueue.length - 500);
    if (!this.flushingEvents) setTimeout(() => this.flushEvents(), 1000).unref?.();
  }

  async flushEvents() {
    if (this.flushingEvents || !this.eventQueue.length || !this.remote) return;
    this.flushingEvents = true;
    const batch = this.eventQueue.splice(0, 100);
    try {
      await this.remote.appendEvents(batch);
    } catch {
      this.eventQueue.unshift(...batch); // keep them for the next try
    } finally {
      this.flushingEvents = false;
      if (this.eventQueue.length) setTimeout(() => this.flushEvents(), 5000).unref?.();
    }
  }

  status() {
    return { remote: !!this.remote, remoteOk: this.remoteOk, lastError: this.lastError, remoteVersion: this.remoteVersion };
  }
}
