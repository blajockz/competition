// The team device: log in with the join code, name the team, play the
// mini-games one after the other, then challenge teams ranked above.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actor } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { serverNow, useLive, useTicker } from '../lib/useLive.js';
import { sfx } from '../lib/audio.js';
import { clock, inkOn, ordinal, yearLabel } from '../lib/format.js';
import {
  BrandBar, CodeLogin, ConnectionBadge, CountdownOverlay, FullscreenGuard, GoFlash, TeamDot, toast,
} from '../components/common.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import RoboPath from '../games/robopath/RoboPath.jsx';
import LockedPhone from '../games/locked/LockedPhone.jsx';
import HuroofBoard from '../games/huroof/HuroofBoard.jsx';
import { AnswerClock, phaseText, RoundScore, useMatchSounds } from '../games/huroof/MatchParts.jsx';
import './play.css';

/* ------------------------------------------------------------------ */
export default function Play() {
  const { token, busy, error, signIn, signOut } = useSession('team');
  const initialCode = useMemo(() => {
    const c = new URLSearchParams(window.location.search).get('code') || '';
    return c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }, []);
  const submit = useCallback(async (code) => {
    const ok = await signIn({ joinCode: code });
    if (ok && window.location.search) window.history.replaceState(null, '', '/play');
  }, [signIn]);

  if (!token) {
    return (
      <CodeLogin
        title="Join your team"
        subtitle="Enter the 4-character code shown on the big screen next to your team’s name, or scan your team’s QR code."
        label="Team join code"
        stageTitle="Your team is waiting."
        stageText="This device becomes your team’s game screen for the whole evening: RoboPath, the Locked Phone and the Huruf showdown."
        placeholder="A7X9"
        maxLength={8}
        busy={busy}
        error={error}
        initial={initialCode}
        autoSubmit={!!initialCode}
        onSubmit={submit}
      />
    );
  }
  return <TeamApp token={token} onLogout={signOut} />;
}

/* ------------------------------------------------------------------ */
function ackKey(teamId, startedAt) {
  return `ucp.ack.${teamId}.${startedAt || 0}`;
}

function TeamApp({ token, onLogout }) {
  const denied = useCallback(() => onLogout('Your session ended: log in again with your join code.'), [onLogout]);
  const { state, connected } = useLive(token, denied);
  const act = useMemo(() => {
    const send = actor('team', token);
    return async (action, payload) => {
      const res = await send(action, payload);
      if (!res.ok && res.status === 401) denied();
      return res;
    };
  }, [token, denied]);
  const offsetRef = useRef(0);
  offsetRef.current = state?.offset || 0;
  const now = useCallback(() => Date.now() + offsetRef.current, []);

  // which finished games the team already left (end window closed)
  const [acks, setAcks] = useState({});
  const ackId = state ? ackKey(state.me.id, state.competition.startedAt) : null;
  useEffect(() => {
    if (!ackId) return;
    try {
      setAcks(JSON.parse(localStorage.getItem(ackId) || '{}'));
    } catch {
      setAcks({});
    }
  }, [ackId]);
  const ack = (game) => {
    sfx.play('click');
    const next = { ...acks, [game]: true };
    setAcks(next);
    try {
      localStorage.setItem(ackId, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  if (!state) {
    return (
      <div className="page">
        <BrandBar />
        <main className="page-main"><p className="muted" aria-busy="true">Connecting…</p></main>
      </div>
    );
  }

  const status = state.competition.status;
  const me = state.me;
  const team = { id: me.id, name: me.name, colorHex: me.colorHex };
  const rp = state.robopath;
  const lp = state.lockedPhone;
  const inMatch = state.match && state.match.side !== null;
  const gameStatuses = ['MAIN_GAMES', 'CHALLENGE_WINDOW', 'FINISHED'];

  let screen;
  if (status === 'REGISTRATION') {
    screen = <Waiting state={state} title="Teams are not ready yet" text="The organisers are still registering participants." />;
  } else if (status === 'LOBBY_LOCKED' || status === 'COUNTDOWN') {
    screen = <Lobby state={state} act={act} />;
  } else if (inMatch && status === 'CHALLENGE_WINDOW') {
    screen = <MatchPlayer state={state} act={act} />;
  } else if (gameStatuses.includes(status) && (rp.status === 'playing' || (!acks.robopath && ['completed', 'abandoned'].includes(rp.status) && status !== 'FINISHED'))) {
    screen = <RoboPath key={`rp-${state.competition.startedAt}`} data={rp} act={act} team={team} onContinue={() => ack('robopath')} />;
  } else if (gameStatuses.includes(status) && (['ready', 'playing'].includes(lp.status) || (!acks.locked && lp.startedAt > 0 && ['completed', 'dead', 'abandoned'].includes(lp.status) && status !== 'FINISHED'))) {
    screen = <LockedPhone key={`lp-${state.competition.startedAt}`} data={{ ...lp, status: lp.status }} act={act} team={team} serverNow={now} onContinue={() => ack('locked')} />;
  } else if (status === 'MAIN_GAMES') {
    screen = <Waiting state={state} title="Mini-games done!" text="Well played. Watch the big screen: the challenge phase opens when every team is done." showBoard />;
  } else if (status === 'CHALLENGE_WINDOW') {
    screen = <ChallengeHub state={state} act={act} />;
  } else {
    screen = <Final state={state} />;
  }

  const fullscreenGame = !inMatch && gameStatuses.includes(status) && status !== 'FINISHED' &&
    screen.type === RoboPath; // RoboPath shows both club logos in its own top bar

  return (
    <FullscreenGuard title={`Team ${me.name}`} text="This device is now your team’s game screen. It must stay in full screen.">
      <div className="team-page" style={{ '--team': me.colorHex, '--team-ink': inkOn(me.colorHex) }}>
        {!fullscreenGame && (
          <BrandBar compact right={<span className="team-chip"><TeamDot color={me.colorHex} />{me.name}</span>}>
            {me.rank && gameStatuses.includes(status) && (
              <span className="team-chip mono">#{me.rank} · {me.score} pts</span>
            )}
          </BrandBar>
        )}
        {screen}
        {status === 'COUNTDOWN' && state.competition.countdownEndsAt && (
          <CountdownLive endsAt={state.competition.countdownEndsAt} offset={state.offset} />
        )}
        {status === 'MAIN_GAMES' && state.competition.startedAt && (
          <GoFlash startedAt={state.competition.startedAt} now={serverNow(state)} />
        )}
        <IncomingChallenge state={state} act={act} />
        <MatchAlerts state={state} />
        <ConnectionBadge connected={connected} />
      </div>
    </FullscreenGuard>
  );
}

function CountdownLive({ endsAt, offset }) {
  useTicker(100);
  return <CountdownOverlay endsAt={endsAt} now={Date.now() + offset} label="The competition starts in" />;
}

/* ------------------------------------------------------------ lobby -- */
function Lobby({ state, act }) {
  const me = state.me;
  const [name, setName] = useState(me.name);
  const [saving, setSaving] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setName(me.name);
  }, [me.name]);

  async function save(e) {
    e.preventDefault();
    const clean = name.trim();
    if (clean === me.name) return;
    setSaving(true);
    const res = await act('rename', { name: clean });
    setSaving(false);
    editing.current = false;
    if (!res.ok) toast(res.error, 'error');
    else {
      sfx.play('score');
      toast('Team name saved', 'good');
    }
  }

  return (
    <main className="page-main lobby">
      <section className="team-hero" style={{ background: me.colorHex, color: inkOn(me.colorHex) }}>
        <span className="hero-label">Your team</span>
        <h1 data-testid="team-name">{me.name}</h1>
        {me.name !== me.placeholderName && <span className="hero-sub">originally “{me.placeholderName}”</span>}
        <span className="hero-code mono">Join code {me.joinCode}</span>
      </section>

      <div className="lobby-grid">
        <form className="card stack" onSubmit={save}>
          <h2>Team name</h2>
          <p className="muted small">Keep your name or choose your own. It appears live on the big screen.</p>
          <label className="field">
            <span>Name (2–24 characters)</span>
            <input
              value={name}
              maxLength={24}
              onChange={(e) => { editing.current = true; setName(e.target.value); }}
              onBlur={() => { if (name.trim() === me.name) editing.current = false; }}
              data-testid="team-name-input"
            />
          </label>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={saving || name.trim().length < 2 || name.trim() === me.name}>
              {saving ? 'Saving…' : 'Save name'}
            </button>
            {name !== me.name && (
              <button type="button" className="btn btn-ghost" onClick={() => { editing.current = false; setName(me.name); }}>Cancel</button>
            )}
          </div>
        </form>

        <section className="card">
          <h2>Members</h2>
          <ul className="members">
            {(me.members || []).map((m, i) => (
              <li key={i}>
                <b>{m.name}</b>
                <span className="muted small">{m.filiere || '—'} · {yearLabel(m.year)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="locked-banner" role="status">
        <span className="pulse-dot" aria-hidden="true" />
        Waiting for the admin to start the competition…
      </div>

      <section className="card">
        <h2>Teams in the lobby</h2>
        <div className="lobby-teams">
          {state.teams.map((t) => (
            <span key={t.id} className={`lobby-team ${t.claimed ? 'in' : ''}`} style={{ '--c': t.colorHex }}>
              <TeamDot color={t.colorHex} /> {t.name}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}

/* --------------------------------------------------------- waiting -- */
function Waiting({ state, title, text, showBoard = false }) {
  return (
    <main className="page-main stack">
      <section className="card center-card">
        <h1>{title}</h1>
        <p className="muted">{text}</p>
        {state.me.rank && (
          <div className="big-stat">
            <div><small>Rank</small><b>{ordinal(state.me.rank)}</b></div>
            <div><small>Score</small><b>{state.me.score}</b></div>
            <div><small>RoboPath</small><b>{state.me.games.robopath.points}</b></div>
            <div><small>Locked Phone</small><b>{state.me.games.locked_phone.points}</b></div>
          </div>
        )}
      </section>
      {showBoard && (
        <section className="card">
          <h2>Live leaderboard</h2>
          <Leaderboard leaderboard={state.leaderboard} teams={state.teams} highlight={state.me.id} rowHeight={56} />
        </section>
      )}
    </main>
  );
}

/* ----------------------------------------------------- challenges -- */
function WindowTimer({ state }) {
  useTicker(500);
  const end = state.competition.challengeTimerEnd;
  if (!end) return null;
  const left = Math.max(0, (end - serverNow(state)) / 1000);
  return (
    <div className={`window-timer ${left < 60 ? 'urgent' : ''}`} role="timer">
      <small>{left > 0 ? 'Challenge window' : 'Window closed'}</small>
      <b className="mono">{clock(left)}</b>
    </div>
  );
}

function ChallengeHub({ state, act }) {
  const me = state.me;
  const c = state.challenge;
  const byId = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  const [sending, setSending] = useState(null);
  const open = state.competition.windowOpen;
  const myQueue = c.queue.find((q) => q.challengerTeamId === me.id || q.defenderTeamId === me.id);

  async function challenge(target) {
    setSending(target.teamId);
    const res = await act('challengeRequest', { defenderId: target.teamId });
    setSending(null);
    if (!res.ok) toast(res.error, 'error');
    else {
      sfx.play('challenge');
      toast(res.status === 'PENDING' ? 'Challenge sent!' : 'Challenge accepted automatically!', 'good');
    }
  }

  async function withdraw(id) {
    const res = await act('challengeCancel', { id });
    if (!res.ok) toast(res.error, 'error');
  }

  return (
    <main className="page-main stack challenge-hub">
      <section className="hub-head card">
        <div className="hub-stats">
          <div><small>Your rank</small><b>{ordinal(me.rank)}</b></div>
          <div><small>Score</small><b>{me.score}</b></div>
          <div><small>Denials left</small><b data-testid="denials">{me.denialsRemaining}/{state.competition.maxDenials}</b></div>
        </div>
        <WindowTimer state={state} />
      </section>

      {state.match && <LiveMatchStrip state={state} />}

      {myQueue && (
        <div className="queue-mine" role="status">
          ⏳ Your match {byId[myQueue.challengerTeamId]?.name} vs {byId[myQueue.defenderTeamId]?.name} is
          <b> #{myQueue.position} in the queue</b> · {myQueue.lockedPointStake} pts at stake
        </div>
      )}

      {c.outgoing.map((o) => <Outgoing key={o.id} ch={o} state={state} onWithdraw={() => withdraw(o.id)} />)}

      <div className="hub-grid">
        <section className="card">
          <h2>Challenge a team ranked above you</h2>
          {!open && <p className="muted">The challenge window is closed.</p>}
          {open && me.rank === 1 && <p className="muted">You are first! Teams below you may challenge you: be ready.</p>}
          {open && me.rank > 1 && c.targets.length === 0 && (
            <p className="muted">You cannot send a challenge while one of yours is pending, queued or being played.</p>
          )}
          <ul className="targets">
            {c.targets.map((t) => {
              const team = byId[t.teamId];
              return (
                <li key={t.teamId} style={{ '--c': team.colorHex }}>
                  <span className="t-rank">#{t.rank}</span>
                  <span className="t-name">{team.name}<small className="muted">{team.score} pts</small></span>
                  <span className="t-stake" title="Points exchanged">±{t.stake}</span>
                  <button
                    type="button"
                    className="btn btn-gold btn-sm"
                    disabled={!t.available || !!sending}
                    onClick={() => challenge(t)}
                    data-testid={`challenge-${t.teamId}`}
                  >
                    {sending === t.teamId ? '…' : t.available ? 'Challenge' : t.reason}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="faint small" style={{ marginTop: 10 }}>
            Stake = {state.competition.baseChallengeStake} pts × rank difference, locked when the challenge is accepted.
            The winner takes it from the loser. Each pair plays once.
          </p>
        </section>

        <section className="card">
          <h2>Queue</h2>
          {c.queue.length === 0 && !state.match && <p className="muted">No match yet.</p>}
          <ol className="queue">
            {c.queue.map((q) => (
              <li key={q.id} className={q.challengerTeamId === me.id || q.defenderTeamId === me.id ? 'mine' : ''}>
                <span className="q-pos">#{q.position}</span>
                <span><TeamDot color={byId[q.challengerTeamId]?.colorHex} /> {byId[q.challengerTeamId]?.name}</span>
                <span className="faint">vs</span>
                <span><TeamDot color={byId[q.defenderTeamId]?.colorHex} /> {byId[q.defenderTeamId]?.name}</span>
                <span className="q-stake">±{q.lockedPointStake}</span>
              </li>
            ))}
          </ol>
          <h3 style={{ marginTop: 16 }}>Leaderboard</h3>
          <Leaderboard leaderboard={state.leaderboard} teams={state.teams} highlight={me.id} rowHeight={48} gap={6} compact />
        </section>
      </div>
    </main>
  );
}

function Outgoing({ ch, state, onWithdraw }) {
  useTicker(500);
  const def = state.teams.find((t) => t.id === ch.defenderTeamId);
  const left = Math.max(0, Math.ceil((ch.expiresAt - serverNow(state)) / 1000));
  return (
    <div className="outgoing card" role="status">
      <span>⚔ Waiting for <b>{def?.name}</b> to answer… auto-accepted in <b className="mono">{left}s</b></span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onWithdraw}>Withdraw</button>
    </div>
  );
}

/** Incoming challenge: a full-screen alert with Accept / Deny. */
function IncomingChallenge({ state, act }) {
  useTicker(500, !!state.challenge?.incoming?.length);
  const incoming = state.challenge?.incoming?.[0];
  const seen = useRef(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (incoming && !seen.current.has(incoming.id)) {
      seen.current.add(incoming.id);
      sfx.play('alarm');
      navigator.vibrate?.([200, 100, 200]);
    }
  }, [incoming]);
  if (!incoming || state.competition.status !== 'CHALLENGE_WINDOW') return null;
  const from = state.teams.find((t) => t.id === incoming.challengerTeamId);
  const me = state.me;
  const left = Math.max(0, Math.ceil((incoming.expiresAt - serverNow(state)) / 1000));
  const rankNow = from?.rank ?? incoming.challengerRank;
  const stake = state.competition.baseChallengeStake * Math.max(0, (rankNow || 0) - (me.rank || 0));

  async function answer(accept) {
    setBusy(true);
    const res = await act('challengeRespond', { id: incoming.id, accept });
    setBusy(false);
    if (!res.ok) toast(res.error, 'error');
    else sfx.play(accept ? 'challenge' : 'click');
  }

  return (
    <div className="incoming-scrim" role="alertdialog" aria-modal="true" aria-labelledby="incoming-title">
      <div className="incoming card" style={{ '--c': from?.colorHex }}>
        <div className="incoming-flash">⚔ CHALLENGE!</div>
        <h2 id="incoming-title"><span className="team-tag" style={{ background: from?.colorHex, color: inkOn(from?.colorHex) }}>{from?.name}</span> (#{rankNow}) challenges you!</h2>
        <p className="incoming-stake">About <b>{stake}</b> points at stake</p>
        <p className="muted">If you do not answer, the challenge is accepted automatically in <b className="mono">{left}s</b>.</p>
        <div className="row incoming-actions">
          <button type="button" className="btn btn-good btn-lg" onClick={() => answer(true)} disabled={busy} data-testid="accept">Accept</button>
          <button type="button" className="btn btn-danger btn-lg" onClick={() => answer(false)} disabled={busy || me.denialsRemaining <= 0} data-testid="deny">
            Deny ({me.denialsRemaining} left)
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sound/toast when one of our challenges changes, and when the room's match ends. */
function MatchAlerts({ state }) {
  const prev = useRef(null);
  useEffect(() => {
    const mine = state.challenge?.mine || [];
    const now = Object.fromEntries(mine.map((c) => [c.id, c.status]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const me = state.me.id;
    for (const c of mine) {
      const was = before[c.id];
      if (was === c.status) continue;
      const other = state.teams.find((t) => t.id === (c.challengerTeamId === me ? c.defenderTeamId : c.challengerTeamId))?.name;
      if (c.status === 'DENIED' && c.challengerTeamId === me) toast(`${other} denied your challenge`, 'error');
      if (c.status === 'QUEUED' && was === 'PENDING') { sfx.play('challenge'); toast(`Challenge accepted: you vs ${other}!`, 'good'); }
      if (c.status === 'IN_PROGRESS') { sfx.play('alarm'); toast(`Your match against ${other} starts now!`, 'good'); }
      if (c.status === 'COMPLETED') {
        const won = c.winnerTeamId === me;
        sfx.play(won ? 'win' : 'lose');
        toast(won ? `You won! +${c.lockedPointStake} pts` : `You lost: −${c.lockedPointStake} pts`, won ? 'good' : 'error');
      }
      if (c.status === 'CANCELLED' && was === 'QUEUED') toast(`Your match against ${other} was cancelled`, 'error');
      if (c.status === 'ABORTED') toast(`Your match against ${other} was cancelled (no points)`, 'error');
    }
  }, [state]);
  return null;
}

/* ---------------------------------------------------------- match -- */
function LiveMatchStrip({ state }) {
  const m = state.match;
  const a = state.teams.find((t) => t.id === m.challenge.challengerTeamId);
  const b = state.teams.find((t) => t.id === m.challenge.defenderTeamId);
  return (
    <section className="card live-strip">
      <div className="live-strip-head">
        <span className="pill bad">● LIVE</span>
        <b>{a?.name}</b><span className="faint">vs</span><b>{b?.name}</b>
        <span className="pill">±{m.challenge.lockedPointStake} pts</span>
      </div>
      <div className="live-strip-board">
        <HuroofBoard board={m.board} colors={[a?.colorHex, b?.colorHex]} names={[a?.name, b?.name]} />
      </div>
      <p className="muted small">{phaseText(m.board, [a?.name, b?.name])}</p>
    </section>
  );
}

function MatchPlayer({ state, act }) {
  const m = state.match;
  const side = m.side;
  const board = m.board;
  const a = state.teams.find((t) => t.id === m.challenge.challengerTeamId);
  const b = state.teams.find((t) => t.id === m.challenge.defenderTeamId);
  const mine = side === 0 ? a : b;
  const them = side === 0 ? b : a;
  const names = [a?.name, b?.name];
  const colors = [a?.colorHex, b?.colorHex];
  useMatchSounds(board);
  const [pressed, setPressed] = useState(false);

  const canBuzz = board.phase === 'question' && board.armed;
  const myTurn = board.phase === 'answer' && board.turn === side;
  const theirTurn = board.phase === 'answer' && board.turn !== side;

  const buzz = useCallback(async () => {
    if (!canBuzz) return;
    setPressed(true);
    navigator.vibrate?.(60);
    const res = await act('buzz');
    setTimeout(() => setPressed(false), 250);
    if (!res.ok) toast(res.error, 'error');
  }, [canBuzz, act]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        buzz();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [buzz]);

  let label = 'Wait…';
  if (canBuzz) label = 'BUZZ!';
  else if (myTurn) label = 'Answer now!';
  else if (theirTurn) label = `${them?.name} answers`;
  else if (board.phase === 'question' && board.tried[side]) label = 'Already answered';
  else if (board.phase === 'pick') label = board.chooser === side ? 'Your pick: name a letter!' : `${them?.name} picks`;
  else if (board.phase === 'matchOver') label = board.matchWinner === side ? 'You won! 🏆' : 'Match lost';

  return (
    <main className="page-main match-player" style={{ '--mine': mine?.colorHex, '--mine-ink': inkOn(mine?.colorHex) }}>
      <div className="mp-head">
        <span className="team-tag" style={{ background: a?.colorHex, color: inkOn(a?.colorHex) }}>{a?.name}</span>
        <RoundScore board={board} colors={colors} />
        <span className="faint">vs</span>
        <span className="team-tag" style={{ background: b?.colorHex, color: inkOn(b?.colorHex) }}>{b?.name}</span>
        <span className="pill">±{m.challenge.lockedPointStake} pts</span>
      </div>
      <p className="mp-goal muted small">
        You link the <b>{side === 0 ? 'left ↔ right' : 'top ↕ bottom'}</b> sides ({side === 0 ? 'challenger' : 'defender'}).
      </p>
      <div className="mp-body">
        <div className="mp-buzz-wrap">
          {board.letter && board.phase !== 'pick' && <div className="mp-letter" aria-label="Letter">{board.letter}</div>}
          <button
            type="button"
            className={`buzzer ${canBuzz ? 'armed' : ''} ${myTurn ? 'mine' : ''} ${pressed ? 'pressed' : ''}`}
            onClick={buzz}
            disabled={!canBuzz}
            data-testid="buzz"
          >
            {label}
          </button>
          <div className="mp-clock"><AnswerClock board={board} offset={state.offset} big /></div>
          <p className="mp-phase">{phaseText(board, names)}</p>
        </div>
        <div className="mp-board">
          <HuroofBoard board={board} colors={colors} names={names} />
        </div>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------- final -- */
function Final({ state }) {
  const me = state.me;
  return (
    <main className="page-main stack">
      <section className="card center-card">
        <h1>{me.rank === 1 ? '🏆 Champions!' : 'The competition is over'}</h1>
        <div className="big-stat">
          <div><small>Final rank</small><b>{ordinal(me.rank)}</b></div>
          <div><small>Final score</small><b>{me.score}</b></div>
          <div><small>Mini-games</small><b>{me.gamePoints}</b></div>
          <div><small>Challenges</small><b>{me.challengePoints > 0 ? `+${me.challengePoints}` : me.challengePoints}</b></div>
        </div>
        <p className="muted">Thank you for playing!</p>
      </section>
      <section className="card">
        <h2>Final standings</h2>
        <Leaderboard leaderboard={state.leaderboard} teams={state.teams} highlight={me.id} rowHeight={56} />
      </section>
    </main>
  );
}
