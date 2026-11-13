/*
 * The competition: one authoritative state, the actions that change it, and
 * the views each screen is allowed to see.
 *
 * Lifecycle (competition.status):
 *   REGISTRATION → LOBBY_LOCKED → COUNTDOWN → MAIN_GAMES → CHALLENGE_WINDOW → FINISHED
 *
 * Registration: students register themselves (/register) or are added by the
 * admin. On event day they confirm their presence by scanning the check-in QR
 * on the big screen. Teams are generated from confirmed participants only.
 *
 * Main games (in this order): RoboPath → The Locked Phone → N7 Quiz. They end
 * when every team is done, when the admin opens the challenge phase, or
 * automatically `mainGamesMinutes` (default 90) after the start.
 *
 * Every action returns { ok: true, ... } or { ok: false, error }. The server
 * broadcasts and persists after each successful action.
 */
import {
  MAX_MEMBERS, MIN_MEMBERS, distribute, makeJoinCode, makeNames, parseParticipantsText,
  parseYear, teamColor,
} from './teams.js';
import * as Robo from './games/robopath.js';
import * as Locked from './games/lockedPhone.js';
import * as Quiz from './games/quiz.js';
import { createHuroof, cleanHuroofSettings } from './games/huroof.js';
import crypto from 'node:crypto';

export const STATUSES = ['REGISTRATION', 'LOBBY_LOCKED', 'COUNTDOWN', 'MAIN_GAMES', 'CHALLENGE_WINDOW', 'FINISHED'];
export const GAME_KEYS = ['robopath', 'locked_phone', 'quiz'];
export const GAMES = [
  { key: 'robopath', title: 'RoboPath', maxPoints: 100 },
  { key: 'locked_phone', title: 'The Locked Phone', maxPoints: 100 },
  { key: 'quiz', title: 'N7 Quiz', maxPoints: Quiz.MAX_TOTAL },
];
const QUIZ_INDEX = 2;
export const CHECKIN_SLOT_MS = 60 * 1000; // the check-in QR changes every minute
const CHECKIN_SLOTS_VALID = 3; // a scanned code stays valid for 2–3 minutes
const MAX_PARTICIPANTS = 600;
export const COUNTDOWN_MS = 3000;
const FEED_SIZE = 40;
const NAME_MAX = 24;

const clone = (x) => JSON.parse(JSON.stringify(x));
const ok = (extra = {}) => ({ ok: true, ...extra });
const err = (error, code = 409) => ({ ok: false, error, code });
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const pad2 = (n) => String(n).padStart(2, '0');
const round1 = (n) => Math.round(n * 10) / 10;

/** Keeps digits and a leading +. Returns '' when it does not look like a phone number. */
export function cleanPhone(v) {
  let p = String(v ?? '').trim().replace(/[\s().\-\/]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (!/^\+?\d{8,15}$/.test(p)) return '';
  return p;
}

/** Same number written two ways (0612… / +212612… / 00212612…) gives the same key. */
export function phoneKey(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('212') && d.length === 12) d = '0' + d.slice(3);
  return d;
}

export function cleanText(v, max) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const DEFAULT_SETTINGS = {
  responseTimeoutSec: 45, // a challenge left unanswered this long is accepted automatically
  lockedBatteryMinutes: 60,
  challengeMinutes: 12,
  mainGamesMinutes: 90, // the challenge phase opens by itself this long after the start
  huroof: cleanHuroofSettings({ roundsToWin: 1 }),
};

function cleanSettings(raw = {}) {
  const s = clone(DEFAULT_SETTINGS);
  const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
  s.responseTimeoutSec = int(raw.responseTimeoutSec, 15, 300) ?? s.responseTimeoutSec;
  s.lockedBatteryMinutes = int(raw.lockedBatteryMinutes, 20, 240) ?? s.lockedBatteryMinutes;
  s.challengeMinutes = int(raw.challengeMinutes, 1, 120) ?? s.challengeMinutes;
  s.mainGamesMinutes = int(raw.mainGamesMinutes, 5, 300) ?? s.mainGamesMinutes;
  s.huroof = cleanHuroofSettings({ ...s.huroof, ...(isObj(raw.huroof) ? raw.huroof : {}) });
  return s;
}

export function emptySnapshot() {
  return {
    version: 0,
    counters: { participant: 0, challenge: 0, adjustment: 0 },
    competition: {
      status: 'REGISTRATION',
      minMembers: MIN_MEMBERS,
      maxMembers: MAX_MEMBERS,
      balanceSmallGroups: true,
      baseChallengeStake: 50,
      maxDenials: 2,
      countdownEndsAt: null,
      startedAt: null,
      mainGamesEndsAt: null,
      registrationOpen: true,
      checkinOpen: false,
      challengeOpenedAt: null,
      challengeTimerEnd: null,
      finishedAt: null,
      activeChallengeId: null,
      settings: clone(DEFAULT_SETTINGS),
    },
    teams: [],
    participants: [],
    games: [],
    challenges: [],
    adjustments: [],
  };
}

export class Competition {
  /**
   * @param {object} o
   * @param {object} [o.snapshot]  saved state
   * @param {Array}  o.bank        Huruf question bank
   * @param {string} o.timeZone    event time zone (Locked Phone passcode)
   * @param {string} o.flag        Locked Phone final flag
   */
  constructor({ snapshot = null, bank = [], timeZone = 'Africa/Casablanca', flag = 'n7sec{3a572180f81e0ea8}', now = Date.now, rand = Math.random, secret = crypto.randomBytes(32).toString('hex'), randInt = crypto.randomInt } = {}) {
    this.bank = bank;
    this.secret = secret;
    this.randInt = randInt;
    this.checkinSlot = null;
    this.timeZone = timeZone;
    this.flag = flag;
    this.now = now;
    this.rand = rand;
    this.feed = [];
    this.huroof = null; // { challengeId, game }
    this.onEvent = null; // (type, payload) => void, for the audit log
    this.load(snapshot);
  }

  /* ======================================================================
   * state loading / saving
   * ====================================================================== */
  load(snapshot) {
    const base = emptySnapshot();
    const s = isObj(snapshot) ? clone(snapshot) : base;
    this.s = {
      version: Number.isInteger(s.version) ? s.version : 0,
      counters: { ...base.counters, ...(isObj(s.counters) ? s.counters : {}) },
      competition: { ...base.competition, ...(isObj(s.competition) ? s.competition : {}) },
      teams: Array.isArray(s.teams) ? s.teams : [],
      participants: Array.isArray(s.participants) ? s.participants : [],
      games: Array.isArray(s.games) ? s.games : [],
      challenges: Array.isArray(s.challenges) ? s.challenges : [],
      adjustments: Array.isArray(s.adjustments) ? s.adjustments : [],
    };
    const c = this.s.competition;
    if (!STATUSES.includes(c.status)) c.status = 'REGISTRATION';
    c.settings = cleanSettings(c.settings);
    // clean games
    for (const g of this.s.games) {
      if (g.gameKey === 'robopath') g.state = Robo.cleanRoboState(g.state);
      if (g.gameKey === 'locked_phone') g.state = Locked.cleanLockedState(g.state);
      if (g.gameKey === 'quiz') {
        g.state = Quiz.cleanQuizState(g.state);
        g.points = ['completed', 'abandoned'].includes(g.status) ? g.state.score : 0;
      }
    }
    this.s.games = this.s.games.filter((g) => GAME_KEYS.includes(g.gameKey));
    for (const p of this.s.participants) {
      p.phone = typeof p.phone === 'string' ? p.phone : '';
      p.source = ['self', 'admin', 'import'].includes(p.source) ? p.source : 'admin';
      p.checkedInAt = Number.isFinite(p.checkedInAt) ? p.checkedInAt : null;
    }
    c.registrationOpen = c.registrationOpen !== false;
    c.checkinOpen = c.checkinOpen === true;
    if (c.status === 'MAIN_GAMES' && !c.mainGamesEndsAt && c.startedAt) c.mainGamesEndsAt = c.startedAt + c.settings.mainGamesMinutes * 60000;
    // a save from before the N7 Quiz existed: index 2 meant "done"
    const older = new Set(this.s.teams.filter((t) => !this.game(t.id, 'quiz')).map((t) => t.id));
    for (const t of this.s.teams) this.ensureGames(t.id);
    for (const t of this.s.teams) {
      if (!older.has(t.id) || t.currentGameIndex < 2) continue;
      const quiz = this.game(t.id, 'quiz');
      if (c.status === 'MAIN_GAMES') quiz.status = 'ready';
      else {
        quiz.status = 'abandoned';
        t.currentGameIndex = GAMES.length;
      }
    }
    // restore the live Huruf match
    this.huroof = null;
    const active = this.challenge(c.activeChallengeId);
    if (active && active.status === 'IN_PROGRESS') {
      this.huroof = { challengeId: active.id, game: createHuroof({ bank: this.bank, saved: active.huroof, settings: c.settings.huroof, rand: this.rand, now: this.now }) };
    } else {
      c.activeChallengeId = null;
    }
    // a countdown interrupted by a restart simply finishes
    if (c.status === 'COUNTDOWN' && !c.countdownEndsAt) c.countdownEndsAt = this.now();
  }

  snapshot() {
    const s = clone(this.s);
    if (this.huroof) {
      const ch = s.challenges.find((x) => x.id === this.huroof.challengeId);
      if (ch) ch.huroof = this.huroof.game.serialize();
    }
    return s;
  }

  bump() {
    this.s.version += 1;
  }

  get comp() {
    return this.s.competition;
  }

  /* ======================================================================
   * lookups
   * ====================================================================== */
  team(id) {
    return this.s.teams.find((t) => t.id === id) || null;
  }

  teamByCode(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return this.s.teams.find((t) => t.joinCode === c) || null;
  }

  challenge(id) {
    return id ? this.s.challenges.find((c) => c.id === id) || null : null;
  }

  game(teamId, key) {
    return this.s.games.find((g) => g.teamId === teamId && g.gameKey === key) || null;
  }

  members(teamId) {
    return this.s.participants.filter((p) => p.teamId === teamId);
  }

  teamName(id) {
    const t = this.team(id);
    return t ? t.customName || t.placeholderName : 'Unknown team';
  }

  ensureGames(teamId) {
    for (const key of GAME_KEYS) {
      if (!this.game(teamId, key)) {
        this.s.games.push({
          teamId,
          gameKey: key,
          status: 'locked',
          points: 0,
          state: key === 'robopath' ? Robo.freshRoboState() : key === 'quiz' ? Quiz.freshQuizState() : Locked.freshLockedState(),
          startedAt: null,
          completedAt: null,
        });
      }
    }
  }

  nextId(kind, prefix) {
    this.s.counters[kind] = (this.s.counters[kind] || 0) + 1;
    return `${prefix}_${pad2(this.s.counters[kind])}`;
  }

  /* ======================================================================
   * scores & ranking
   * ====================================================================== */
  gamePoints(teamId) {
    return round1(GAME_KEYS.reduce((sum, key) => sum + (this.game(teamId, key)?.points || 0), 0));
  }

  adjustmentPoints(teamId) {
    return this.s.adjustments.filter((a) => a.teamId === teamId).reduce((sum, a) => sum + a.points, 0);
  }

  totalScore(teamId) {
    return round1(this.gamePoints(teamId) + this.adjustmentPoints(teamId));
  }

  /** Teams sorted by score; ties: who finished the main games first, then team order. */
  leaderboard() {
    const rows = this.s.teams.map((t) => ({
      id: t.id,
      score: this.totalScore(t.id),
      finished: t.mainFinishedAt || Infinity,
      order: t.order,
    }));
    rows.sort((a, b) => b.score - a.score || a.finished - b.finished || a.order - b.order);
    return rows.map((r, i) => ({ id: r.id, score: r.score, rank: i + 1 }));
  }

  ranks() {
    const map = new Map();
    for (const r of this.leaderboard()) map.set(r.id, r.rank);
    return map;
  }

  refreshLockedPoints(teamId) {
    const g = this.game(teamId, 'locked_phone');
    if (g) g.points = Locked.lockedPoints(g.state, this.now());
  }

  /* ======================================================================
   * feed (shown on the big screen) and audit
   * ====================================================================== */
  log(type, text, teamIds = [], extra = {}) {
    const item = { id: `${this.now().toString(36)}${Math.floor(this.rand() * 1e6).toString(36)}`, at: this.now(), type, text, teamIds, ...extra };
    this.feed.unshift(item);
    if (this.feed.length > FEED_SIZE) this.feed.length = FEED_SIZE;
    if (this.onEvent) this.onEvent(type, { text, teamIds, ...extra });
  }

  /* ======================================================================
   * timers (called several times per second by the server)
   * returns true when something changed
   * ====================================================================== */
  tick() {
    const c = this.comp;
    const now = this.now();
    let changed = false;

    if (c.status === 'COUNTDOWN' && c.countdownEndsAt && now >= c.countdownEndsAt) {
      this.startMainGames();
      changed = true;
    }

    if (c.status === 'MAIN_GAMES' || c.status === 'CHALLENGE_WINDOW') {
      for (const g of this.s.games) {
        if (g.gameKey !== 'locked_phone' || g.status !== 'playing') continue;
        if (Locked.checkDead(g.state, now)) {
          this.endLocked(g, 'dead');
          changed = true;
        }
      }
    }

    if (c.status === 'MAIN_GAMES') {
      // unanswered quiz questions time out on the server, even if the team left
      for (const g of this.s.games) {
        if (g.gameKey !== 'quiz' || g.status !== 'playing') continue;
        if (Quiz.settle(g.state, now)) {
          if (Quiz.isDone(g.state)) this.finishQuiz(g);
          changed = true;
        }
      }
      // time is up for the mini-games: the challenge phase starts by itself
      if (c.mainGamesEndsAt && now >= c.mainGamesEndsAt) {
        this.openChallengeWindow({ auto: true });
        changed = true;
      }
    }

    // Huruf: the answering side ran out of time → the question passes to the other side
    if (this.huroof && this.huroof.game.tick()) changed = true;

    // a new check-in code every minute while check-in is open: screens redraw the QR
    let redraw = false;
    if (c.status === 'REGISTRATION' && c.checkinOpen) {
      const slot = Math.floor(now / CHECKIN_SLOT_MS);
      if (this.checkinSlot !== slot) {
        redraw = this.checkinSlot !== null;
        this.checkinSlot = slot;
      }
    }

    if (c.status === 'CHALLENGE_WINDOW') {
      const windowOpen = this.windowOpen();
      for (const ch of this.s.challenges) {
        if (ch.status !== 'PENDING') continue;
        if (!windowOpen) {
          ch.status = 'EXPIRED';
          ch.respondedAt = now;
          this.log('challenge', `${this.teamName(ch.challengerTeamId)} → ${this.teamName(ch.defenderTeamId)}: request expired (window closed)`, [ch.challengerTeamId, ch.defenderTeamId]);
          changed = true;
        } else if (ch.expiresAt && now >= ch.expiresAt) {
          this.acceptChallenge(ch, true, 'no answer in time');
          changed = true;
        }
      }
      if (!windowOpen && !c.windowClosedLogged) {
        c.windowClosedLogged = true;
        this.log('phase', 'The challenge window is closed. Queued matches will still be played.');
        changed = true;
      }
    }
    if (changed) this.bump();
    return changed || redraw;
  }

  windowOpen() {
    const c = this.comp;
    return c.status === 'CHALLENGE_WINDOW' && !!c.challengeTimerEnd && this.now() < c.challengeTimerEnd;
  }

  /* ======================================================================
   * ADMIN — registration
   * ====================================================================== */
  requireStatus(...list) {
    return list.includes(this.comp.status) ? null : err(`Not possible now (status: ${this.comp.status})`);
  }

  findByPhone(phone) {
    const key = phoneKey(phone);
    return key ? this.s.participants.find((p) => p.phone && phoneKey(p.phone) === key) || null : null;
  }

  /** Validates the registration form. Returns { value } or { error }. */
  readPerson({ fullName, phone, filiere, year }, { phoneRequired, exceptId = null }) {
    const name = cleanText(fullName, 80);
    const y = parseYear(year);
    const rawPhone = cleanText(phone, 30);
    const tel = cleanPhone(rawPhone);
    const field = cleanText(filiere, 80);
    if (name.length < 2) return { error: err('Full name is required', 400) };
    if (phoneRequired && (name.length < 3 || !/\s/.test(name))) return { error: err('Enter your first and last name', 400) };
    if (phoneRequired && !rawPhone) return { error: err('Phone number is required', 400) };
    if (rawPhone && !tel) return { error: err('This phone number does not look right', 400) };
    if (phoneRequired && !field) return { error: err('Field is required', 400) };
    if (!y) return { error: err('Year must be 1, 2 or 3', 400) };
    if (tel) {
      const other = this.findByPhone(tel);
      if (other && other.id !== exceptId) return { error: err('This phone number is already registered', 409) };
    }
    return { value: { fullName: name, phone: tel, filiere: field, year: y } };
  }

  newParticipant(v, source, checkedIn) {
    const now = this.now();
    const p = { id: this.nextId('participant', 'p'), fullName: v.fullName, phone: v.phone || '', filiere: v.filiere, year: v.year, teamId: null, source, checkedInAt: checkedIn ? now : null, createdAt: now };
    this.s.participants.push(p);
    return p;
  }

  /** Admin adds someone at the desk: they are there, so they are confirmed. */
  addParticipant(body) {
    const bad = this.requireStatus('REGISTRATION');
    if (bad) return err('Participants can only be added during registration. Go back to registration first.');
    if (this.s.participants.length >= MAX_PARTICIPANTS) return err(`Too many participants (${MAX_PARTICIPANTS} max)`, 400);
    const { value, error } = this.readPerson(body, { phoneRequired: false });
    if (error) return error;
    const p = this.newParticipant(value, 'admin', body.present !== false);
    this.bump();
    return ok({ participant: p });
  }

  /** Public registration form. With a valid check-in code the person is confirmed at once. */
  register(body) {
    const c = this.comp;
    if (c.status !== 'REGISTRATION') return err('Registration is closed: the teams are already formed', 409);
    const onSite = body.checkinKey ? this.checkinKeyValid(body.checkinKey) : false;
    if (body.checkinKey && !onSite) return err('This check-in code has expired. Scan the QR code on the screen again.', 410);
    if (!c.registrationOpen && !onSite) return err('Registration is closed', 409);
    if (this.s.participants.length >= MAX_PARTICIPANTS) return err('Registration is full', 409);
    const { value, error } = this.readPerson(body, { phoneRequired: true });
    if (error) return error;
    const p = this.newParticipant(value, 'self', onSite && c.checkinOpen);
    this.log('register', `${p.fullName} registered${p.checkedInAt ? ' and checked in' : ''}`);
    this.bump();
    return ok({ participantId: p.id, proof: this.regProof(p.id), fullName: p.fullName, checkedIn: !!p.checkedInAt });
  }

  /** Kept on the student's phone after registering, so check-in is one tap. */
  regProof(id) {
    return crypto.createHmac('sha256', this.secret).update(`reg|${id}`).digest('base64url').slice(0, 22);
  }

  checkinKey(slot = Math.floor(this.now() / CHECKIN_SLOT_MS)) {
    const mac = crypto.createHmac('sha256', this.secret).update(`checkin|${slot}`).digest();
    return mac.toString('base64url').replace(/[-_]/g, '').slice(0, 10);
  }

  checkinKeyValid(key) {
    if (typeof key !== 'string' || key.length !== 10) return false;
    const slot = Math.floor(this.now() / CHECKIN_SLOT_MS);
    const given = Buffer.from(key);
    let found = false;
    for (let i = 0; i < CHECKIN_SLOTS_VALID; i++) {
      const want = Buffer.from(this.checkinKey(slot - i));
      if (want.length === given.length && crypto.timingSafeEqual(want, given)) found = true;
    }
    return found;
  }

  /**
   * A registered person scans the QR on the big screen.
   * Identified by the participant id kept on their phone at registration, or by phone number.
   */
  checkIn({ key, participantId, proof, phone }) {
    const c = this.comp;
    if (c.status !== 'REGISTRATION') return err('Check-in is closed: the teams are already formed', 409);
    if (!c.checkinOpen) return err('Check-in is not open yet. Wait for the organisers.', 409);
    if (!this.checkinKeyValid(key)) return err('This check-in code has expired. Scan the QR code on the screen again.', 410);
    let p = null;
    if (typeof participantId === 'string' && typeof proof === 'string' && proof.length === 22) {
      const want = Buffer.from(this.regProof(participantId));
      const given = Buffer.from(proof);
      if (want.length === given.length && crypto.timingSafeEqual(want, given)) p = this.s.participants.find((x) => x.id === participantId) || null;
    }
    if (!p && phone) p = this.findByPhone(phone);
    if (!p) return err('We could not find your registration', 404);
    const first = !p.checkedInAt;
    if (first) {
      p.checkedInAt = this.now();
      this.log('checkin', `${p.fullName} checked in`);
      this.bump();
    }
    return ok({ participantId: p.id, proof: this.regProof(p.id), fullName: p.fullName, already: !first, quiet: !first });
  }

  setPresence({ id, present }) {
    const bad = this.requireStatus('REGISTRATION');
    if (bad) return err('Presence can only change during registration', 409);
    const p = this.s.participants.find((x) => x.id === id);
    if (!p) return err('Unknown participant', 404);
    p.checkedInAt = present ? p.checkedInAt || this.now() : null;
    this.bump();
    return ok();
  }

  markAllPresent({ present = true } = {}) {
    const bad = this.requireStatus('REGISTRATION');
    if (bad) return err('Presence can only change during registration', 409);
    const now = this.now();
    for (const p of this.s.participants) p.checkedInAt = present ? p.checkedInAt || now : null;
    this.bump();
    return ok();
  }

  setRegistration({ registrationOpen, checkinOpen }) {
    const c = this.comp;
    if (typeof registrationOpen === 'boolean') c.registrationOpen = registrationOpen;
    if (typeof checkinOpen === 'boolean') {
      if (checkinOpen && c.status !== 'REGISTRATION') return err('Check-in happens before the teams are generated', 409);
      if (checkinOpen && !c.checkinOpen) this.log('phase', 'Check-in is open: scan the QR code on the big screen.');
      c.checkinOpen = checkinOpen;
      this.checkinSlot = null;
    }
    this.bump();
    return ok();
  }

  importParticipants({ text }) {
    const bad = this.requireStatus('REGISTRATION');
    if (bad) return err('Participants can only be added during registration.');
    if (typeof text !== 'string' || text.length > 60000) return err('Paste at most 60 000 characters', 400);
    const { rows, errors } = parseParticipantsText(text);
    if (!rows.length) return err(errors[0] || 'No participant found in the text', 400);
    if (this.s.participants.length + rows.length > 600) return err('Too many participants (600 max)', 400);
    for (const r of rows) {
      this.s.participants.push({ id: this.nextId('participant', 'p'), fullName: cleanText(r.fullName, 80), phone: cleanPhone(r.phone), filiere: cleanText(r.filiere, 80), year: r.year, teamId: null, source: 'import', checkedInAt: null, createdAt: this.now() });
    }
    this.bump();
    return ok({ added: rows.length, errors });
  }

  updateParticipant(body) {
    const p = this.s.participants.find((x) => x.id === body.id);
    if (!p) return err('Unknown participant', 404);
    const { value, error } = this.readPerson({ phone: p.phone, ...body }, { phoneRequired: false, exceptId: p.id });
    if (error) return error;
    p.fullName = value.fullName;
    p.phone = value.phone;
    p.filiere = value.filiere;
    p.year = value.year;
    this.bump();
    return ok();
  }

  removeParticipant({ id }) {
    const bad = this.requireStatus('REGISTRATION');
    if (bad) return err('Participants can only be removed during registration.');
    const before = this.s.participants.length;
    this.s.participants = this.s.participants.filter((p) => p.id !== id);
    if (before === this.s.participants.length) return err('Unknown participant', 404);
    this.bump();
    return ok();
  }

  clearParticipants() {
    const bad = this.requireStatus('REGISTRATION');
    if (bad) return bad;
    this.s.participants = [];
    this.bump();
    return ok();
  }

  generateTeams() {
    const bad = this.requireStatus('REGISTRATION', 'LOBBY_LOCKED');
    if (bad) return bad;
    const people = this.s.participants.filter((p) => p.checkedInAt);
    if (!this.s.participants.length) return err('Register participants first', 400);
    if (people.length < 1) return err('Nobody has confirmed their presence yet: open check-in or mark people present', 400);
    const plan = distribute(people.map((p) => ({ id: p.id, year: p.year })));
    if (plan.length > 144) return err('At most 144 teams are supported', 400);
    const names = makeNames(plan.length);
    const codes = new Set();
    const now = this.now();
    this.s.teams = plan.map((t, i) => ({
      id: `team_${pad2(i + 1)}`,
      joinCode: makeJoinCode(codes),
      placeholderName: names[i],
      customName: names[i],
      colorHex: teamColor(i),
      order: i,
      currentGameIndex: 0,
      denialsRemaining: this.comp.maxDenials,
      claimedAt: null,
      mainFinishedAt: null,
      createdAt: now,
    }));
    for (const p of this.s.participants) p.teamId = null;
    plan.forEach((t, i) => {
      for (const pid of t.memberIds) {
        const p = people.find((x) => x.id === pid);
        if (p) p.teamId = this.s.teams[i].id;
      }
    });
    this.s.games = [];
    this.s.challenges = [];
    this.s.adjustments = [];
    for (const t of this.s.teams) this.ensureGames(t.id);
    this.comp.status = 'LOBBY_LOCKED';
    this.comp.checkinOpen = false;
    this.feed = [];
    this.log('phase', `${this.s.teams.length} teams generated from ${people.length} confirmed players. Teams: log in with your join code!`);
    this.bump();
    return ok({ teams: this.s.teams.length });
  }

  backToRegistration() {
    const bad = this.requireStatus('LOBBY_LOCKED');
    if (bad) return bad;
    this.s.teams = [];
    this.s.games = [];
    this.s.challenges = [];
    this.s.adjustments = [];
    for (const p of this.s.participants) p.teamId = null;
    this.comp.status = 'REGISTRATION';
    this.feed = [];
    this.bump();
    return ok();
  }

  moveParticipant({ participantId, teamId }) {
    const bad = this.requireStatus('LOBBY_LOCKED');
    if (bad) return err('Members can be moved while the lobby is open.');
    const p = this.s.participants.find((x) => x.id === participantId);
    const target = this.team(teamId);
    if (!p || !target) return err('Unknown participant or team', 404);
    if (p.teamId === teamId) return ok();
    if (this.members(teamId).length >= MAX_MEMBERS) return err(`A team has at most ${MAX_MEMBERS} members`, 400);
    if (p.teamId && this.members(p.teamId).length <= MIN_MEMBERS) return err(`A team needs at least ${MIN_MEMBERS} member`, 400);
    p.teamId = teamId;
    this.bump();
    return ok();
  }

  renameTeamAdmin({ teamId, name }) {
    const t = this.team(teamId);
    if (!t) return err('Unknown team', 404);
    const res = this.applyName(t, name);
    if (!res.ok) return res;
    this.bump();
    return ok();
  }

  newJoinCode({ teamId }) {
    const t = this.team(teamId);
    if (!t) return err('Unknown team', 404);
    const codes = new Set(this.s.teams.map((x) => x.joinCode));
    t.joinCode = makeJoinCode(codes);
    t.claimedAt = null;
    this.bump();
    return ok({ joinCode: t.joinCode });
  }

  /* ======================================================================
   * ADMIN — phases
   * ====================================================================== */
  beginCompetition() {
    const bad = this.requireStatus('LOBBY_LOCKED');
    if (bad) return bad;
    if (!this.s.teams.length) return err('Generate teams first', 400);
    this.comp.status = 'COUNTDOWN';
    this.comp.countdownEndsAt = this.now() + COUNTDOWN_MS;
    this.log('phase', 'The competition starts in 3…');
    this.bump();
    return ok();
  }

  startMainGames() {
    const c = this.comp;
    const now = this.now();
    c.status = 'MAIN_GAMES';
    c.startedAt = now;
    c.mainGamesEndsAt = now + c.settings.mainGamesMinutes * 60000;
    c.countdownEndsAt = null;
    for (const t of this.s.teams) {
      t.currentGameIndex = 0;
      const g = this.game(t.id, 'robopath');
      g.status = 'playing';
      g.startedAt = now;
    }
    this.log('phase', 'GO! The mini-game gauntlet has started.');
  }

  openChallengeWindow({ minutes, auto = false } = {}) {
    const bad = this.requireStatus('MAIN_GAMES');
    if (bad) return bad;
    const c = this.comp;
    const mins = Number.isFinite(minutes) ? Math.round(minutes) : c.settings.challengeMinutes;
    if (auto) this.log('phase', 'Time is up for the mini-games!');
    if (mins < 1 || mins > 120) return err('The challenge window lasts 1 to 120 minutes', 400);
    const now = this.now();
    this.freezeMainGames(now);
    c.status = 'CHALLENGE_WINDOW';
    c.challengeOpenedAt = now;
    c.challengeTimerEnd = now + mins * 60 * 1000;
    c.mainGamesEndsAt = Math.min(c.mainGamesEndsAt || now, now);
    c.settings.challengeMinutes = mins;
    delete c.windowClosedLogged;
    for (const t of this.s.teams) t.denialsRemaining = c.maxDenials;
    this.log('phase', `The challenge window is open for ${mins} minutes! Lower-ranked teams can challenge teams above them.`);
    this.bump();
    return ok();
  }

  /** Moves the automatic end of the mini-games (MAIN_GAMES only). */
  extendMainGames({ minutes }) {
    const bad = this.requireStatus('MAIN_GAMES');
    if (bad) return bad;
    const m = Math.round(Number(minutes));
    if (!Number.isFinite(m) || m === 0 || Math.abs(m) > 120) return err('Add between -120 and 120 minutes', 400);
    const c = this.comp;
    const now = this.now();
    const before = c.mainGamesEndsAt || now;
    c.mainGamesEndsAt = Math.max(now + 60000, before + m * 60000);
    const left = Math.round((c.mainGamesEndsAt - now) / 60000);
    this.log('phase', `${m > 0 ? 'More time' : 'Less time'} for the mini-games: about ${left} min left.`);
    this.bump();
    return ok();
  }

  extendChallengeWindow({ minutes }) {
    const bad = this.requireStatus('CHALLENGE_WINDOW');
    if (bad) return bad;
    const m = Math.round(Number(minutes));
    if (!Number.isFinite(m) || m === 0 || Math.abs(m) > 60) return err('Add between -60 and 60 minutes', 400);
    const c = this.comp;
    const base = Math.max(this.now(), c.challengeTimerEnd || 0);
    c.challengeTimerEnd = Math.max(this.now(), (m > 0 ? base : c.challengeTimerEnd) + m * 60000);
    if (c.challengeTimerEnd > this.now()) delete c.windowClosedLogged;
    this.log('phase', m > 0 ? `The challenge window was extended by ${m} min.` : `The challenge window was shortened by ${-m} min.`);
    this.bump();
    return ok();
  }

  finishCompetition() {
    const bad = this.requireStatus('MAIN_GAMES', 'CHALLENGE_WINDOW');
    if (bad) return bad;
    const now = this.now();
    if (this.comp.status === 'MAIN_GAMES') this.freezeMainGames(now);
    if (this.huroof) this.abortMatch({ reason: 'competition finished' }, true);
    for (const ch of this.s.challenges) {
      if (ch.status === 'PENDING') { ch.status = 'EXPIRED'; ch.respondedAt = now; }
      if (ch.status === 'QUEUED') { ch.status = 'CANCELLED'; ch.completedAt = now; }
    }
    this.comp.status = 'FINISHED';
    this.comp.finishedAt = now;
    this.comp.activeChallengeId = null;
    const top = this.leaderboard()[0];
    this.log('phase', top ? `The competition is over! ${this.teamName(top.id)} wins with ${top.score} points.` : 'The competition is over!');
    this.bump();
    return ok();
  }

  /** Ends every unfinished mini-game: teams keep the points earned so far. */
  freezeMainGames(now) {
    for (const t of this.s.teams) {
      for (const key of GAME_KEYS) {
        const g = this.game(t.id, key);
        if (['completed', 'abandoned', 'dead'].includes(g.status)) continue;
        if (key === 'locked_phone' && g.state.startedAt) {
          Locked.closeGame(g.state, now);
          g.points = Locked.lockedPoints(g.state, now);
        }
        if (key === 'quiz' && g.state.deck) {
          Quiz.closeQuiz(g.state, now);
          g.points = g.state.score;
        }
        g.status = 'abandoned';
        g.completedAt = now;
      }
      if (t.currentGameIndex < GAMES.length) {
        t.currentGameIndex = GAMES.length;
        t.mainFinishedAt = t.mainFinishedAt || now;
      }
    }
  }

  resetCompetition({ keepParticipants = true } = {}) {
    const keep = keepParticipants !== false ? this.s.participants.map((p) => ({ ...p, teamId: null })) : [];
    const regOpen = this.comp.registrationOpen;
    const counters = this.s.counters;
    const version = this.s.version;
    const settings = this.comp.settings;
    const stake = this.comp.baseChallengeStake;
    const denials = this.comp.maxDenials;
    this.s = emptySnapshot();
    this.s.version = version + 1;
    this.s.counters = { ...counters };
    this.s.participants = keep;
    this.comp.settings = settings;
    this.comp.baseChallengeStake = stake;
    this.comp.maxDenials = denials;
    this.comp.registrationOpen = regOpen;
    this.huroof = null;
    this.feed = [];
    return ok();
  }

  updateSettings(patch = {}) {
    if (!isObj(patch)) return err('Invalid settings', 400);
    const c = this.comp;
    if (patch.baseChallengeStake !== undefined) {
      const v = Number(patch.baseChallengeStake);
      if (!Number.isInteger(v) || v < 0 || v > 1000) return err('Base stake must be 0–1000', 400);
      c.baseChallengeStake = v;
    }
    if (patch.maxDenials !== undefined) {
      const v = Number(patch.maxDenials);
      if (!Number.isInteger(v) || v < 0 || v > 10) return err('Denials must be 0–10', 400);
      // teams keep the denials they already used
      const used = (t) => Math.max(0, c.maxDenials - t.denialsRemaining);
      for (const t of this.s.teams) t.denialsRemaining = Math.max(0, v - used(t));
      c.maxDenials = v;
    }
    const merged = { ...c.settings, ...patch, huroof: { ...c.settings.huroof, ...(isObj(patch.huroof) ? patch.huroof : {}) } };
    c.settings = cleanSettings(merged);
    this.bump();
    return ok();
  }

  adjustScore({ teamId, points, reason }) {
    const t = this.team(teamId);
    if (!t) return err('Unknown team', 404);
    const p = Number(points);
    if (!Number.isInteger(p) || p === 0 || Math.abs(p) > 10000) return err('Points must be a non-zero whole number', 400);
    const why = cleanText(reason, 120) || 'Admin adjustment';
    this.s.adjustments.push({ id: this.nextId('adjustment', 'adj'), teamId, source: 'admin', points: p, reason: why, challengeId: null, createdAt: this.now() });
    this.log('score', `${this.teamName(teamId)} ${p > 0 ? '+' : ''}${p} pts (${why})`, [teamId]);
    this.bump();
    return ok();
  }

  removeAdjustment({ id }) {
    const a = this.s.adjustments.find((x) => x.id === id);
    if (!a) return err('Unknown adjustment', 404);
    if (a.source !== 'admin') return err('Challenge transfers cannot be removed here', 400);
    this.s.adjustments = this.s.adjustments.filter((x) => x.id !== id);
    this.bump();
    return ok();
  }

  /* ======================================================================
   * TEAM — lobby
   * ====================================================================== */
  applyName(team, raw) {
    const name = cleanText(raw, NAME_MAX);
    if (name.length < 2) return err('The name needs at least 2 characters', 400);
    const clash = this.s.teams.find((t) => t.id !== team.id && (t.customName || '').toLowerCase() === name.toLowerCase());
    if (clash) return err('Another team already uses this name', 400);
    const before = team.customName;
    team.customName = name;
    if (before !== name) this.log('team', `${before} is now called ${name}`, [team.id]);
    return ok();
  }

  claim(teamId) {
    const t = this.team(teamId);
    if (!t) return err('Unknown team', 404);
    if (!t.claimedAt) {
      t.claimedAt = this.now();
      this.log('team', `${t.customName} joined the lobby`, [t.id]);
      this.bump();
      return ok({ changed: true });
    }
    return ok({ changed: false });
  }

  renameTeam(teamId, { name }) {
    const bad = this.requireStatus('LOBBY_LOCKED');
    if (bad) return err('Team names are locked once the competition has started');
    const t = this.team(teamId);
    if (!t) return err('Unknown team', 404);
    const res = this.applyName(t, name);
    if (!res.ok) return res;
    this.bump();
    return ok();
  }

  /* ======================================================================
   * TEAM — mini-game gauntlet
   * ====================================================================== */
  requirePlaying(teamId, index) {
    const t = this.team(teamId);
    if (!t) return { error: err('Unknown team', 404) };
    if (this.comp.status !== 'MAIN_GAMES') return { error: err('The mini-games are not running') };
    if (t.currentGameIndex !== index) return { error: err('This game is not your current game') };
    return { team: t };
  }

  robopathSave(teamId, { level, program }) {
    const { team, error } = this.requirePlaying(teamId, 0);
    if (error) return error;
    const g = this.game(team.id, 'robopath');
    const res = Robo.saveProgram(g.state, level, program);
    if (!res.ok) return err(res.error, 400);
    this.bump();
    return ok({ quiet: true });
  }

  robopathRun(teamId, { level, program }) {
    const { team, error } = this.requirePlaying(teamId, 0);
    if (error) return error;
    const g = this.game(team.id, 'robopath');
    const res = Robo.verifyRun(g.state, level, program);
    if (!res.ok) return err(res.error, 400);
    g.points = Robo.roboPoints(g.state);
    if (res.solvedNow) {
      this.log('game', `${team.customName} solved RoboPath level ${level + 1} (+${res.levelPoints})`, [team.id]);
      if (Robo.allDone(g.state)) this.finishRobopath(team, 'completed');
    }
    this.bump();
    return ok({ status: res.status, solved: res.solvedNow, points: g.points });
  }

  /** Skips a RoboPath level: no points for it, the next level opens. */
  robopathSkip(teamId, { level }) {
    const { team, error } = this.requirePlaying(teamId, 0);
    if (error) return error;
    const g = this.game(team.id, 'robopath');
    const res = Robo.skipLevel(g.state, level);
    if (!res.ok) return err(res.error, 400);
    this.log('game', `${team.customName} skipped RoboPath level ${level + 1}`, [team.id]);
    if (Robo.allDone(g.state)) this.finishRobopath(team, 'completed');
    this.bump();
    return ok({ finished: team.currentGameIndex > 0 });
  }

  robopathGiveUp(teamId) {
    const { team, error } = this.requirePlaying(teamId, 0);
    if (error) return error;
    this.finishRobopath(team, 'abandoned');
    this.bump();
    return ok();
  }

  finishRobopath(team, status) {
    const g = this.game(team.id, 'robopath');
    g.status = status;
    g.completedAt = this.now();
    team.currentGameIndex = 1;
    const next = this.game(team.id, 'locked_phone');
    next.status = 'ready';
    if (status === 'abandoned') this.log('game', `${team.customName} moved on from RoboPath with ${g.points} pts`, [team.id]);
    else if (Robo.allSolved(g.state)) this.log('game', `${team.customName} completed RoboPath! (${g.points} pts)`, [team.id]);
    else this.log('game', `${team.customName} finished RoboPath (${g.points} pts)`, [team.id]);
  }

  lockedStart(teamId) {
    const { team, error } = this.requirePlaying(teamId, 1);
    if (error) return error;
    const g = this.game(team.id, 'locked_phone');
    if (g.status !== 'ready') return err('The phone is already on');
    const res = Locked.start(g.state, this.now(), this.comp.settings.lockedBatteryMinutes);
    if (!res.ok) return err(res.error);
    g.status = 'playing';
    g.startedAt = this.now();
    this.bump();
    return ok();
  }

  lockedGame(teamId) {
    const { team, error } = this.requirePlaying(teamId, 1);
    if (error) return { error };
    const g = this.game(team.id, 'locked_phone');
    if (g.status !== 'playing') return { error: err('The phone is off') };
    return { team, g };
  }

  lockedAttempt(teamId, { lock, answer }) {
    const { team, g, error } = this.lockedGame(teamId);
    if (error) return error;
    if (typeof answer !== 'string' || answer.length > 80) return err('Invalid answer', 400);
    if (lock === 2 && !/^-?\d{1,9}(\.\d+)?$/.test(answer.trim())) return ok({ correct: false, stage: g.state.stage, quiet: true });
    const res = Locked.attempt(g.state, lock, answer, this.now(), this.timeZone);
    if (!res.ok) return err(res.error, 400);
    if (res.correct) {
      this.log('game', `${team.customName} opened lock ${res.stage}/4 of the Locked Phone`, [team.id]);
    }
    if (res.found) this.endLocked(g, 'found');
    else if (res.died) this.endLocked(g, 'dead');
    else this.refreshLockedPoints(team.id);
    this.bump();
    if (res.free) return ok({ correct: false, stage: g.state.stage, quiet: true });
    return ok({ correct: res.correct, stage: g.state.stage, died: !!res.died, found: !!res.found });
  }

  lockedHint(teamId) {
    const { team, g, error } = this.lockedGame(teamId);
    if (error) return error;
    const res = Locked.takeHint(g.state, this.now());
    if (!res.ok) return err(res.error, 400);
    if (res.died) this.endLocked(g, 'dead');
    this.bump();
    return ok({ hint: g.state.hintLog[g.state.hintLog.length - 1] || null, team: team.id });
  }

  /** Skips the current lock of the Locked Phone: it opens without points. */
  lockedSkip(teamId) {
    const { team, g, error } = this.lockedGame(teamId);
    if (error) return error;
    const lock = g.state.stage;
    const res = Locked.skipLock(g.state, this.now());
    if (!res.ok) return err(res.error, 400);
    if (res.died) this.endLocked(g, 'dead');
    else {
      this.log('game', `${team.customName} skipped lock ${lock + 1}/4 of the Locked Phone`, [team.id]);
      if (res.finished) this.endLocked(g, 'finished');
      else this.refreshLockedPoints(team.id);
    }
    this.bump();
    return ok({ stage: g.state.stage, died: !!res.died, finished: !!res.finished });
  }

  lockedGiveUp(teamId) {
    const { team, error } = this.requirePlaying(teamId, 1);
    if (error) return error;
    const g = this.game(team.id, 'locked_phone');
    Locked.giveUp(g.state, this.now());
    this.endLocked(g, 'gave_up');
    this.bump();
    return ok();
  }

  endLocked(g, reason) {
    const now = this.now();
    if (!g.state.endedAt) {
      if (reason === 'gave_up') Locked.giveUp(g.state, now);
      else if (reason === 'closed') Locked.closeGame(g.state, now);
    }
    g.points = Locked.lockedPoints(g.state, now);
    g.status = reason === 'found' || reason === 'finished' ? 'completed' : reason === 'dead' ? 'dead' : 'abandoned';
    g.completedAt = now;
    const team = this.team(g.teamId);
    if (team && team.currentGameIndex === 1) {
      team.currentGameIndex = QUIZ_INDEX;
      const quiz = this.game(team.id, 'quiz');
      if (quiz.status === 'locked') quiz.status = 'ready';
    }
    const name = this.teamName(g.teamId);
    if (reason === 'found') this.log('game', `${name} cracked the Locked Phone! (${g.points} pts)`, [g.teamId]);
    else if (reason === 'finished') this.log('game', `${name} finished the Locked Phone (${g.points} pts)`, [g.teamId]);
    else if (reason === 'dead') this.log('game', `${name}'s phone died (${g.points} pts)`, [g.teamId]);
    else this.log('game', `${name} stopped the Locked Phone (${g.points} pts)`, [g.teamId]);
  }

  /* ---------------- N7 Quiz ---------------- */
  quizStart(teamId) {
    const { team, error } = this.requirePlaying(teamId, QUIZ_INDEX);
    if (error) return error;
    const g = this.game(team.id, 'quiz');
    if (g.status !== 'ready') return err('The quiz has already started');
    const res = Quiz.startQuiz(g.state, this.now(), this.randInt);
    if (!res.ok) return err(res.error);
    g.status = 'playing';
    g.startedAt = this.now();
    g.points = 0;
    this.log('game', `${team.customName} started the N7 Quiz`, [team.id]);
    this.bump();
    return ok({ quiz: Quiz.quizView(g.state, g.status) });
  }

  quizAnswer(teamId, { qid, choice, tabSwitches }) {
    const { team, error } = this.requirePlaying(teamId, QUIZ_INDEX);
    if (error) return error;
    const g = this.game(team.id, 'quiz');
    if (g.status !== 'playing') return err('The quiz is not running');
    const res = Quiz.answer(g.state, { qid, choice: choice === undefined ? null : choice, tabSwitches }, this.now());
    if (!res.ok) return err(res.error, 400);
    if (Quiz.isDone(g.state)) this.finishQuiz(g);
    this.bump();
    return ok({ quiz: Quiz.quizView(g.state, g.status) });
  }

  /** Tab switches are reported even between answers (anti-cheat, shown to the admin). */
  quizReport(teamId, { tabSwitches }) {
    const t = this.team(teamId);
    const g = t && this.game(t.id, 'quiz');
    if (!g || g.status !== 'playing') return ok({ quiet: true });
    const sw = Math.floor(Number(tabSwitches));
    if (Number.isFinite(sw) && sw > g.state.switches) g.state.switches = Math.min(sw, 999);
    return ok({ quiet: true });
  }

  finishQuiz(g) {
    const now = this.now();
    g.status = 'completed';
    g.completedAt = now;
    g.points = g.state.score;
    const team = this.team(g.teamId);
    if (team && team.currentGameIndex === QUIZ_INDEX) {
      team.currentGameIndex = GAMES.length;
      team.mainFinishedAt = now;
    }
    this.log('game', `${this.teamName(g.teamId)} finished the N7 Quiz (${g.points} pts)`, [g.teamId]);
    if (team && this.s.teams.every((t) => t.currentGameIndex >= GAMES.length)) {
      this.log('phase', 'Every team has finished the mini-games.');
    }
  }

  /* ======================================================================
   * challenges
   * ====================================================================== */
  /** A team is busy while it has a pending, queued or live challenge. */
  busyChallenge(teamId) {
    return this.s.challenges.find((c) => ['PENDING', 'QUEUED', 'IN_PROGRESS'].includes(c.status) &&
      (c.challengerTeamId === teamId || c.defenderTeamId === teamId)) || null;
  }

  alreadyPlayed(a, b) {
    return this.s.challenges.some((c) => ['QUEUED', 'IN_PROGRESS', 'COMPLETED'].includes(c.status) &&
      ((c.challengerTeamId === a && c.defenderTeamId === b) || (c.challengerTeamId === b && c.defenderTeamId === a)));
  }

  /** Teams `teamId` may challenge right now, with the stake each would carry. */
  challengeTargets(teamId) {
    if (!this.windowOpen()) return [];
    const ranks = this.ranks();
    const myRank = ranks.get(teamId);
    if (!myRank || this.busyChallenge(teamId)) return [];
    return this.leaderboard()
      .filter((r) => r.rank < myRank)
      .map((r) => {
        const busy = !!this.busyChallenge(r.id);
        const played = this.alreadyPlayed(teamId, r.id);
        return {
          teamId: r.id,
          rank: r.rank,
          stake: this.comp.baseChallengeStake * (myRank - r.rank),
          available: !busy && !played,
          reason: played ? 'Already played' : busy ? 'Busy' : null,
        };
      });
  }

  requestChallenge(challengerId, { defenderId }) {
    if (this.comp.status !== 'CHALLENGE_WINDOW') return err('The challenge phase is not open');
    if (!this.windowOpen()) return err('The challenge window is closed');
    const me = this.team(challengerId);
    const them = this.team(defenderId);
    if (!me || !them) return err('Unknown team', 404);
    if (me.id === them.id) return err('You cannot challenge yourself', 400);
    const ranks = this.ranks();
    if (!(ranks.get(me.id) > ranks.get(them.id))) return err('You can only challenge teams ranked above you', 400);
    if (this.busyChallenge(me.id)) return err('You already have a challenge in progress');
    if (this.busyChallenge(them.id)) return err(`${them.customName} is busy with another challenge`);
    if (this.alreadyPlayed(me.id, them.id)) return err('These two teams already played their match');
    const now = this.now();
    const ch = {
      id: this.nextId('challenge', 'chal'),
      challengerTeamId: me.id,
      defenderTeamId: them.id,
      status: 'PENDING',
      autoAccepted: false,
      challengerRank: ranks.get(me.id),
      defenderRank: ranks.get(them.id),
      rankDelta: null,
      lockedPointStake: null,
      winnerTeamId: null,
      requestedAt: now,
      expiresAt: now + this.comp.settings.responseTimeoutSec * 1000,
      respondedAt: null,
      acceptedAt: null,
      startedAt: null,
      completedAt: null,
      huroof: null,
    };
    this.s.challenges.push(ch);
    this.log('challenge', `⚔ ${me.customName} (#${ch.challengerRank}) challenges ${them.customName} (#${ch.defenderRank})!`, [me.id, them.id], { alert: true });
    if (them.denialsRemaining <= 0) this.acceptChallenge(ch, true, 'no denials left');
    this.bump();
    return ok({ challengeId: ch.id, status: ch.status });
  }

  cancelChallenge(teamId, { id }) {
    const ch = this.challenge(id);
    if (!ch || ch.challengerTeamId !== teamId) return err('Unknown challenge', 404);
    if (ch.status !== 'PENDING') return err('Only an unanswered request can be withdrawn');
    ch.status = 'CANCELLED';
    ch.respondedAt = this.now();
    this.log('challenge', `${this.teamName(teamId)} withdrew its challenge`, [ch.challengerTeamId, ch.defenderTeamId]);
    this.bump();
    return ok();
  }

  respondChallenge(teamId, { id, accept }) {
    const ch = this.challenge(id);
    if (!ch || ch.defenderTeamId !== teamId) return err('Unknown challenge', 404);
    if (ch.status !== 'PENDING') return err('This challenge was already answered');
    const me = this.team(teamId);
    if (accept === true) {
      this.acceptChallenge(ch, false);
    } else {
      if (me.denialsRemaining <= 0) {
        this.acceptChallenge(ch, true, 'no denials left');
      } else {
        me.denialsRemaining -= 1;
        ch.status = 'DENIED';
        ch.respondedAt = this.now();
        this.log('challenge', `${me.customName} denied the challenge of ${this.teamName(ch.challengerTeamId)} (${me.denialsRemaining} denial${me.denialsRemaining === 1 ? '' : 's'} left)`, [ch.challengerTeamId, me.id]);
      }
    }
    this.bump();
    return ok({ status: ch.status });
  }

  /** Locks the stake from the current ranks and queues the match. */
  acceptChallenge(ch, auto, why = '') {
    const now = this.now();
    const ranks = this.ranks();
    const cr = ranks.get(ch.challengerTeamId);
    const dr = ranks.get(ch.defenderTeamId);
    ch.respondedAt = now;
    if (!(cr > dr)) {
      ch.status = 'CANCELLED';
      this.log('challenge', `Challenge ${this.teamName(ch.challengerTeamId)} → ${this.teamName(ch.defenderTeamId)} cancelled: the ranking changed`, [ch.challengerTeamId, ch.defenderTeamId]);
      return;
    }
    ch.status = 'QUEUED';
    ch.autoAccepted = !!auto;
    ch.acceptedAt = now;
    ch.challengerRank = cr;
    ch.defenderRank = dr;
    ch.rankDelta = cr - dr;
    ch.lockedPointStake = this.comp.baseChallengeStake * ch.rankDelta;
    const how = auto ? `automatically accepted (${why})` : 'accepted';
    this.log('challenge', `${this.teamName(ch.defenderTeamId)} ${how}: ${ch.lockedPointStake} pts at stake!`, [ch.challengerTeamId, ch.defenderTeamId], { alert: true });
    this.pumpQueue();
  }

  queue() {
    return this.s.challenges
      .filter((c) => c.status === 'QUEUED')
      .sort((a, b) => a.acceptedAt - b.acceptedAt || (a.id < b.id ? -1 : 1));
  }

  /** Starts the next queued match when no match is being played. */
  pumpQueue() {
    if (this.huroof) return;
    if (!['CHALLENGE_WINDOW'].includes(this.comp.status)) return;
    const next = this.queue()[0];
    if (!next) {
      this.comp.activeChallengeId = null;
      return;
    }
    next.status = 'IN_PROGRESS';
    next.startedAt = this.now();
    this.comp.activeChallengeId = next.id;
    this.huroof = { challengeId: next.id, game: createHuroof({ bank: this.bank, settings: this.comp.settings.huroof, rand: this.rand, now: this.now }) };
    next.huroof = this.huroof.game.serialize();
    this.log('match', `Up now: ${this.teamName(next.challengerTeamId)} vs ${this.teamName(next.defenderTeamId)}`, [next.challengerTeamId, next.defenderTeamId], { alert: true });
  }

  /** Presenter command on the live Huruf board. */
  matchAct({ type, ...payload }) {
    if (!this.huroof) return err('No match is being played');
    if (typeof type !== 'string') return err('Unknown command', 400);
    const res = this.huroof.game.act(type, payload);
    if (!res.ok) return err(res.error);
    this.bump();
    return ok();
  }

  buzz(teamId) {
    if (!this.huroof) return err('No match is being played');
    const ch = this.challenge(this.huroof.challengeId);
    const side = ch.challengerTeamId === teamId ? 0 : ch.defenderTeamId === teamId ? 1 : -1;
    if (side < 0) return err('Your team is not playing this match', 403);
    const res = this.huroof.game.buzz(side);
    if (res.accepted) this.bump();
    return ok({ accepted: !!res.accepted });
  }

  /** Confirms the result of a finished match and transfers the stake. */
  settleMatch({ winnerTeamId } = {}) {
    if (!this.huroof) return err('No match is being played');
    const ch = this.challenge(this.huroof.challengeId);
    const st = this.huroof.game.state;
    let winner = null;
    if (winnerTeamId) {
      if (winnerTeamId !== ch.challengerTeamId && winnerTeamId !== ch.defenderTeamId) return err('The winner must be one of the two teams', 400);
      winner = winnerTeamId;
    } else {
      if (st.phase !== 'matchOver' || (st.matchWinner !== 0 && st.matchWinner !== 1)) return err('The match is not over yet');
      winner = st.matchWinner === 0 ? ch.challengerTeamId : ch.defenderTeamId;
    }
    const loser = winner === ch.challengerTeamId ? ch.defenderTeamId : ch.challengerTeamId;
    const stake = ch.lockedPointStake || 0;
    const now = this.now();
    ch.huroof = this.huroof.game.serialize();
    ch.status = 'COMPLETED';
    ch.winnerTeamId = winner;
    ch.completedAt = now;
    if (stake > 0) {
      const reason = `Huruf: ${this.teamName(ch.challengerTeamId)} vs ${this.teamName(ch.defenderTeamId)}`;
      this.s.adjustments.push({ id: this.nextId('adjustment', 'adj'), teamId: winner, source: 'challenge', points: stake, reason, challengeId: ch.id, createdAt: now });
      this.s.adjustments.push({ id: this.nextId('adjustment', 'adj'), teamId: loser, source: 'challenge', points: -stake, reason, challengeId: ch.id, createdAt: now });
    }
    this.log('match', `🏆 ${this.teamName(winner)} beats ${this.teamName(loser)}: +${stake} / −${stake} pts`, [winner, loser], { alert: true, winner });
    this.huroof = null;
    this.comp.activeChallengeId = null;
    this.lastResult = { challengeId: ch.id, winner, loser, stake, at: now };
    this.pumpQueue();
    this.bump();
    return ok();
  }

  abortMatch({ reason } = {}, internal = false) {
    if (!this.huroof) return err('No match is being played');
    const ch = this.challenge(this.huroof.challengeId);
    ch.huroof = this.huroof.game.serialize();
    ch.status = 'ABORTED';
    ch.completedAt = this.now();
    this.huroof = null;
    this.comp.activeChallengeId = null;
    this.log('match', `Match ${this.teamName(ch.challengerTeamId)} vs ${this.teamName(ch.defenderTeamId)} was cancelled (no points)${reason ? ': ' + cleanText(reason, 80) : ''}`, [ch.challengerTeamId, ch.defenderTeamId]);
    if (!internal) {
      this.pumpQueue();
      this.bump();
    }
    return ok();
  }

  adminCancelChallenge({ id }) {
    const ch = this.challenge(id);
    if (!ch) return err('Unknown challenge', 404);
    if (ch.status === 'IN_PROGRESS') return this.abortMatch({ reason: 'cancelled by the admin' });
    if (!['PENDING', 'QUEUED'].includes(ch.status)) return err('This challenge is already over');
    ch.status = 'CANCELLED';
    ch.completedAt = this.now();
    this.log('challenge', `Challenge ${this.teamName(ch.challengerTeamId)} → ${this.teamName(ch.defenderTeamId)} cancelled by the admin`, [ch.challengerTeamId, ch.defenderTeamId]);
    this.bump();
    return ok();
  }

  /* ======================================================================
   * views
   * ====================================================================== */
  teamSummary(t, ranks, { codes = false, members = true } = {}) {
    const robo = this.game(t.id, 'robopath');
    const locked = this.game(t.id, 'locked_phone');
    const quiz = this.game(t.id, 'quiz');
    const busy = this.busyChallenge(t.id);
    return {
      id: t.id,
      name: t.customName || t.placeholderName,
      placeholderName: t.placeholderName,
      colorHex: t.colorHex,
      order: t.order,
      joinCode: codes ? t.joinCode : undefined,
      claimed: !!t.claimedAt,
      members: members ? this.members(t.id).map((p) => ({ name: p.fullName, filiere: p.filiere, year: p.year })) : undefined,
      score: this.totalScore(t.id),
      gamePoints: this.gamePoints(t.id),
      challengePoints: this.adjustmentPoints(t.id),
      rank: ranks.get(t.id) || null,
      currentGameIndex: t.currentGameIndex,
      denialsRemaining: t.denialsRemaining,
      busy: busy ? busy.status : null,
      games: {
        robopath: { status: robo.status, points: robo.points, solved: robo.state.solved.filter(Boolean).length, skipped: robo.state.skipped.filter(Boolean).length, total: Robo.LEVEL_COUNT },
        locked_phone: { status: locked.status, points: locked.points, stage: locked.state.stage, skipped: locked.state.skipped.filter(Boolean).length, total: 4 },
        quiz: { status: quiz.status, points: quiz.points, ...Quiz.quizProgress(quiz.state) },
      },
    };
  }

  challengeSummary(c) {
    if (!c) return null;
    return {
      id: c.id,
      challengerTeamId: c.challengerTeamId,
      defenderTeamId: c.defenderTeamId,
      status: c.status,
      autoAccepted: c.autoAccepted,
      challengerRank: c.challengerRank,
      defenderRank: c.defenderRank,
      rankDelta: c.rankDelta,
      lockedPointStake: c.lockedPointStake,
      winnerTeamId: c.winnerTeamId,
      requestedAt: c.requestedAt,
      expiresAt: c.expiresAt,
      acceptedAt: c.acceptedAt,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
    };
  }

  competitionPublic() {
    const c = this.comp;
    return {
      status: c.status,
      countdownEndsAt: c.countdownEndsAt,
      startedAt: c.startedAt,
      mainGamesEndsAt: c.mainGamesEndsAt,
      mainGamesMinutes: c.settings.mainGamesMinutes,
      challengeOpenedAt: c.challengeOpenedAt,
      challengeTimerEnd: c.challengeTimerEnd,
      windowOpen: this.windowOpen(),
      finishedAt: c.finishedAt,
      baseChallengeStake: c.baseChallengeStake,
      maxDenials: c.maxDenials,
      responseTimeoutSec: c.settings.responseTimeoutSec,
      minMembers: c.minMembers,
      maxMembers: c.maxMembers,
      games: GAMES,
    };
  }

  matchView(role, teamId = null) {
    if (!this.huroof) return null;
    const ch = this.challenge(this.huroof.challengeId);
    let side = null;
    if (teamId === ch.challengerTeamId) side = 0;
    else if (teamId === ch.defenderTeamId) side = 1;
    const r = role === 'team' ? (side === null ? 'board' : 'player') : role;
    return {
      challenge: this.challengeSummary(ch),
      side,
      board: this.huroof.game.view(r, side),
    };
  }

  queueView() {
    return this.queue().map((c, i) => ({ ...this.challengeSummary(c), position: i + 1 }));
  }

  baseView() {
    const ranks = this.ranks();
    return {
      now: this.now(),
      version: this.s.version,
      competition: this.competitionPublic(),
      leaderboard: this.leaderboard(),
      ranks,
    };
  }

  /** What anyone may see on the public page: no codes, no members. */
  publicView(eventName) {
    const c = this.comp;
    const started = ['MAIN_GAMES', 'CHALLENGE_WINDOW', 'FINISHED'].includes(c.status);
    const byId = new Map(this.s.teams.map((t) => [t.id, t]));
    const match = this.huroof ? this.challenge(this.huroof.challengeId) : null;
    const brief = (id) => {
      const t = byId.get(id);
      return t ? { name: t.customName || t.placeholderName, colorHex: t.colorHex } : null;
    };
    return {
      eventName,
      now: this.now(),
      status: c.status,
      teamCount: this.s.teams.length,
      claimedCount: this.s.teams.filter((t) => t.claimedAt).length,
      participantCount: this.s.participants.length,
      confirmedCount: this.s.participants.filter((p) => p.checkedInAt).length,
      registrationOpen: c.status === 'REGISTRATION' && c.registrationOpen,
      checkinOpen: c.status === 'REGISTRATION' && c.checkinOpen,
      fields: this.fieldSuggestions(),
      countdownEndsAt: c.countdownEndsAt,
      mainGamesEndsAt: c.mainGamesEndsAt,
      challengeTimerEnd: c.challengeTimerEnd,
      windowOpen: this.windowOpen(),
      baseChallengeStake: c.baseChallengeStake,
      maxDenials: c.maxDenials,
      standings: started
        ? this.leaderboard().map((r) => ({ rank: r.rank, score: r.score, ...brief(r.id) }))
        : [],
      match: match ? { challenger: brief(match.challengerTeamId), defender: brief(match.defenderTeamId), stake: match.lockedPointStake } : null,
    };
  }

  fieldSuggestions() {
    const count = new Map();
    for (const p of this.s.participants) {
      const f = (p.filiere || '').trim();
      if (f) count.set(f, (count.get(f) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([f]) => f);
  }

  /** Registration / check-in figures for the big screen (no phone numbers). */
  registrationView({ withKey }) {
    const c = this.comp;
    const people = this.s.participants;
    const confirmed = people.filter((p) => p.checkedInAt).sort((a, b) => b.checkedInAt - a.checkedInAt);
    const open = c.status === 'REGISTRATION' && c.checkinOpen;
    return {
      registrationOpen: c.status === 'REGISTRATION' && c.registrationOpen,
      checkinOpen: open,
      registered: people.length,
      confirmed: confirmed.length,
      recent: confirmed.slice(0, 18).map((p) => ({ id: p.id, name: p.fullName, filiere: p.filiere, year: p.year })),
      checkinKey: withKey && open ? this.checkinKey() : null,
      slotMs: CHECKIN_SLOT_MS,
    };
  }

  /** The big screen. Join codes are shown only before the competition starts. */
  hostView() {
    const b = this.baseView();
    const showCodes = ['REGISTRATION', 'LOBBY_LOCKED'].includes(this.comp.status);
    return {
      role: 'host',
      registration: this.registrationView({ withKey: true }),
      now: b.now,
      version: b.version,
      competition: b.competition,
      teams: this.s.teams.map((t) => this.teamSummary(t, b.ranks, { codes: showCodes })),
      leaderboard: b.leaderboard,
      match: this.matchView('board'),
      queue: this.queueView(),
      pending: this.s.challenges.filter((c) => c.status === 'PENDING').map((c) => this.challengeSummary(c)),
      history: this.s.challenges.filter((c) => c.status === 'COMPLETED').slice(-8).map((c) => this.challengeSummary(c)),
      lastResult: this.lastResult || null,
      feed: this.feed.slice(0, 14),
    };
  }

  adminView() {
    const b = this.baseView();
    return {
      role: 'admin',
      now: b.now,
      version: b.version,
      competition: { ...b.competition, settings: this.comp.settings, registrationOpen: this.comp.registrationOpen, checkinOpen: this.comp.checkinOpen },
      registration: this.registrationView({ withKey: true }),
      participants: this.s.participants,
      teams: this.s.teams.map((t) => this.teamSummary(t, b.ranks, { codes: true })),
      leaderboard: b.leaderboard,
      match: this.matchView('presenter'),
      queue: this.queueView(),
      challenges: this.s.challenges.map((c) => this.challengeSummary(c)),
      adjustments: this.s.adjustments,
      feed: this.feed,
    };
  }

  teamView(teamId) {
    const t = this.team(teamId);
    if (!t) return null;
    const b = this.baseView();
    const now = this.now();
    const robo = this.game(t.id, 'robopath');
    const locked = this.game(t.id, 'locked_phone');
    const quiz = this.game(t.id, 'quiz');
    const mine = (c) => c.challengerTeamId === t.id || c.defenderTeamId === t.id;
    const queue = this.queueView();
    return {
      role: 'team',
      now,
      version: b.version,
      competition: b.competition,
      me: { ...this.teamSummary(t, b.ranks), joinCode: t.joinCode },
      teams: this.s.teams.map((x) => this.teamSummary(x, b.ranks, { members: x.id === t.id })),
      leaderboard: b.leaderboard,
      robopath: { status: robo.status, points: robo.points, solved: robo.state.solved, skipped: robo.state.skipped, programs: robo.state.programs, levelPoints: Robo.LEVEL_POINTS },
      lockedPhone: { status: locked.status, points: locked.points, ...Locked.lockedView(locked.state, now, this.timeZone, this.flag) },
      quiz: { status: quiz.status, points: ['completed', 'abandoned'].includes(quiz.status) ? quiz.points : null, ...Quiz.quizView(quiz.state, quiz.status) },
      challenge: {
        targets: t.currentGameIndex >= 0 ? this.challengeTargets(t.id) : [],
        incoming: this.s.challenges.filter((c) => c.status === 'PENDING' && c.defenderTeamId === t.id).map((c) => this.challengeSummary(c)),
        outgoing: this.s.challenges.filter((c) => c.status === 'PENDING' && c.challengerTeamId === t.id).map((c) => this.challengeSummary(c)),
        mine: this.s.challenges.filter(mine).slice(-10).map((c) => this.challengeSummary(c)),
        queue,
      },
      match: this.matchView('team', t.id),
      lastResult: this.lastResult || null,
    };
  }
}
