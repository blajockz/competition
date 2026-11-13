// Pieces shared by the three Huruf screens (big screen, presenter, team devices).
import { useEffect, useRef } from 'react';
import { sfx } from '../../lib/audio.js';
import { useTicker } from '../../lib/useLive.js';

/** Plays the sound of each new board event, once. */
export function useMatchSounds(board) {
  const last = useRef(board?.fx?.seq ?? null);
  useEffect(() => {
    const fx = board?.fx;
    if (!fx || fx.seq === last.current) return;
    const first = last.current === null;
    last.current = fx.seq;
    if (first) return;
    const map = {
      buzz: fx.team === 1 ? 'buzz1' : 'buzz0',
      turn: 'notify',
      pick: 'pick',
      claim: 'correct',
      wrong: 'wrong',
      missed: 'wrong',
      round: 'start',
      roundWon: 'round',
      match: 'win',
      undo: 'toggle',
    };
    if (map[fx.type]) sfx.play(map[fx.type]);
  }, [board?.fx]);
}

/** Seconds left on the answer clock (server time). */
export function useAnswerClock(board, offset = 0) {
  const t = board?.timer;
  useTicker(200, !!t);
  if (!t) return null;
  const left = Math.max(0, Math.ceil((t.ends - (Date.now() + offset)) / 1000));
  return { left, total: t.total, frac: Math.max(0, Math.min(1, (t.ends - (Date.now() + offset)) / (t.total * 1000))) };
}

export function AnswerClock({ board, offset, big = false }) {
  const c = useAnswerClock(board, offset);
  const lastLeft = useRef(null);
  useEffect(() => {
    if (!c) {
      lastLeft.current = null;
      return;
    }
    if (c.left !== lastLeft.current) {
      if (lastLeft.current !== null && c.left <= 3 && c.left > 0) sfx.play('tick');
      if (lastLeft.current !== null && c.left === 0) sfx.play('timeUp');
      lastLeft.current = c.left;
    }
  });
  if (!c) return null;
  return (
    <div className={`answer-clock ${big ? 'big' : ''} ${c.left <= 3 ? 'urgent' : ''}`} role="timer" aria-label={`${c.left} seconds`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" className="track" />
        <circle cx="20" cy="20" r="17" className="bar" style={{ strokeDashoffset: `${(1 - c.frac) * 106.8}` }} />
      </svg>
      <b>{c.left}</b>
    </div>
  );
}

/** One line telling the room what happens now. */
export function phaseText(board, names) {
  if (!board) return '';
  const nm = (i) => names[i] || (i === 0 ? 'Challenger' : 'Defender');
  switch (board.phase) {
    case 'lobby': return 'Waiting for the presenter to start the match';
    case 'pick': return `${nm(board.chooser)} picks a letter`;
    case 'question': return board.tried[0] || board.tried[1] ? `${nm(board.tried[0] ? 1 : 0)} can answer` : 'Buzz to answer!';
    case 'answer': return `${nm(board.turn)} answers…`;
    case 'missed': return 'Nobody found it: new question or another letter';
    case 'roundOver': return `${nm(board.roundWinner)} wins round ${board.round}!`;
    case 'matchOver': return `${nm(board.matchWinner)} wins the match!`;
    default: return '';
  }
}

export function RoundScore({ board, colors }) {
  if (!board || board.settings.roundsToWin <= 1) return null;
  return (
    <div className="round-score" aria-label="Rounds won">
      <span style={{ color: colors[0] }}>{board.score[0]}</span>
      <small>best of {board.settings.roundsToWin * 2 - 1}</small>
      <span style={{ color: colors[1] }}>{board.score[1]}</span>
    </div>
  );
}
