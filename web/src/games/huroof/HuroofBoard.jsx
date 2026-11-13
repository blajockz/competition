// The Huruf hex board (ported from huroof-challenge). Used on the big screen,
// on the admin's presenter panel (clickable) and on the two teams' devices.
// Side 0 (the challenger) links left ↔ right, side 1 (the defender) top ↕ bottom.
import { memo, useId, useMemo, useRef } from 'react';
import { geometry } from '@shared/huroof/hex.js';
import './huroof.css';

const R = 100;
const PAD = 50;
const pts = (list) => list.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');

function HuroofBoard({ board, colors, names = ['', ''], onCell, className = '' }) {
  const waitingText = board?.phase === 'lobby' ? `${names[0] || ''} vs ${names[1] || ''}` : '';
  const clipId = 'hf' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const cells = board?.cells || [];
  const n = Math.round(Math.sqrt(cells.length));
  const geo = useMemo(() => (n ? geometry(n, R, PAD) : null), [n]);

  // remember owners to animate newly claimed cells only
  const prev = useRef({ round: null, owners: [] });
  const freshRound = prev.current.round !== board?.round;
  const claimedNow = cells.map((c, i) => c.o !== -1 && !freshRound && prev.current.owners[i] === -1);
  const claimedRef = useRef(new Set());
  if (freshRound) claimedRef.current = new Set();
  claimedNow.forEach((v, i) => v && claimedRef.current.add(i));
  prev.current = { round: board?.round, owners: cells.map((c) => c.o) };

  if (!geo) {
    return (
      <div className={`hive-empty ${className}`} style={{ '--t0': colors[0], '--t1': colors[1] }}>
        <span className="hive-vs">{waitingText}</span>
        <small>The board appears when the presenter starts the match</small>
      </div>
    );
  }
  const path = board.path || [];
  const { tl, tr, bl, br } = geo.corners;
  const interactive = typeof onCell === 'function';

  return (
    <svg
      className={`hive ${interactive ? 'interactive' : ''} ${className}`}
      viewBox={`0 0 ${geo.W.toFixed(1)} ${geo.H.toFixed(1)}`}
      style={{ '--t0': colors[0], '--t1': colors[1] }}
      role={interactive ? 'group' : 'img'}
      aria-label="Huruf board"
      dir="ltr"
    >
      <defs>
        <clipPath id={clipId}><rect width={geo.W.toFixed(1)} height={geo.H.toFixed(1)} rx="34" /></clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {[['top', 'b1'], ['bottom', 'b1'], ['left', 'b0'], ['right', 'b0']].map(([side, cls]) => (
          <polygon key={side} className={`band ${cls}`} points={pts(geo.bands[side])} />
        ))}
        <path className="seam" d={`M0 0L${pts([tl])}M${geo.W} 0L${pts([tr])}M0 ${geo.H}L${pts([bl])}M${geo.W} ${geo.H}L${pts([br])}`} />
      </g>
      {geo.cells.map((c, i) => {
        const cell = cells[i];
        const k = path.indexOf(i);
        const cls = ['cell'];
        if (cell.o === 0) cls.push('o0', 'owned');
        else if (cell.o === 1) cls.push('o1', 'owned');
        else cls.push('free');
        if (cell.o !== -1 && claimedRef.current.has(i)) cls.push('claimed');
        if (i === board.sel) cls.push('sel');
        if (k >= 0) cls.push('path');
        const label = cell.l + (cell.o === 0 ? ` · ${names[0]}` : cell.o === 1 ? ` · ${names[1]}` : '');
        return (
          <g
            key={i}
            className={cls.join(' ')}
            style={k >= 0 ? { '--k': k } : undefined}
            {...(interactive
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': label,
                  onClick: () => onCell(i),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onCell(i);
                    }
                  },
                }
              : {})}
          >
            <polygon className="tile" points={pts(geo.hexPoints(i))} strokeWidth="5" />
            <polygon className="flood" points={pts(geo.hexPoints(i, R - 2.5))} />
            <polygon className="ring" points={pts(geo.hexPoints(i, R * 0.78))} style={{ '--ring-w': '7px' }} />
            <text className="glyph" x={c.x.toFixed(1)} y={(c.y + R * 0.04).toFixed(1)} fontSize={(R * 0.9).toFixed(0)}>{cell.l}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default memo(HuroofBoard);
