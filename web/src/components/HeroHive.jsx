// The hero of the public page: a Huruf letter board where two teams claim
// cells until one of them links its two sides. It loops with new team colours.
import { useEffect, useMemo, useState } from 'react';
import { geometry, neighbors } from '@shared/huroof/hex.js';

const N = 5;
const R = 100;
const PAD = 40;
const LETTERS = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'];
const TEAMS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#F43F5E', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#D946EF'];
const STEP_MS = 520;
const HOLD_STEPS = 6;

const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const shuffle = (a) => {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/** A winding left-to-right path (side 0 links left and right). */
function makePath() {
  for (let tries = 0; tries < 200; tries++) {
    const start = Math.floor(Math.random() * N) * N;
    const path = [start];
    const seen = new Set(path);
    while (path.length < 9) {
      const cur = path[path.length - 1];
      if (cur % N === N - 1) return path;
      const options = shuffle(neighbors(cur, N).filter((x) => !seen.has(x)))
        .sort((a, b) => (b % N) - (a % N) + (Math.random() - 0.5) * 1.4);
      if (!options.length) break;
      path.push(options[0]);
      seen.add(options[0]);
    }
  }
  return [10, 11, 12, 13, 14];
}

function makeRound(round) {
  const path = makePath();
  const others = shuffle([...Array(N * N).keys()].filter((i) => !path.includes(i))).slice(0, Math.max(3, path.length - 1));
  // interleave: the winner and the rival take turns, the winner finishes
  const moves = [];
  for (let k = 0; k < path.length; k++) {
    moves.push({ i: path[k], o: 0 });
    if (others[k] !== undefined && k < path.length - 1) moves.push({ i: others[k], o: 1 });
  }
  const a = ((round * 5) % TEAMS.length + TEAMS.length) % TEAMS.length;
  const b = (a + 4 + (round % 3)) % TEAMS.length;
  return { letters: shuffle(LETTERS).slice(0, N * N), moves, path, colors: [TEAMS[a], TEAMS[b]] };
}

export default function HeroHive() {
  const geo = useMemo(() => geometry(N, R, PAD), []);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [round, setRound] = useState(() => makeRound(0));
  const [step, setStep] = useState(() => (reduce ? 999 : 0));

  useEffect(() => {
    if (reduce) return undefined;
    const id = setInterval(() => setStep((s) => s + 1), STEP_MS);
    return () => clearInterval(id);
  }, [reduce]);

  useEffect(() => {
    if (reduce || step <= round.moves.length + HOLD_STEPS) return;
    setRound((r) => makeRound(TEAMS.indexOf(r.colors[0]) + 1));
    setStep(0);
  }, [step, round, reduce]);

  const owner = new Map();
  round.moves.slice(0, step).forEach((m) => owner.set(m.i, m.o));
  const done = step >= round.moves.length;
  const last = step > 0 && step <= round.moves.length ? round.moves[step - 1].i : -1;
  const { tl, tr, bl, br } = geo.corners;

  return (
    <svg
      className={`hero-hive ${done ? 'won' : ''}`}
      viewBox={`0 0 ${geo.W.toFixed(0)} ${geo.H.toFixed(0)}`}
      style={{ '--h0': round.colors[0], '--h1': round.colors[1] }}
      role="img"
      aria-label="A Huruf letter board: two teams claim letters until one links its two sides"
    >
      <defs>
        <clipPath id="hero-frame"><rect width={geo.W} height={geo.H} rx="46" /></clipPath>
      </defs>
      <g clipPath="url(#hero-frame)">
        <polygon className="hh-band b1" points={pts(geo.bands.top)} />
        <polygon className="hh-band b1" points={pts(geo.bands.bottom)} />
        <polygon className="hh-band b0" points={pts(geo.bands.left)} />
        <polygon className="hh-band b0" points={pts(geo.bands.right)} />
        <path className="hh-seam" d={`M0 0L${pts([tl])}M${geo.W} 0L${pts([tr])}M0 ${geo.H}L${pts([bl])}M${geo.W} ${geo.H}L${pts([br])}`} />
      </g>
      {geo.cells.map((c, i) => {
        const o = owner.get(i);
        const onPath = done && round.path.includes(i);
        return (
          <g key={i} className={`hh-cell ${o === 0 ? 'o0' : o === 1 ? 'o1' : ''} ${i === last ? 'fresh' : ''} ${onPath ? 'path' : ''}`}>
            <polygon className="hh-tile" points={pts(geo.hexPoints(i))} />
            <polygon className="hh-flood" points={pts(geo.hexPoints(i, R - 4))} />
            <polygon className="hh-ring" points={pts(geo.hexPoints(i, R * 0.76))} />
            <text x={c.x.toFixed(1)} y={(c.y + 4).toFixed(1)} className="hh-glyph">{round.letters[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}
