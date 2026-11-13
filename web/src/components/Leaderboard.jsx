// Live leaderboard: rows slide to their new place when the ranking changes,
// and a +/− badge pops when a team's score moves.
import { useEffect, useRef, useState } from 'react';
import { inkOn } from '../lib/format.js';

export default function Leaderboard({ leaderboard, teams, rowHeight = 64, gap = 8, detail, highlight, compact = false }) {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const prevScores = useRef(null);
  const [deltas, setDeltas] = useState({}); // teamId -> { value, key }

  useEffect(() => {
    const now = Object.fromEntries(leaderboard.map((r) => [r.id, r.score]));
    if (prevScores.current) {
      const changed = {};
      for (const [id, score] of Object.entries(now)) {
        const before = prevScores.current[id];
        if (before !== undefined && before !== score) changed[id] = { value: score - before, key: `${id}-${Date.now()}` };
      }
      if (Object.keys(changed).length) {
        setDeltas((d) => ({ ...d, ...changed }));
        const ids = Object.keys(changed);
        setTimeout(() => setDeltas((d) => {
          const copy = { ...d };
          ids.forEach((id) => { if (copy[id] && copy[id].key === changed[id].key) delete copy[id]; });
          return copy;
        }), 2000);
      }
    }
    prevScores.current = now;
  }, [leaderboard]);

  // stable DOM order (by team id) so CSS transitions animate the moves
  const order = [...leaderboard].sort((a, b) => (a.id < b.id ? -1 : 1));
  const rankOf = Object.fromEntries(leaderboard.map((r, i) => [r.id, i]));

  return (
    <div className={`lb ${compact ? 'compact' : ''}`} style={{ height: leaderboard.length * (rowHeight + gap) - gap }} role="list">
      {order.map((r) => {
        const t = byId[r.id];
        if (!t) return null;
        const i = rankOf[r.id];
        const d = deltas[r.id];
        return (
          <div
            key={r.id}
            role="listitem"
            className={`lb-row r${r.rank} ${d ? 'bump' : ''} ${highlight === r.id ? 'me' : ''}`}
            style={{ '--team': t.colorHex, position: 'absolute', left: 0, right: 0, top: 0, height: rowHeight, transform: `translateY(${i * (rowHeight + gap)}px)` }}
            aria-label={`Rank ${r.rank}: ${t.name}, ${r.score} points`}
          >
            <span className="lb-rank">{r.rank}</span>
            <div style={{ minWidth: 0 }}>
              <div className="lb-name">
                {t.name}
                {highlight === r.id && <span className="pill accent" style={{ marginLeft: 8, verticalAlign: 'middle' }}>You</span>}
              </div>
              {detail && <div className="lb-sub">{detail(t)}</div>}
            </div>
            <span className="lb-score" style={{ color: inkOn(t.colorHex) === '#ffffff' ? 'var(--text)' : t.colorHex }}>{r.score}</span>
            {d && <span key={d.key} className={`lb-delta ${d.value < 0 ? 'neg' : ''}`}>{d.value > 0 ? `+${d.value}` : d.value}</span>}
          </div>
        );
      })}
    </div>
  );
}
