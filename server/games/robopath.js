/*
 * RoboPath on the server: the player's device animates the ghost, but only the
 * server decides whether a program really solves a level (it runs the same
 * engine on a sanitized copy), and only the server awards points.
 */
import { levels } from '../../shared/robopath/levels.js';
import { parseLevel, runToEnd, sanitizeProgram } from '../../shared/robopath/engine.js';

// Points per level. They add up to 100 so that every mini-game weighs the same.
export const LEVEL_POINTS = [10, 12, 15, 18, 20, 25];
if (LEVEL_POINTS.length !== levels.length || LEVEL_POINTS.reduce((a, b) => a + b, 0) !== 100) {
  throw new Error('RoboPath: LEVEL_POINTS must have one entry per level and add up to 100');
}

const PARSED = levels.map((level) => parseLevel(level));

export function freshRoboState() {
  return {
    solved: levels.map(() => false),
    skipped: levels.map(() => false), // a skipped level gives no points but unlocks the next one
    programs: levels.map((level) => sanitizeProgram(level, null)),
    runs: 0,
  };
}

/** Rebuilds a saved state from untrusted/old data. */
export function cleanRoboState(raw) {
  const s = freshRoboState();
  if (!raw || typeof raw !== 'object') return s;
  levels.forEach((level, i) => {
    const prev = i === 0 || s.solved[i - 1] || s.skipped[i - 1];
    s.solved[i] = prev && Array.isArray(raw.solved) && raw.solved[i] === true;
    s.skipped[i] = prev && !s.solved[i] && Array.isArray(raw.skipped) && raw.skipped[i] === true;
    if (Array.isArray(raw.programs)) s.programs[i] = sanitizeProgram(level, raw.programs[i]);
  });
  s.runs = Number.isInteger(raw.runs) && raw.runs >= 0 ? raw.runs : 0;
  return s;
}

export function roboPoints(state) {
  return state.solved.reduce((sum, solved, i) => sum + (solved ? LEVEL_POINTS[i] : 0), 0);
}

export function isUnlocked(state, index) {
  return index === 0 || state.solved[index - 1] === true || state.skipped[index - 1] === true;
}

/** Saves a draft program. Returns { ok } or { ok:false, error }. */
export function saveProgram(state, index, program) {
  if (!Number.isInteger(index) || index < 0 || index >= levels.length) return { ok: false, error: 'Unknown level' };
  if (!isUnlocked(state, index)) return { ok: false, error: 'This level is still locked' };
  state.programs[index] = sanitizeProgram(levels[index], program);
  return { ok: true };
}

/**
 * Verifies a run. Returns { ok, status, solvedNow, points } where status is the
 * engine's final status (won | fell | ended | limit).
 */
export function verifyRun(state, index, program) {
  const saved = saveProgram(state, index, program);
  if (!saved.ok) return saved;
  state.runs += 1;
  const result = runToEnd(PARSED[index], state.programs[index]);
  let solvedNow = false;
  if (result.status === 'won' && !state.solved[index]) {
    state.solved[index] = true;
    state.skipped[index] = false; // a skipped level can still be solved later for its points
    solvedNow = true;
  }
  return { ok: true, status: result.status, solvedNow, levelPoints: solvedNow ? LEVEL_POINTS[index] : 0 };
}

/** Skips a level the team cannot solve: no points, the next level opens. */
export function skipLevel(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= levels.length) return { ok: false, error: 'Unknown level' };
  if (!isUnlocked(state, index)) return { ok: false, error: 'This level is still locked' };
  if (state.solved[index]) return { ok: false, error: 'This level is already solved' };
  if (state.skipped[index]) return { ok: false, error: 'This level was already skipped' };
  state.skipped[index] = true;
  return { ok: true };
}

export const allSolved = (state) => state.solved.every(Boolean);
/** Every level is solved or skipped: the game is over. */
export const allDone = (state) => state.solved.every((solved, i) => solved || state.skipped[i]);
export const LEVEL_COUNT = levels.length;
