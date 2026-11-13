// Global audio manager: every sound effect of the platform and the mini-games.
// Sounds are synthesised with the Web Audio API (no files, nothing to download).
// Browsers only allow sound after a tap: unlock() is called from the first tap
// (the full-screen prompt), which unlocks audio for the rest of the session.

const MUTE_KEY = 'ucp.muted';
const MASTER = 0.16;

// Notes: f frequency (Hz), to slide target, t start (s), d length (s), type, v volume (0-1)
const C4 = 261.63, G4 = 392, A4 = 440, C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99,
  A5 = 880, B5 = 987.77, C6 = 1046.5, E6 = 1318.51;

export const SOUNDS = {
  // interface
  click: [{ f: 700, d: 0.035, type: 'square', v: 0.3 }],
  tap: [{ f: 700, d: 0.035, type: 'square', v: 0.35 }],
  toggle: [{ f: 520, to: 780, d: 0.06, type: 'triangle', v: 0.5 }],
  error: [{ f: 220, d: 0.12, type: 'sawtooth', v: 0.35 }, { f: 180, t: 0.12, d: 0.16, type: 'sawtooth', v: 0.35 }],
  notify: [{ f: E5, d: 0.08, type: 'triangle', v: 0.6 }, { f: A5, t: 0.09, d: 0.16, type: 'triangle', v: 0.6 }],
  score: [{ f: G5, d: 0.06, type: 'triangle', v: 0.45 }, { f: C6, t: 0.06, d: 0.12, type: 'triangle', v: 0.45 }],

  // countdown
  tick: [{ f: 880, d: 0.09, type: 'square', v: 0.45 }],
  go: [
    { f: C5, d: 0.1, type: 'square', v: 0.45 },
    { f: E5, t: 0.1, d: 0.1, type: 'square', v: 0.45 },
    { f: G5, t: 0.2, d: 0.1, type: 'square', v: 0.45 },
    { f: C6, t: 0.3, d: 0.4, type: 'square', v: 0.5 },
  ],
  timeUp: [{ f: 1046, d: 0.12, type: 'square', v: 0.35 }, { f: 1046, t: 0.18, d: 0.12, type: 'square', v: 0.35 }, { f: 1046, t: 0.36, d: 0.12, type: 'square', v: 0.35 }],

  // challenges
  challenge: [
    { f: A4, d: 0.12, type: 'sawtooth', v: 0.35 },
    { f: D5, t: 0.12, d: 0.12, type: 'sawtooth', v: 0.35 },
    { f: A5, t: 0.24, d: 0.3, type: 'sawtooth', v: 0.4 },
  ],
  alarm: [
    { f: 880, d: 0.15, type: 'square', v: 0.4 }, { f: 660, t: 0.17, d: 0.15, type: 'square', v: 0.4 },
    { f: 880, t: 0.34, d: 0.15, type: 'square', v: 0.4 }, { f: 660, t: 0.51, d: 0.15, type: 'square', v: 0.4 },
  ],
  win: [
    { f: C5, t: 0.0, d: 0.12, type: 'triangle', v: 0.6 },
    { f: E5, t: 0.12, d: 0.12, type: 'triangle', v: 0.6 },
    { f: G5, t: 0.24, d: 0.12, type: 'triangle', v: 0.6 },
    { f: C6, t: 0.36, d: 0.5, type: 'triangle', v: 0.6 },
    { f: E6, t: 0.6, d: 0.6, type: 'triangle', v: 0.45 },
  ],
  lose: [{ f: 392, d: 0.25, type: 'triangle', v: 0.6 }, { f: 330, t: 0.25, d: 0.25, type: 'triangle', v: 0.6 }, { f: 262, t: 0.5, d: 0.5, type: 'triangle', v: 0.6 }],
  fanfare: [
    { f: G4, d: 0.1, type: 'square', v: 0.4 },
    { f: C5, t: 0.1, d: 0.1, type: 'square', v: 0.4 },
    { f: E5, t: 0.2, d: 0.1, type: 'square', v: 0.4 },
    { f: G5, t: 0.3, d: 0.18, type: 'square', v: 0.4 },
    { f: E5, t: 0.5, d: 0.1, type: 'square', v: 0.4 },
    { f: G5, t: 0.6, d: 0.5, type: 'square', v: 0.45 },
    { f: C4, t: 0.6, d: 0.5, type: 'triangle', v: 0.7 },
  ],

  // Huruf
  buzz0: [{ f: 392, d: 0.42, type: 'square', v: 0.55 }, { f: 588, d: 0.42, type: 'square', v: 0.25 }],
  buzz1: [{ f: 311, d: 0.42, type: 'square', v: 0.55 }, { f: 466, d: 0.42, type: 'square', v: 0.25 }],
  pick: [{ f: 880, d: 0.08, type: 'sine', v: 0.6 }, { f: 1320, t: 0.06, d: 0.1, type: 'sine', v: 0.5 }],
  correct: [{ f: C5, d: 0.32, type: 'triangle', v: 0.8 }, { f: E5, t: 0.09, d: 0.32, type: 'triangle', v: 0.8 }, { f: G5, t: 0.18, d: 0.32, type: 'triangle', v: 0.8 }],
  wrong: [{ f: 196, to: 136, d: 0.5, type: 'sawtooth', v: 0.5 }],
  round: [
    { f: C5, d: 0.5, type: 'triangle', v: 0.7 }, { f: E5, t: 0.13, d: 0.5, type: 'triangle', v: 0.7 },
    { f: G5, t: 0.26, d: 0.5, type: 'triangle', v: 0.7 }, { f: C6, t: 0.39, d: 0.5, type: 'triangle', v: 0.7 },
    { f: E6, t: 0.55, d: 0.9, type: 'triangle', v: 0.6 },
  ],

  // RoboPath
  place: [{ f: 760, to: 1000, d: 0.06, type: 'square', v: 0.45 }],
  erase: [{ f: 520, to: 300, d: 0.07, type: 'square', v: 0.4 }],
  clear: [{ f: 600, to: 150, d: 0.18, type: 'triangle', v: 0.8 }],
  level: [{ f: 300, to: 900, d: 0.14, type: 'triangle', v: 0.8 }],
  start: [{ f: C5, d: 0.07, type: 'square', v: 0.45 }, { f: G5, t: 0.07, d: 0.1, type: 'square', v: 0.45 }],
  pause: [{ f: G5, d: 0.07, type: 'square', v: 0.4 }, { f: C5, t: 0.07, d: 0.1, type: 'square', v: 0.4 }],
  stop: [{ f: 330, to: 220, d: 0.12, type: 'triangle', v: 0.7 }],
  step: [{ f: 220, d: 0.04, type: 'triangle', v: 0.6 }],
  turn: [{ f: 330, to: 400, d: 0.04, type: 'triangle', v: 0.5 }],
  star: [{ f: B5, d: 0.06, type: 'square', v: 0.45 }, { f: E6, t: 0.06, d: 0.16, type: 'square', v: 0.45 }],
  levelWin: [
    { f: C5, t: 0.18, d: 0.09, type: 'square', v: 0.4 }, { f: E5, t: 0.27, d: 0.09, type: 'square', v: 0.4 },
    { f: G5, t: 0.36, d: 0.09, type: 'square', v: 0.4 }, { f: C6, t: 0.45, d: 0.3, type: 'square', v: 0.45 },
  ],
  fall: [{ f: 620, to: 110, d: 0.45, type: 'square', v: 0.35 }],
  fail: [{ f: 330, d: 0.16, type: 'triangle', v: 0.8 }, { f: 247, t: 0.18, d: 0.28, type: 'triangle', v: 0.8 }],

  // Locked Phone
  key: [{ f: 1200, d: 0.025, type: 'sine', v: 0.35 }],
  unlock: [{ f: 660, d: 0.07, type: 'triangle', v: 0.6 }, { f: 990, t: 0.07, d: 0.07, type: 'triangle', v: 0.6 }, { f: 1320, t: 0.14, d: 0.18, type: 'triangle', v: 0.6 }],
  denied: [{ f: 160, d: 0.09, type: 'square', v: 0.5 }, { f: 160, t: 0.12, d: 0.14, type: 'square', v: 0.5 }],
  hint: [{ f: 600, to: 900, d: 0.18, type: 'sine', v: 0.6 }],
  lowBattery: [{ f: 440, d: 0.1, type: 'square', v: 0.35 }, { f: 330, t: 0.14, d: 0.16, type: 'square', v: 0.35 }],
  powerOff: [{ f: 500, to: 60, d: 0.9, type: 'sawtooth', v: 0.4 }],
  glitch: [{ f: 90, to: 1800, d: 0.25, type: 'sawtooth', v: 0.25 }, { f: 1800, to: 90, t: 0.3, d: 0.25, type: 'sawtooth', v: 0.25 }],
};

let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* ignore */
}
const listeners = new Set();

function context() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
  return ctx;
}

export const sfx = {
  unlock() {
    const c = context();
    if (!c) return;
    // a silent blip fully unlocks iOS audio
    try {
      const o = c.createOscillator();
      const g = c.createGain();
      g.gain.value = 0.0001;
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.01);
    } catch {
      /* ignore */
    }
  },

  play(name) {
    const notes = SOUNDS[name];
    if (muted || !notes) return;
    const c = context();
    if (!c) return;
    try {
      const now = c.currentTime + 0.01;
      for (const n of notes) {
        const start = now + (n.t || 0);
        const end = start + n.d;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = n.type || 'square';
        o.frequency.setValueAtTime(n.f, start);
        if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, end);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(MASTER * (n.v ?? 1), start + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        o.connect(g).connect(c.destination);
        o.start(start);
        o.stop(end + 0.03);
      }
    } catch {
      /* sound is a bonus */
    }
  },

  get muted() {
    return muted;
  },

  setMuted(value) {
    muted = !!value;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    listeners.forEach((fn) => fn(muted));
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
