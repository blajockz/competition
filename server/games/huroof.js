/*
 * Rules engine for the 1v1 Huruf showdown (حروف).
 * Ported from huroof-challenge/lib/game.js and wired to the platform:
 *   side 0 = the CHALLENGER (links right ↔ left)
 *   side 1 = the DEFENDER   (links top ↕ bottom)
 *
 * Flow of one turn:
 *   pick      the side that won the last cell names a letter, the presenter taps it
 *   question  the presenter reads the question, both buzzers are open
 *   answer    a side buzzed (or the presenter gave it the turn) and must answer
 *             correct -> the cell is theirs, they pick next
 *             wrong   -> the other side answers without buzzing
 *             no answer before the clock ends -> same as wrong (turn passes)
 *   missed    both sides failed: another question or another letter
 * A round ends when a side links its two edges. The match ends at `roundsToWin`.
 */
import { findPath } from '../../shared/huroof/hex.js';

export const LETTERS = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص',
  'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'];

export const DEFAULT_SETTINGS = {
  size: 4,
  roundsToWin: 1,
  answerTime: 8,
  showQuestion: true,
  extraBank: false,
};

const UNDO_LIMIT = 60;
const PLAY_KEYS = ['phase', 'round', 'score', 'cells', 'chooser', 'sel', 'q', 'turn', 'tried',
  'armed', 'buzzer', 'timer', 'reveal', 'path', 'roundWinner', 'matchWinner', 'last', 'used'];

const clone = (x) => JSON.parse(JSON.stringify(x));

export function cleanHuroofSettings(raw = {}) {
  const s = { ...DEFAULT_SETTINGS };
  if (raw.size === 4 || raw.size === 5) s.size = raw.size;
  if ([1, 2, 3].includes(raw.roundsToWin)) s.roundsToWin = raw.roundsToWin;
  if ([0, 5, 8, 12, 20].includes(raw.answerTime)) s.answerTime = raw.answerTime;
  if (typeof raw.showQuestion === 'boolean') s.showQuestion = raw.showQuestion;
  if (typeof raw.extraBank === 'boolean') s.extraBank = raw.extraBank;
  return s;
}

/**
 * @param {object} opts
 * @param {Array}  opts.bank      question bank [{id, letter, q, a, src}]
 * @param {object} [opts.saved]   a previous serialize() result
 * @param {object} [opts.settings]
 */
export function createHuroof({ bank = [], saved = null, settings = {}, rand = Math.random, now = Date.now } = {}) {
  const fresh = () => ({
    v: 3,
    settings: cleanHuroofSettings(settings),
    phase: 'lobby',
    round: 0,
    score: [0, 0],
    cells: [],
    chooser: 0,
    sel: -1,
    q: null,
    turn: null,
    tried: [false, false],
    armed: false,
    buzzer: null,
    timer: null,
    reveal: false,
    path: [],
    roundWinner: null,
    matchWinner: null,
    last: null,
    used: {},
    fx: { seq: 0, type: null, team: null },
  });

  let s = fresh();
  if (saved && saved.v === 3) {
    s = Object.assign(fresh(), clone(saved));
    s.settings = cleanHuroofSettings(saved.settings || {});
    s.timer = null; // a restart never resumes a running clock
  }
  const undo = [];
  const bankCounts = { main: bank.filter((q) => q.src !== 'forum').length, extra: bank.filter((q) => q.src === 'forum').length };

  const size = () => Math.round(Math.sqrt(s.cells.length)) || s.settings.size;
  const owners = () => s.cells.map((c) => c.o);
  const other = (t) => 1 - t;

  function fx(type, team = null) {
    s.fx = { seq: s.fx.seq + 1, type, team };
  }

  function snapshot() {
    const snap = {};
    for (const k of PLAY_KEYS) snap[k] = clone(s[k]);
    undo.push(snap);
    if (undo.length > UNDO_LIMIT) undo.shift();
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function drawQuestion(letter, avoidId) {
    const inPool = (q) => q.letter === letter && (s.settings.extraBank || q.src !== 'forum');
    let pool = bank.filter((q) => inPool(q) && !s.used[q.id] && q.id !== avoidId);
    if (!pool.length) {
      for (const q of bank) if (q.letter === letter) delete s.used[q.id];
      pool = bank.filter((q) => inPool(q) && q.id !== avoidId);
    }
    if (!pool.length) return null;
    const q = pool[Math.floor(rand() * pool.length)];
    return { id: q.id, q: q.q, a: q.a, src: q.src };
  }

  function startTimer() {
    const secs = s.settings.answerTime;
    s.timer = secs > 0 ? { ends: now() + secs * 1000, total: secs } : null;
  }

  function closeTurn() {
    s.sel = -1;
    s.q = null;
    s.turn = null;
    s.tried = [false, false];
    s.armed = false;
    s.buzzer = null;
    s.timer = null;
    s.reveal = false;
  }

  function newRound(chooser) {
    const n = s.settings.size;
    const letters = shuffle(LETTERS.slice()).slice(0, n * n);
    s.round += 1;
    s.cells = letters.map((l) => ({ l, o: -1 }));
    s.chooser = chooser;
    s.phase = 'pick';
    closeTurn();
    s.path = [];
    s.roundWinner = null;
    s.last = null;
    fx('round');
  }

  function openQuestion(i, avoidId) {
    s.sel = i;
    s.q = drawQuestion(s.cells[i].l, avoidId);
    s.phase = 'question';
    s.turn = null;
    s.tried = [false, false];
    s.armed = true;
    s.buzzer = null;
    s.timer = null;
    s.reveal = false;
  }

  function checkWin(team) {
    const path = findPath(owners(), team, size());
    if (!path) return false;
    closeTurn();
    s.path = path;
    s.score[team] += 1;
    s.roundWinner = team;
    if (s.score[team] >= s.settings.roundsToWin) {
      s.matchWinner = team;
      s.phase = 'matchOver';
      fx('match', team);
    } else {
      s.phase = 'roundOver';
      fx('roundWon', team);
    }
    return true;
  }

  function giveTurn(team, how) {
    s.turn = team;
    s.armed = false;
    if (how === 'buzz') s.buzzer = team;
    s.phase = 'answer';
    startTimer();
    fx(how === 'buzz' ? 'buzz' : 'turn', team);
  }

  /** The answering side missed (wrong answer or clock ran out): the other side gets the turn. */
  function fail(team, why) {
    s.tried[team] = true;
    if (!s.tried[other(team)]) {
      s.turn = other(team);
      s.phase = 'answer';
      startTimer();
      fx(why === 'timeout' ? 'timeout' : 'wrong', team);
    } else {
      s.turn = null;
      s.timer = null;
      s.phase = 'missed';
      fx('missed', team);
    }
  }

  /**
   * Called by the server clock. When the answering side lets its time run out,
   * the question passes to the other side (or is missed if both have tried).
   * Returns true when the state changed.
   */
  function tick() {
    if (s.phase !== 'answer' || !s.timer || !isTeam(s.turn)) return false;
    if (now() < s.timer.ends) return false;
    snapshot();
    if (s.q) s.used[s.q.id] = true;
    s.timeouts = (s.timeouts || 0) + 1;
    fail(s.turn, 'timeout');
    return true;
  }

  const err = (message) => ({ ok: false, error: message });
  const ok = () => ({ ok: true });
  const isTeam = (t) => t === 0 || t === 1;

  /* ---------------- presenter actions ---------------- */
  const actions = {
    start() {
      if (s.phase !== 'lobby') return err('The match has already started');
      snapshot();
      s.score = [0, 0];
      s.round = 0;
      s.matchWinner = null;
      newRound(rand() < 0.5 ? 0 : 1);
      return ok();
    },

    nextRound() {
      if (s.phase !== 'roundOver') return err('The round is not over yet');
      snapshot();
      newRound(other(s.roundWinner)); // the side that lost the round starts the next one
      return ok();
    },

    pick({ i }) {
      const pickable = s.phase === 'pick' || s.phase === 'missed' ||
        (s.phase === 'question' && !s.tried[0] && !s.tried[1]);
      if (!pickable) return err('You cannot pick a letter now');
      if (!Number.isInteger(i) || i < 0 || i >= s.cells.length) return err('Unknown cell');
      if (s.cells[i].o !== -1) return err('This cell is already taken');
      snapshot();
      openQuestion(i);
      s.last = null;
      fx('pick');
      return ok();
    },

    unpick() {
      if (!['question', 'missed', 'answer'].includes(s.phase)) return err('No letter is selected');
      snapshot();
      closeTurn();
      s.phase = 'pick';
      return ok();
    },

    swap() {
      if (!['question', 'missed', 'answer'].includes(s.phase) || s.sel < 0) return err('No letter is selected');
      snapshot();
      if (s.q) s.used[s.q.id] = true;
      openQuestion(s.sel, s.q && s.q.id);
      fx('pick');
      return ok();
    },

    give({ team }) {
      if (!isTeam(team)) return err('Unknown team');
      if (s.phase !== 'question' && s.phase !== 'answer') return err('No open question');
      if (s.tried[team]) return err('This team already answered this question');
      if (s.phase === 'answer' && s.turn === team) return ok();
      snapshot();
      giveTurn(team, 'host');
      return ok();
    },

    judge({ correct }) {
      if (s.phase !== 'answer' || !isTeam(s.turn)) return err('No team is answering');
      snapshot();
      const team = s.turn;
      if (s.q) s.used[s.q.id] = true;
      if (correct === true) {
        s.cells[s.sel].o = team;
        s.last = { i: s.sel, l: s.cells[s.sel].l, team, a: s.q ? s.q.a : null };
        closeTurn();
        fx('claim', team);
        if (!checkWin(team)) {
          s.chooser = team;
          s.phase = 'pick';
        }
        return ok();
      }
      fail(team, 'wrong');
      return ok();
    },

    reveal({ on }) {
      if (!s.q) return err('No question');
      s.reveal = typeof on === 'boolean' ? on : !s.reveal;
      return ok();
    },

    timer({ cmd }) {
      if (s.phase !== 'answer') return err('No clock is running');
      if (cmd === 'stop') s.timer = null;
      else startTimer();
      return ok();
    },

    setOwner({ i, o }) {
      if (!['pick', 'missed', 'question'].includes(s.phase)) return err('Change cells while a letter is being picked');
      if (!Number.isInteger(i) || i < 0 || i >= s.cells.length) return err('Unknown cell');
      if (![-1, 0, 1].includes(o)) return err('Invalid value');
      snapshot();
      if (s.sel === i) closeTurn();
      if (s.phase !== 'pick' && s.sel === -1) s.phase = 'pick';
      s.cells[i].o = o;
      s.last = null;
      if (o !== -1) checkWin(o);
      return ok();
    },

    /** Match settings from the presenter (board size applies from the next round). */
    settings({ patch }) {
      if (!patch || typeof patch !== 'object') return err('Invalid settings');
      const allowed = {};
      for (const k of ['size', 'roundsToWin', 'answerTime', 'showQuestion', 'extraBank']) {
        if (k in patch) allowed[k] = patch[k];
      }
      s.settings = cleanHuroofSettings({ ...s.settings, ...allowed });
      return ok();
    },

    undo() {
      const snap = undo.pop();
      if (!snap) return err('Nothing to undo');
      for (const k of PLAY_KEYS) s[k] = snap[k];
      s.timer = null;
      fx('undo');
      return ok();
    },
  };

  function act(type, payload = {}) {
    const fn = Object.prototype.hasOwnProperty.call(actions, type) && actions[type];
    if (!fn) return err('Unknown command');
    return fn(payload || {});
  }

  /* ---------------- buzzer ---------------- */
  function buzz(team) {
    if (!isTeam(team)) return { ok: false, error: 'denied' };
    if (s.phase !== 'question' || !s.armed || s.tried[team]) return { ok: true, accepted: false };
    snapshot();
    giveTurn(team, 'buzz');
    return { ok: true, accepted: true };
  }

  /* ---------------- views ---------------- */
  function base() {
    return {
      settings: { size: s.settings.size, roundsToWin: s.settings.roundsToWin, answerTime: s.settings.answerTime, showQuestion: s.settings.showQuestion },
      phase: s.phase,
      round: s.round,
      score: s.score,
      cells: s.cells,
      chooser: s.chooser,
      sel: s.sel,
      turn: s.turn,
      tried: s.tried,
      armed: s.armed,
      buzzer: s.buzzer,
      timer: s.timer,
      reveal: s.reveal,
      path: s.path,
      roundWinner: s.roundWinner,
      matchWinner: s.matchWinner,
      last: s.last,
      fx: s.fx,
    };
  }

  /** role: 'presenter' (sees answers) | 'board' (big screen) | 'player' (side 0/1) */
  function view(role, side) {
    const v = base();
    if (role === 'presenter') {
      v.q = s.q;
      v.undo = undo.length;
      v.fullSettings = s.settings;
      v.bank = bankCounts;
      return v;
    }
    if (role === 'board') {
      v.q = s.q ? {
        q: s.settings.showQuestion || s.reveal ? s.q.q : null,
        a: s.reveal ? s.q.a : null,
      } : null;
      return v;
    }
    // a player: what the buzzer needs, plus the board to look at (no answers)
    v.q = null;
    v.letter = s.sel >= 0 && s.cells[s.sel] ? s.cells[s.sel].l : null;
    v.armed = s.armed && !s.tried[side];
    v.side = side;
    return v;
  }

  return {
    act,
    buzz,
    tick,
    view,
    serialize: () => clone(s),
    get state() { return s; },
  };
}
