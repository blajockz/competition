/*
 * N7 Quiz, the third mini-game of the gauntlet (after the Locked Phone).
 * Ported from n7-quiz-master (lib/config.js + lib/server/game.js) with the
 * same rules and the same scoring:
 *
 *   20 questions (gaming + security), 4 easy / 4 medium / 2 hard per category
 *   20 s per question, a correct answer earns MIN_SHARE..100 % of
 *   MAX_POINTS × difficulty multiplier (faster = more), wrong / no answer = 0.
 *   Maximum 280 points.
 *
 * The deck, the correct answers and the clock never leave the server. The
 * team only sees the current question with its options in a shuffled order,
 * and its score is revealed when the quiz is over.
 */
import crypto from 'node:crypto';
import { GAMING, SECURITY } from './quiz-questions.js';

export const MAX_POINTS = 10; // base points for an easy question
export const TIME_LIMIT = 20; // seconds per question
export const MIN_SHARE = 0.4; // a correct answer at the last second still earns 40 %
export const MULT = { 1: 1, 2: 1.5, 3: 2 }; // difficulty multiplier
export const MIX = { 1: 4, 2: 4, 3: 2 }; // questions drawn per category and difficulty
export const COUNTDOWN_MS = 3000; // 3-2-1 before question 1
export const GAP_MS = 700; // pause between questions
export const GRACE_MS = 1500; // network slack before a late answer counts as a timeout
export const N = 2 * (MIX[1] + MIX[2] + MIX[3]);
export const MAX_TOTAL = Math.round(MAX_POINTS * 2 * (MIX[1] * MULT[1] + MIX[2] * MULT[2] + MIX[3] * MULT[3]) * 10) / 10;

const BANKS = { g: GAMING, s: SECURITY };
const round1 = (n) => Math.round(n * 10) / 10;

export function calcScore(correct, secondsLeft, mult = 1) {
  if (!correct) return 0;
  const ratio = Math.min(Math.max(secondsLeft / TIME_LIMIT, 0), 1);
  const share = MIN_SHARE + (1 - MIN_SHARE) * ratio;
  return Math.round(MAX_POINTS * mult * share * 10) / 10;
}

function shuffle(a, randInt) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Same difficulty mix for every team (fair), random questions and answer order (no copying). */
export function buildDeck(randInt = crypto.randomInt) {
  const deck = [];
  for (const [c, bank] of Object.entries(BANKS)) {
    for (const d of [1, 2, 3]) {
      const pool = shuffle(bank.map((q, i) => ({ q, i })).filter((x) => x.q.d === d), randInt).slice(0, MIX[d]);
      for (const { q, i } of pool) deck.push({ c, i, d, order: shuffle(q.o.map((_, k) => k), randInt) });
    }
  }
  return shuffle(deck, randInt);
}

const lookup = (item) => BANKS[item.c]?.[item.i] || null;
const maxOf = (deck) => round1(deck.reduce((t, it) => t + MAX_POINTS * MULT[it.d], 0));

export function freshQuizState() {
  return { deck: null, idx: 0, qStart: null, answers: [], score: 0, switches: 0, startedAt: null, finishedAt: null };
}

/** Validates a saved state (from the database) and drops anything malformed. */
export function cleanQuizState(raw) {
  const s = freshQuizState();
  if (!raw || typeof raw !== 'object') return s;
  if (Array.isArray(raw.deck) && raw.deck.length && raw.deck.every((it) => it && BANKS[it.c] && lookup(it) && Array.isArray(it.order))) {
    s.deck = raw.deck.map((it) => ({ c: it.c, i: it.i, d: lookup(it).d, order: it.order.slice(0, 8) }));
  }
  if (s.deck) {
    s.idx = Number.isInteger(raw.idx) ? Math.max(0, Math.min(raw.idx, s.deck.length)) : 0;
    s.qStart = Number.isFinite(raw.qStart) ? raw.qStart : null;
    s.answers = Array.isArray(raw.answers) ? raw.answers.filter((a) => a && Number.isInteger(a.idx)).slice(0, s.deck.length) : [];
    s.score = round1(s.answers.reduce((t, a) => t + (Number(a.points) || 0), 0));
    s.startedAt = Number.isFinite(raw.startedAt) ? raw.startedAt : null;
    s.finishedAt = Number.isFinite(raw.finishedAt) ? raw.finishedAt : null;
  }
  s.switches = Number.isInteger(raw.switches) ? Math.max(0, Math.min(raw.switches, 999)) : 0;
  return s;
}

export const isDone = (s) => !!s.deck && s.idx >= s.deck.length;

export function startQuiz(s, now, randInt) {
  if (s.deck) return { ok: false, error: 'The quiz has already started' };
  s.deck = buildDeck(randInt);
  s.idx = 0;
  s.qStart = now + COUNTDOWN_MS;
  s.answers = [];
  s.score = 0;
  s.startedAt = now;
  s.finishedAt = null;
  return { ok: true };
}

function record(s, originalChoice, answeredAt) {
  const item = s.deck[s.idx];
  const remaining = Math.max(0, TIME_LIMIT - (answeredAt - s.qStart) / 1000);
  const correct = originalChoice !== null && originalChoice === lookup(item).a;
  const points = correct ? calcScore(true, remaining, MULT[item.d]) : 0;
  s.answers.push({ idx: s.idx, choice: originalChoice, points, at: answeredAt });
  s.score = round1(s.score + points);
  s.idx += 1;
  if (s.idx >= s.deck.length) s.finishedAt = answeredAt;
  else s.qStart = answeredAt + GAP_MS;
}

/** Questions left unanswered past their time count as timeouts, even if the team left. */
export function settle(s, now) {
  let changed = false;
  while (s.deck && !isDone(s) && now > s.qStart + TIME_LIMIT * 1000 + GRACE_MS) {
    record(s, null, s.qStart + TIME_LIMIT * 1000);
    changed = true;
  }
  return changed;
}

/** choice = index of the option as shown, or null to skip the question. */
export function answer(s, { qid, choice, tabSwitches }, now) {
  if (!s.deck) return { ok: false, error: 'The quiz has not started' };
  const sw = Number(tabSwitches);
  if (Number.isFinite(sw)) s.switches = Math.max(s.switches, Math.min(Math.floor(sw), 999));
  settle(s, now);
  if (isDone(s)) return { ok: true, done: true, stale: true };
  if (qid !== s.idx) return { ok: true, stale: true }; // an old question: the client just resyncs
  if (now < s.qStart) return { ok: false, error: 'Wait for the question' };
  let original = null;
  if (choice !== null && choice !== undefined) {
    const order = s.deck[s.idx].order;
    if (!Number.isInteger(choice) || choice < 0 || choice >= order.length) return { ok: false, error: 'Invalid answer' };
    original = order[choice];
  }
  record(s, original, Math.min(now, s.qStart + TIME_LIMIT * 1000));
  return { ok: true, done: isDone(s) };
}

/** Freezes the quiz (challenge phase starting): the questions not reached earn nothing. */
export function closeQuiz(s, now) {
  if (!s.deck || isDone(s)) return;
  settle(s, now);
  if (!isDone(s)) s.finishedAt = now;
}

export const quizMax = (s) => (s.deck ? maxOf(s.deck) : MAX_TOTAL);

/** What the team sees. The score stays hidden until the quiz is over. */
export function quizView(s, status) {
  const base = {
    rules: { n: N, timeLimit: TIME_LIMIT, maxPoints: MAX_POINTS, mult: MULT, maxTotal: MAX_TOTAL, countdownMs: COUNTDOWN_MS },
    total: s.deck ? s.deck.length : N,
    answered: s.answers.length,
    switches: s.switches,
  };
  const over = ['completed', 'abandoned'].includes(status) || isDone(s) || !!s.finishedAt;
  if (!s.deck) return { ...base, phase: 'intro' };
  if (over) return { ...base, phase: 'done', score: s.score, max: quizMax(s) };
  const item = s.deck[s.idx];
  const q = lookup(item);
  return {
    ...base,
    phase: 'play',
    idx: s.idx,
    q: { id: s.idx, d: item.d, text: q.q, options: item.order.map((k) => q.o[k]), qStart: s.qStart },
  };
}

/** Short progress line for the admin / host (no answers). */
export function quizProgress(s) {
  return { answered: s.answers.length, total: s.deck ? s.deck.length : N, switches: s.switches };
}
