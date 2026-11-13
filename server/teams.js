/*
 * Balanced team generation.
 *
 *  1. Team count  T = ceil(N / 4), at least 2 when N >= 2.
 *  2. Sizes are as even as possible (they differ by at most 1, 1..4 members):
 *       N=6 → 3+3   N=5 → 3+2   N=2 → 1+1   N=10 → 4+3+3
 *  3. Seniority seeding: 3rd-year, then 2nd-year students (each group shuffled)
 *     are dealt round-robin across the teams first, so every team gets a senior
 *     whenever there are enough; then 1st-year students fill the remaining slots.
 *  4. Each team gets a unique "Adjective Noun" name (12 × 12 = 144 pairs),
 *     a distinct colour and a unique 4-character join code.
 */
import crypto from 'node:crypto';

export const MIN_MEMBERS = 1;
export const MAX_MEMBERS = 4;

export const LIST_A = ['Cyber', 'Quantum', 'Turbo', 'Apex', 'Neon', 'Solar', 'Hyper', 'Alpha', 'Shadow', 'Atomic', 'Vortex', 'Iron'];
export const LIST_B = ['Falcons', 'Titans', 'Wolves', 'Phoenix', 'Knights', 'Vipers', 'Mavericks', 'Ravens', 'Spartans', 'Dragons', 'Phantoms', 'Pioneers'];

export const PALETTE = [
  { name: 'Crimson', hex: '#EF4444' },
  { name: 'Electric Blue', hex: '#3B82F6' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Cyan', hex: '#06B6D4' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Lime', hex: '#84CC16' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Fuchsia', hex: '#D946EF' },
  // extra colours, only used beyond 12 teams
  { name: 'Sky', hex: '#0EA5E9' },
  { name: 'Yellow', hex: '#EAB308' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Green', hex: '#22C55E' },
  { name: 'Purple', hex: '#A855F7' },
  { name: 'Red Orange', hex: '#FB5607' },
  { name: 'Mint', hex: '#2DD4BF' },
  { name: 'Gold', hex: '#D4A017' },
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/** Uniform random integer in [0, n) from crypto. */
export function randInt(n) {
  return crypto.randomInt(n);
}

export function shuffle(list, rnd = randInt) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** How many teams, and how many members each, for N participants. */
export function planTeams(n) {
  if (!Number.isInteger(n) || n <= 0) return [];
  let t = Math.ceil(n / MAX_MEMBERS);
  if (n >= 2) t = Math.max(2, t);
  const base = Math.floor(n / t);
  const extra = n % t;
  return Array.from({ length: t }, (_, i) => base + (i < extra ? 1 : 0));
}

export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function teamColor(i) {
  if (i < PALETTE.length) return PALETTE[i].hex;
  return hslToHex((i * 137.508) % 360, 75, 52); // golden-angle hues beyond the palette
}

export function makeJoinCode(taken, rnd = randInt) {
  for (let tries = 0; tries < 10000; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[rnd(CODE_ALPHABET.length)];
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  throw new Error('Could not create a unique join code');
}

/** Unique "Adjective Noun" names, without repeating a pair. */
export function makeNames(count, rnd = randInt) {
  const pairs = [];
  for (const a of LIST_A) for (const b of LIST_B) pairs.push(`${a} ${b}`);
  if (count > pairs.length) throw new Error(`At most ${pairs.length} teams are supported`);
  // prefer names that also don't repeat a word, while that is possible
  const picked = [];
  const usedA = new Set();
  const usedB = new Set();
  for (const name of shuffle(pairs, rnd)) {
    if (picked.length === count) break;
    const [a, b] = name.split(' ');
    if (count <= 12 && (usedA.has(a) || usedB.has(b))) continue;
    picked.push(name);
    usedA.add(a);
    usedB.add(b);
  }
  if (picked.length < count) {
    for (const name of shuffle(pairs, rnd)) {
      if (picked.length === count) break;
      if (!picked.includes(name)) picked.push(name);
    }
  }
  return picked;
}

/**
 * Splits participants into teams.
 * @param participants [{ id, year }]
 * @returns [{ index, memberIds: [] }]
 */
export function distribute(participants, rnd = randInt) {
  const sizes = planTeams(participants.length);
  const teams = sizes.map((size, index) => ({ index, size, memberIds: [] }));
  if (!teams.length) return [];

  // Deal round-robin, starting from a random team, skipping full teams.
  let cursor = rnd(teams.length);
  const deal = (id) => {
    for (let k = 0; k < teams.length; k++) {
      const team = teams[(cursor + k) % teams.length];
      if (team.memberIds.length < team.size) {
        team.memberIds.push(id);
        cursor = (team.index + 1) % teams.length;
        return;
      }
    }
    throw new Error('No free slot left');
  };

  // Seniors first, but only up to one round per team before the others
  // so seniors stay spread out (3rd years first, then 2nd years).
  const third = shuffle(participants.filter((p) => p.year === 3), rnd);
  const second = shuffle(participants.filter((p) => p.year === 2), rnd);
  const first = shuffle(participants.filter((p) => p.year !== 2 && p.year !== 3), rnd);

  for (const p of [...third, ...second]) deal(p.id);
  for (const p of first) deal(p.id);
  return teams.map(({ index, memberIds }) => ({ index, memberIds }));
}

/** Parses "1", "1st", "1ère", "L1", "3rd Year", "2A"… into 1, 2 or 3 (null if unknown). */
export function parseYear(v) {
  if (typeof v === 'number') return [1, 2, 3].includes(v) ? v : null;
  const m = String(v ?? '').match(/[123]/);
  return m ? Number(m[0]) : null;
}

/**
 * Parses pasted CSV/TSV lines: "Full Name, Filière, Year".
 * A header line is skipped. Returns { rows: [{fullName, filiere, year}], errors: [] }.
 */
export function parseParticipantsText(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cells = line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
    if (i === 0 && /name|nom/i.test(cells[0]) && cells.length > 1 && !parseYear(cells[cells.length - 1])) return;
    const fullName = cells[0] || '';
    const year = parseYear(cells[cells.length - 1]);
    const filiere = cells.length >= 3 ? cells.slice(1, -1).join(' ') : '';
    if (!fullName || fullName.length > 80) errors.push(`Line ${i + 1}: missing or too long name`);
    else if (!year) errors.push(`Line ${i + 1}: academic year must be 1, 2 or 3`);
    else rows.push({ fullName, filiere: filiere.slice(0, 80), year });
  });
  return { rows, errors };
}
