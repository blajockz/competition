export const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** 125 → "02:05", 3725 → "1:02:05" */
export function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? `${h}:${pad2(m)}` : pad2(m)) + ':' + pad2(s % 60);
}

export function ordinal(n) {
  if (!Number.isFinite(n)) return '';
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

export const yearLabel = (y) => ({ 1: '1st Year', 2: '2nd Year', 3: '3rd Year' }[y] || '—');

export const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** Picks black or white text for a background colour. */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#160E24' : '#ffffff';
}

export const STATUS_LABEL = {
  REGISTRATION: 'Registration',
  LOBBY_LOCKED: 'Lobby',
  COUNTDOWN: 'Countdown',
  MAIN_GAMES: 'Mini-games',
  CHALLENGE_WINDOW: 'Challenge phase',
  FINISHED: 'Finished',
};
