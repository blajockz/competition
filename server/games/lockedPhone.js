/*
 * The Locked Phone on the server. The phone UI (apps, chats, photos…) runs in
 * the player's browser, but the answers, the hints, the battery and the score
 * live here, so nothing can be read or changed from the browser's dev tools.
 *
 * Locks:
 *   0 phone passcode   = tomorrow's date as DDMM (the owner's birthday is "tomorrow")
 *   1 locked note      = name of the first café + year      → atlas2019
 *   2 calculator vault = new locker number × new final day  → 38 × 15 = 570
 *   3 Maps pin         = first word of the first song + gate → lionheart + c
 *
 * Normalised score (0–100, same weight as every mini-game):
 *   20 points per lock opened (80 max) + battery bonus when the last lock opens
 *   (battery % / 5, 20 max). A dead phone keeps the points of the locks it opened.
 *   A team that is stuck may SKIP the current lock: it opens, but gives no points
 *   (and skipping the last lock gives no battery bonus).
 */

export const LOCK_POINTS = 20;
export const MAX_HINTS = 2;
export const WRONG_COST = 5; // battery % per wrong answer
export const HINT_COST = 10; // battery % per hint

export const LOCK_NAMES = ['Code dyal telephone', 'Note msdouda', 'Coffre dyal Calculatrice', 'Blassa msdouda f Maps'];

export const HINTS = [
  ['Chouf la notification dyal Calendrier f lock screen. O chouf tarikh dyal lyoum lfo9.',
    'Lcode howa tarikh dyal ghedda: nhar b jouj ar9am + chhar b jouj ar9am. Matalan ila kan ghedda 5 Mars → 0503.'],
  ['F Notes kayna note msdouda. Yassir sowel 3la nefs lmot de passe f Messages.',
    'F Photos, 7el tswira w dghet 3la Info: katban tarikh, lblassa w chkoun fiha. Khassek a9dem tswira f café fiha Yassir.'],
  ['La note li t7lat katchra7 kifach t7el lcoffre dyal Calculatrice. Khassek ra9m mn Mail w ra9m 3la lfinal.',
    '9ra kol les emails, mn ljdid l l9dim. Lcasier tbdel, w 7ta nhar dyal lfinal tbdel. Dreb ra9m lcasier ljdid f nhar ljdid, w dghet =.'],
  ['9ra lmessage li f lcoffre. Khassek ghenya w 7arf dyal bab.',
    'Musique → playlist "9bel lmatch": lghenya lwla. Wallet → ticket dyal lfinal: lbab. Ktebhom m3a ba3d, bla espaces, f lblassa lmsdouda f Maps.'],
];

// Revealed to the phone only once the lock before them is open
const SECRET_NOTE = 'Ila kunti kat9ra hadchi, rak 9rib.\n\nKolchi kayn f Calculatrice. Machi ghir calculatrice. Rah coffre.\n\nBach t7elo, 7seb:\nra9m dyal lcasier dyali × nhar dyal lfinal dyal tournoi\nmn ba3d dghet 3la =\n\nRedd balek: chi m3lomat dyali 9dima. Dima chouf lkhra.\n\n— R.';
const MEMO = 'Salam. Ila kunti kat9ra hadchi, rak dki. Ana machi mfe9oud. Ana mkhebbi f chi blassa f lkickoff. Blasti m9ayda f Maps, walakin sddit 3liha. Sarout howa lkelma lwla mn lghenya li dima kanchghel 9bel lmatch, w mn ba3dha 7arf dyal lbab (gate) f ticket dyal lfinal. Bla espaces. Zreb, batterie dyali ghadi tsala.';

/** Lowercase, no accents, letters and digits only (same rules as the original game). */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 64);
}

/** {year, month (1-12), day, weekday (0=Sunday)} of a moment in the event's time zone. */
export function dateParts(ms, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  });
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { year: +parts.year, month: +parts.month, day: +parts.day, weekday };
}

/** The passcode: tomorrow (in the event's time zone) as DDMM. */
export function birthdayCode(ms, timeZone) {
  const { year, month, day } = dateParts(ms, timeZone);
  const t = new Date(Date.UTC(year, month - 1, day + 1));
  return String(t.getUTCDate()).padStart(2, '0') + String(t.getUTCMonth() + 1).padStart(2, '0');
}

export function freshLockedState() {
  return {
    stage: 0, // locks passed (0..4)
    skipped: [false, false, false, false], // locks passed with "skip" (no points)
    wrong: 0,
    hints: 0,
    hintStep: [0, 0, 0, 0],
    hintLog: [],
    startedAt: 0,
    endedAt: 0,
    endReason: null, // found | finished (last lock skipped) | dead | gave_up | closed
    drainMin: 60,
  };
}

export function cleanLockedState(raw) {
  const s = freshLockedState();
  if (!raw || typeof raw !== 'object') return s;
  const int = (v, min, max, d) => (Number.isInteger(v) && v >= min && v <= max ? v : d);
  s.stage = int(raw.stage, 0, 4, 0);
  s.skipped = [0, 1, 2, 3].map((i) => i < s.stage && raw.skipped?.[i] === true);
  s.wrong = int(raw.wrong, 0, 9999, 0);
  s.hints = int(raw.hints, 0, MAX_HINTS, 0);
  s.hintStep = [0, 1, 2, 3].map((i) => int(raw.hintStep?.[i], 0, 2, 0));
  s.hintLog = Array.isArray(raw.hintLog)
    ? raw.hintLog.filter((h) => h && Number.isInteger(h.stage) && typeof h.text === 'string').slice(0, MAX_HINTS)
    : [];
  s.startedAt = Number.isFinite(raw.startedAt) ? raw.startedAt : 0;
  s.endedAt = Number.isFinite(raw.endedAt) ? raw.endedAt : 0;
  s.endReason = ['found', 'finished', 'dead', 'gave_up', 'closed'].includes(raw.endReason) ? raw.endReason : null;
  s.drainMin = int(raw.drainMin, 20, 240, 60);
  return s;
}

export const isPlaying = (s) => s.startedAt > 0 && !s.endedAt;

export function elapsedSec(s, now) {
  if (!s.startedAt) return 0;
  return Math.max(0, ((s.endedAt || now) - s.startedAt) / 1000);
}

/** Seconds for 1% of battery to drain on its own. */
export const drainPer = (s) => Math.max(6, (s.drainMin * 60) / 100);

export function battery(s, now) {
  if (s.endReason === 'dead') return 0;
  const b = 100 - Math.floor(elapsedSec(s, now) / drainPer(s)) - s.wrong * WRONG_COST - s.hints * HINT_COST;
  return Math.max(0, Math.min(100, b));
}

export function lockedPoints(s, now) {
  let opened = 0;
  for (let i = 0; i < Math.min(4, s.stage); i++) if (!s.skipped[i]) opened += 1;
  const locks = opened * LOCK_POINTS;
  const bonus = s.endReason === 'found' ? Math.round(battery(s, now) / 5) : 0;
  return Math.max(0, Math.min(100, locks + bonus));
}

export function start(s, now, drainMin) {
  if (s.startedAt) return { ok: false, error: 'Already started' };
  s.startedAt = now;
  s.drainMin = Math.min(240, Math.max(20, drainMin | 0 || 60));
  return { ok: true };
}

function end(s, now, reason) {
  if (s.endedAt) return;
  s.endedAt = now;
  s.endReason = reason;
}

/** Ends the game if the battery is empty. Returns true when it just died. */
export function checkDead(s, now) {
  if (isPlaying(s) && battery(s, now) <= 0) {
    end(s, now, 'dead');
    return true;
  }
  return false;
}

/**
 * Checks an answer for the current lock.
 * Returns { ok, correct, stage, died, found } or { ok:false, error }.
 */
export function attempt(s, lock, rawAnswer, now, timeZone) {
  if (!isPlaying(s)) return { ok: false, error: 'The phone is off' };
  if (checkDead(s, now)) return { ok: true, correct: false, died: true, stage: s.stage };
  if (lock !== s.stage) return { ok: false, error: 'This lock is not the current one' };
  const answer = norm(rawAnswer);
  if (!answer) return { ok: false, error: 'Empty answer' };

  let correct = false;
  if (lock === 0) {
    correct = /^\d{4}$/.test(answer) &&
      (answer === birthdayCode(now, timeZone) || answer === birthdayCode(s.startedAt, timeZone));
  } else if (lock === 1) {
    correct = answer === 'atlas2019' || answer === 'cafeatlas2019';
  } else if (lock === 2) {
    correct = answer === '570';
  } else if (lock === 3) {
    correct = answer === 'lionheartc' || answer === 'lionheartgatec';
  }

  if (correct) {
    s.stage += 1;
    if (s.stage >= 4) end(s, now, 'found');
    return { ok: true, correct: true, stage: s.stage, found: s.stage >= 4 };
  }
  // The vault is the calculator: every "=" is checked, so a wrong result there
  // costs nothing (as in the original game). Other locks cost battery.
  if (lock === 2) return { ok: true, correct: false, stage: s.stage, free: true };
  s.wrong += 1;
  const died = checkDead(s, now);
  return { ok: true, correct: false, stage: s.stage, died };
}

/** Skips the current lock: it opens without points. Skipping the last lock ends the game. */
export function skipLock(s, now) {
  if (!isPlaying(s)) return { ok: false, error: 'The phone is off' };
  if (checkDead(s, now)) return { ok: true, died: true, stage: s.stage };
  if (s.stage > 3) return { ok: false, error: 'No lock left' };
  s.skipped[s.stage] = true;
  s.stage += 1;
  if (s.stage >= 4) end(s, now, 'finished');
  return { ok: true, stage: s.stage, finished: s.stage >= 4 };
}

/** Takes the next hint for the current lock. */
export function takeHint(s, now) {
  if (!isPlaying(s)) return { ok: false, error: 'The phone is off' };
  if (s.stage > 3) return { ok: false, error: 'No lock left' };
  if (s.hints >= MAX_HINTS) return { ok: false, error: 'Kheddemtou les 2 tlmi7at dyal lo3ba kamla' };
  const i = s.hintStep[s.stage];
  if (i >= HINTS[s.stage].length) return { ok: false, error: 'Mab9awch tlmi7at l had l9fel' };
  s.hintStep[s.stage] = i + 1;
  s.hints += 1;
  s.hintLog.push({ stage: s.stage, text: HINTS[s.stage][i] });
  const died = checkDead(s, now);
  return { ok: true, died };
}

export function giveUp(s, now) {
  if (!s.startedAt) s.startedAt = now;
  end(s, now, 'gave_up');
}

export function closeGame(s, now) {
  if (!s.startedAt) s.startedAt = now;
  end(s, now, 'closed');
}

/** What the phone may know: progress, plus the texts unlocked so far. */
export function lockedView(s, now, timeZone, flag) {
  const today = dateParts(now, timeZone);
  return {
    stage: s.stage,
    skipped: s.skipped,
    lockPoints: LOCK_POINTS,
    wrong: s.wrong,
    hints: s.hints,
    maxHints: MAX_HINTS,
    hintsLeftForLock: s.stage > 3 ? 0 : Math.max(0, Math.min(MAX_HINTS - s.hints, HINTS[s.stage].length - s.hintStep[s.stage])),
    hintLog: s.hintLog,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    endReason: s.endReason,
    drainMin: s.drainMin,
    drainPerSec: drainPer(s),
    battery: battery(s, now),
    elapsed: Math.floor(elapsedSec(s, now)),
    today, // date shown on the lock screen, from the server clock
    lockNames: LOCK_NAMES,
    secretNote: s.stage >= 2 ? SECRET_NOTE : null,
    memo: s.stage >= 3 ? MEMO : null,
    flag: s.endReason === 'found' ? flag : null,
  };
}
