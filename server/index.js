#!/usr/bin/env node
/*
 * Unified Competition Platform — server.
 *
 *   GET  /api/health                health and storage status
 *   POST /api/auth/admin {code}     admin login  → { token }
 *   POST /api/auth/host  {code}     big screen   → { token }
 *   POST /api/auth/team  {joinCode} team login   → { token, teamId }
 *   GET  /api/session               who am I (Authorization: Bearer <token>)
 *   GET  /api/stream?token=…        live state (Server-Sent Events)
 *   POST /api/admin {action, …}     admin actions
 *   POST /api/team  {action, …}     team actions
 *   everything else                 the web app (web/dist)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, checkConfig, ROOT } from './config.js';
import { RateLimiter } from './ratelimit.js';
import { pickClientIp } from './clientip.js';
import { issueToken, verifyToken, safeEqual } from './auth.js';
import { Competition } from './competition.js';
import { LocalFile, Persistence, SupabaseRpc } from './db.js';

const log = console;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ---------------------------------------------------------------- setup -- */
export async function createServer(opts = {}) {
  const cfg = { ...config, ...opts.config };
  const now = opts.now || Date.now;

  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'games', 'huroof-questions.json'), 'utf8'));
  const remote = cfg.storage === 'supabase'
    ? new SupabaseRpc({ url: cfg.supabaseUrl, key: cfg.supabaseKey, secret: cfg.syncSecret, fetchImpl: opts.fetch })
    : null;
  const persistence = new Persistence({ remote, local: new LocalFile(cfg.dataDir), log });

  let loaded = null;
  for (let round = 1; ; round++) {
    try {
      loaded = await persistence.load(opts.loadOptions);
    } catch (e) {
      // wrong secret / schema missing: refuse to start, the operator must fix it
      throw new Error(`${e.message}\n  → Run supabase/schema.sql in the Supabase SQL editor and check APP_SYNC_SECRET.`);
    }
    // never start empty while Supabase may still hold the real data
    if (loaded.source !== 'new' || !remote || persistence.remoteOk) break;
    log.warn(`  ! Supabase unreachable and no local copy: waiting before starting (round ${round})`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  const comp = new Competition({
    snapshot: loaded.snapshot,
    bank,
    timeZone: cfg.eventTimeZone,
    flag: process.env.LOCKED_PHONE_FLAG || 'n7sec{3a572180f81e0ea8}',
    now,
  });
  comp.onEvent = (type, payload) => persistence.logEvent(type, payload);
  persistence.getSnapshot = () => comp.snapshot();
  log.log(`  State loaded from ${loaded.source} (version ${comp.s.version}, status ${comp.comp.status})`);

  const limiter = new RateLimiter(undefined, now);
  const adminBinding = sha('admin|' + cfg.adminCode);
  const hostBinding = sha('host|' + cfg.hostCode);

  const bindingFor = (role, subject) => {
    if (role === 'admin') return subject === '-' ? adminBinding : null;
    if (role === 'host') return subject === '-' ? hostBinding : null;
    if (role === 'team') {
      const t = comp.team(subject);
      return t ? 'team|' + t.joinCode : null;
    }
    return null;
  };
  const verify = (token) => verifyToken(cfg.tokenSecret, token, bindingFor, now());

  /* ------------------------------------------------------- live updates -- */
  const clients = new Set();
  let broadcastTimer = null;

  function sse(c, event, data) {
    if (c.res.writableEnded || c.res.destroyed) {
      clients.delete(c);
      return;
    }
    try {
      c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(c);
    }
  }

  function viewFor(c, cache) {
    const key = c.role === 'team' ? 'team:' + c.teamId : c.role;
    if (!cache.has(key)) {
      cache.set(key, c.role === 'admin' ? comp.adminView() : c.role === 'host' ? comp.hostView() : comp.teamView(c.teamId));
    }
    return cache.get(key);
  }

  function broadcastNow() {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
    const cache = new Map();
    for (const c of clients) {
      if (!verify(c.token)) {
        sse(c, 'denied', { reason: 'session-ended' });
        clients.delete(c);
        c.res.end();
        continue;
      }
      sse(c, 'state', viewFor(c, cache));
    }
  }

  function changed() {
    persistence.schedule();
    if (!broadcastTimer) broadcastTimer = setTimeout(broadcastNow, 40);
  }

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (c.res.writableEnded || c.res.destroyed) clients.delete(c);
      else c.res.write(': ping\n\n');
    }
  }, 15000);
  heartbeat.unref?.();

  // timers: countdown, challenge expiry, battery; plus a clock refresh for screens every 5 s
  let lastPeriodic = 0;
  const ticker = setInterval(() => {
    let dirty = false;
    try {
      dirty = comp.tick();
    } catch (e) {
      log.error('  ! tick failed:', e);
    }
    if (dirty) changed();
    else if (now() - lastPeriodic > 5000) {
      lastPeriodic = now();
      if (comp.s.teams.some((t) => comp.game(t.id, 'locked_phone')?.status === 'playing')) broadcastNow();
    }
  }, 250);
  ticker.unref?.();

  /* -------------------------------------------------------------- http -- */
  function clientIp(req) {
    const ip = pickClientIp(req.headers, req.socket.remoteAddress, cfg.trustProxy, cfg.clientIpHeader);
    return ip.slice(0, 64);
  }

  const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self), screen-wake-lock=(self)',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self' data: blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };

  function json(res, status, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
    res.end(JSON.stringify(body));
  }

  function tooMany(res, retryAfter, what = 'Too many requests') {
    json(res, 429, { ok: false, error: `${what}. Try again in ${retryAfter} s.`, retryAfter }, { 'Retry-After': String(retryAfter) });
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(Object.assign(new Error('Request too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const body = text ? JSON.parse(text) : {};
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad');
          resolve(body);
        } catch {
          reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function bearer(req) {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  }

  const ADMIN_ACTIONS = {
    addParticipant: (p) => comp.addParticipant(p),
    importParticipants: (p) => comp.importParticipants(p),
    updateParticipant: (p) => comp.updateParticipant(p),
    removeParticipant: (p) => comp.removeParticipant(p),
    clearParticipants: () => comp.clearParticipants(),
    generateTeams: () => comp.generateTeams(),
    backToRegistration: () => comp.backToRegistration(),
    moveParticipant: (p) => comp.moveParticipant(p),
    renameTeam: (p) => comp.renameTeamAdmin(p),
    newJoinCode: (p) => comp.newJoinCode(p),
    beginCompetition: () => comp.beginCompetition(),
    openChallengeWindow: (p) => comp.openChallengeWindow({ minutes: Number(p.minutes) }),
    extendChallengeWindow: (p) => comp.extendChallengeWindow(p),
    finishCompetition: () => comp.finishCompetition(),
    resetCompetition: (p) => comp.resetCompetition(p),
    updateSettings: (p) => comp.updateSettings(p.settings),
    adjustScore: (p) => comp.adjustScore(p),
    removeAdjustment: (p) => comp.removeAdjustment(p),
    matchAct: (p) => comp.matchAct(p.command || {}),
    settleMatch: (p) => comp.settleMatch(p),
    abortMatch: (p) => comp.abortMatch(p),
    cancelChallenge: (p) => comp.adminCancelChallenge(p),
  };

  const TEAM_ACTIONS = {
    rename: { fn: (id, p) => comp.renameTeam(id, p) },
    robopathSave: { fn: (id, p) => comp.robopathSave(id, p) },
    robopathRun: { fn: (id, p) => comp.robopathRun(id, p) },
    robopathSkip: { fn: (id, p) => comp.robopathSkip(id, p), limit: 'skip' },
    robopathGiveUp: { fn: (id) => comp.robopathGiveUp(id) },
    lockedStart: { fn: (id) => comp.lockedStart(id) },
    lockedAttempt: { fn: (id, p) => comp.lockedAttempt(id, p), limit: 'attempt' },
    lockedHint: { fn: (id) => comp.lockedHint(id), limit: 'attempt' },
    lockedSkip: { fn: (id) => comp.lockedSkip(id), limit: 'skip' },
    lockedGiveUp: { fn: (id) => comp.lockedGiveUp(id) },
    challengeRequest: { fn: (id, p) => comp.requestChallenge(id, p), limit: 'challenge' },
    challengeCancel: { fn: (id, p) => comp.cancelChallenge(id, p) },
    challengeRespond: { fn: (id, p) => comp.respondChallenge(id, p) },
    buzz: { fn: (id) => comp.buzz(id), limit: 'buzz' },
  };

  function runAction(fn) {
    let result;
    try {
      result = fn();
    } catch (e) {
      log.error('  ! action failed:', e);
      return { status: 500, body: { ok: false, error: 'Server error' } };
    }
    if (result && result.ok) {
      const { code, quiet, ...rest } = result;
      if (quiet) persistence.schedule(); // saved, but nothing other screens need to redraw
      else changed();
      return { status: 200, body: rest };
    }
    const { code = 409, ...rest } = result || { error: 'Unknown error' };
    return { status: code, body: rest };
  }

  async function handleApi(req, res, url, ip) {
    const p = url.pathname;

    if (p === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, version: comp.s.version, status: comp.comp.status, storage: persistence.status(), clients: clients.size });
    }

    if (p === '/api/public' && req.method === 'GET') {
      const g = limiter.take('global', ip);
      if (!g.ok) return tooMany(res, g.retryAfter);
      return json(res, 200, { ok: true, ...comp.publicView(cfg.eventName) });
    }

    if (p.startsWith('/api/auth/') && req.method === 'POST') {
      const role = p.slice('/api/auth/'.length);
      if (!['admin', 'host', 'team'].includes(role)) return json(res, 404, { ok: false, error: 'Not found' });
      const g = limiter.take('global', ip);
      if (!g.ok) return tooMany(res, g.retryAfter);
      let body;
      try {
        body = await readBody(req, 2048);
      } catch (e) {
        return json(res, e.status || 400, { ok: false, error: e.message });
      }
      // A right code always works. Only wrong codes are limited: a whole room
      // often shares one public address, so someone guessing codes must not be
      // able to lock the organisers (or the other teams) out.
      const failKind = role === 'team' ? 'team' : 'staff';
      const refuse = (status, error) => {
        const blocked = limiter.blockedFor(failKind, ip);
        if (blocked) return tooMany(res, blocked, 'Too many wrong codes');
        const rl = limiter.take('auth', ip);
        if (!rl.ok) return tooMany(res, rl.retryAfter, 'Too many login attempts');
        limiter.recordFailure(failKind, ip);
        return json(res, status, { ok: false, error });
      };
      if (role === 'team') {
        const team = comp.teamByCode(body.joinCode);
        if (!team) return refuse(401, 'Unknown join code');
        if (comp.comp.status === 'REGISTRATION') return json(res, 409, { ok: false, error: 'Teams are not ready yet' });
        const claimed = comp.claim(team.id);
        if (claimed.changed) changed();
        return json(res, 200, { ok: true, role, teamId: team.id, token: issueToken(cfg.tokenSecret, 'team', team.id, 'team|' + team.joinCode, now()) });
      }
      const expected = role === 'admin' ? cfg.adminCode : cfg.hostCode;
      const given = String(body.code || '').trim().toUpperCase().slice(0, 100);
      if (!expected || !safeEqual(given, expected.toUpperCase())) return refuse(401, 'Wrong access code');
      const binding = role === 'admin' ? adminBinding : hostBinding;
      return json(res, 200, { ok: true, role, token: issueToken(cfg.tokenSecret, role, '-', binding, now()) });
    }

    if (p === '/api/session' && req.method === 'GET') {
      const s = verify(bearer(req));
      if (!s) return json(res, 401, { ok: false, error: 'Session expired' });
      return json(res, 200, { ok: true, role: s.role, teamId: s.role === 'team' ? s.subject : null });
    }

    if (p === '/api/stream' && req.method === 'GET') {
      const rl = limiter.take('stream', ip);
      if (!rl.ok) return tooMany(res, rl.retryAfter);
      const token = url.searchParams.get('token') || '';
      const s = verify(token);
      if (!s) return json(res, 401, { ok: false, error: 'Session expired' });
      if (clients.size >= 1500) return json(res, 503, { ok: false, error: 'Server busy' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...SECURITY_HEADERS,
      });
      res.write('retry: 2000\n\n');
      const c = { res, token, role: s.role, teamId: s.role === 'team' ? s.subject : null };
      clients.add(c);
      sse(c, 'state', viewFor(c, new Map()));
      const drop = () => clients.delete(c);
      req.on('close', drop);
      res.on('error', drop);
      return;
    }

    if ((p === '/api/admin' || p === '/api/team') && req.method === 'POST') {
      const g = limiter.take('global', ip);
      if (!g.ok) return tooMany(res, g.retryAfter);
      const s = verify(bearer(req));
      const wantRole = p === '/api/admin' ? 'admin' : 'team';
      if (!s || s.role !== wantRole) return json(res, 401, { ok: false, error: 'Session expired: log in again' });
      let body;
      try {
        body = await readBody(req, wantRole === 'admin' ? 256 * 1024 : 16 * 1024);
      } catch (e) {
        return json(res, e.status || 400, { ok: false, error: e.message });
      }
      const action = String(body.action || '');
      if (wantRole === 'admin') {
        const rl = limiter.take('admin', String(s.iat));
        if (!rl.ok) return tooMany(res, rl.retryAfter);
        const fn = Object.hasOwn(ADMIN_ACTIONS, action) ? ADMIN_ACTIONS[action] : null;
        if (!fn) return json(res, 400, { ok: false, error: 'Unknown action' });
        const out = runAction(() => fn(body));
        return json(res, out.status, out.body);
      }
      const def = Object.hasOwn(TEAM_ACTIONS, action) ? TEAM_ACTIONS[action] : null;
      if (!def) return json(res, 400, { ok: false, error: 'Unknown action' });
      const rlTeam = limiter.take('play', s.subject);
      if (!rlTeam.ok) return tooMany(res, rlTeam.retryAfter);
      if (def.limit) {
        const rl = limiter.take(def.limit, s.subject);
        if (!rl.ok) return tooMany(res, rl.retryAfter, 'Slow down');
      }
      const out = runAction(() => def.fn(s.subject, body));
      return json(res, out.status, out.body);
    }

    return json(res, 404, { ok: false, error: 'Not found' });
  }

  /* ------------------------------------------------------------ static -- */
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  };
  const staticRoot = path.resolve(cfg.staticDir);
  const SPA_ROUTES = new Set(['/', '/admin', '/host', '/play', '/join']);

  function serveStatic(req, res, url) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (rel.endsWith('/') && rel.length > 1) rel = rel.slice(0, -1);
    let file = SPA_ROUTES.has(rel) ? path.join(staticRoot, 'index.html') : path.normalize(path.join(staticRoot, rel));
    if (!file.startsWith(staticRoot + path.sep) && file !== staticRoot) {
      res.writeHead(403);
      return res.end();
    }
    fs.stat(file, (e, st) => {
      if (e || !st.isFile()) {
        // unknown paths without an extension fall back to the app
        if (!path.extname(rel)) file = path.join(staticRoot, 'index.html');
        else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
          return res.end('Not found');
        }
      }
      fs.stat(file, (e2, st2) => {
        if (e2 || !st2.isFile()) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('The web app is not built. Run: npm run build');
        }
        const ext = path.extname(file).toLowerCase();
        const immutable = file.includes(`${path.sep}assets${path.sep}`);
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': st2.size,
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
          ...SECURITY_HEADERS,
        });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400);
      return res.end();
    }
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, ip);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'Method not allowed' });
      const g = limiter.take('global', ip, 0.2); // static files are cheap
      if (!g.ok) return tooMany(res, g.retryAfter);
      return serveStatic(req, res, url);
    } catch (e) {
      log.error('  ! request failed:', e);
      if (!res.headersSent) json(res, 500, { ok: false, error: 'Server error' });
      else res.end();
    }
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 0; // SSE streams stay open

  async function close() {
    clearInterval(ticker);
    clearInterval(heartbeat);
    limiter.stop();
    for (const c of clients) c.res.end();
    clients.clear();
    await persistence.flush();
    await persistence.flushEvents();
    await new Promise((r) => server.close(() => r()));
  }

  return { server, comp, persistence, limiter, close, broadcastNow };
}

/* ----------------------------------------------------------------- main -- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const problems = checkConfig();
  if (problems.length) {
    log.error('\n  Configuration problems:\n' + problems.map((p) => '   • ' + p).join('\n') + '\n  See .env.example.\n');
    process.exit(1);
  }
  createServer()
    .then(({ server, close }) => {
      server.listen(config.port, config.host, () => {
        log.log(`  Competition platform listening on http://${config.host}:${config.port}  (storage: ${config.storage})`);
      });
      let closing = false;
      const shutdown = async (sig) => {
        if (closing) return;
        closing = true;
        log.log(`  ${sig}: saving and stopping…`);
        const force = setTimeout(() => process.exit(0), 8000);
        force.unref();
        try {
          await close();
        } finally {
          process.exit(0);
        }
      };
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    })
    .catch((e) => {
      log.error('\n  Could not start:', e.message, '\n');
      process.exit(1);
    });
  process.on('unhandledRejection', (e) => log.error('  ! unhandled:', e));
}