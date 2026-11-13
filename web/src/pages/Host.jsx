// The big screen (projector): teams and join codes, the countdown, the live
// leaderboard, the challenge queue and the live 1v1 Huruf board.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../lib/session.js';
import { serverNow, useLive, useTicker } from '../lib/useLive.js';
import { sfx } from '../lib/audio.js';
import { clock, inkOn, yearLabel } from '../lib/format.js';
import {
  BrandBar, CodeLogin, ConnectionBadge, CountdownOverlay, FullscreenGuard, GoFlash, QR, TeamDot,
} from '../components/common.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import HuroofBoard from '../games/huroof/HuroofBoard.jsx';
import { AnswerClock, phaseText, RoundScore, useMatchSounds } from '../games/huroof/MatchParts.jsx';
import './host.css';

export default function Host() {
  const { token, busy, error, signIn, signOut } = useSession('host');
  const submit = useCallback((code) => signIn({ code }), [signIn]);
  if (!token) {
    return (
      <CodeLogin
        title="Big screen"
        subtitle="Enter the host code on the computer connected to the projector."
        label="Host code"
        stageTitle="Up on the big screen"
        stageText="Teams and their join codes, the countdown, the live leaderboard and every Huruf match, shown to the whole room."
        placeholder="HST-XXXX-XXXX"
        busy={busy}
        error={error}
        onSubmit={submit}
      />
    );
  }
  return <HostScreen token={token} onLogout={signOut} />;
}

function HostScreen({ token, onLogout }) {
  const denied = useCallback(() => onLogout('The host session ended: enter the code again.'), [onLogout]);
  const { state, connected } = useLive(token, denied);
  useTicker(500);

  if (!state) return <div className="host-page"><BrandBar /><p className="muted host-wait">Connecting…</p></div>;
  const status = state.competition.status;
  const now = serverNow(state);

  let body;
  if (status === 'REGISTRATION') body = <Splash />;
  else if (status === 'LOBBY_LOCKED' || status === 'COUNTDOWN') body = <LobbyWall state={state} />;
  else if (status === 'MAIN_GAMES') body = <MainBoard state={state} />;
  else if (status === 'CHALLENGE_WINDOW') body = state.match ? <MatchStage state={state} /> : <ChallengeBoard state={state} />;
  else body = <Podium state={state} />;

  const end = state.competition.challengeTimerEnd;
  return (
    <FullscreenGuard title="Big screen ready" text="Tap to put the big screen in full screen and turn the sound on.">
      <div className="host-page">
        <BrandBar right={status === 'CHALLENGE_WINDOW' && end ? <WindowClock end={end} now={now} /> : null}>
          <span className="brand-title">{titleFor(status)}</span>
        </BrandBar>
        <main className="host-main">{body}</main>
        {status === 'COUNTDOWN' && state.competition.countdownEndsAt && (
          <CountdownOverlay endsAt={state.competition.countdownEndsAt} now={now} label="The competition starts in" />
        )}
        {status === 'MAIN_GAMES' && <GoFlash startedAt={state.competition.startedAt} now={now} />}
        <FeedAlerts state={state} />
        <ResultSplash state={state} />
        <ConnectionBadge connected={connected} />
      </div>
    </FullscreenGuard>
  );
}

function titleFor(status) {
  return {
    REGISTRATION: 'Welcome!',
    LOBBY_LOCKED: 'Find your team',
    COUNTDOWN: 'Get ready…',
    MAIN_GAMES: 'Mini-game gauntlet · Live leaderboard',
    CHALLENGE_WINDOW: 'Challenge phase · 1v1 Huruf showdown',
    FINISHED: 'Final results',
  }[status] || '';
}

function WindowClock({ end, now }) {
  const left = Math.max(0, (end - now) / 1000);
  return (
    <div className={`host-clock ${left < 60 ? 'urgent' : ''}`}>
      <small>{left > 0 ? 'Challenges close in' : 'Challenges closed'}</small>
      <b className="mono">{clock(left)}</b>
    </div>
  );
}

/* --------------------------------------------------------- splash -- */
function Splash() {
  return (
    <div className="splash">
      <div className="splash-logos">
        <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD" /></span>
        <span className="brand-x">×</span>
        <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC" /></span>
      </div>
      <h1>The Competition</h1>
      <p>RoboPath · The Locked Phone · 1v1 Huruf showdown</p>
      <p className="muted">Registration in progress. Teams appear here in a moment.</p>
    </div>
  );
}

/* ---------------------------------------------------------- lobby -- */
function LobbyWall({ state }) {
  const origin = window.location.origin;
  const teams = state.teams;
  const cols = teams.length <= 4 ? teams.length : teams.length <= 6 ? 3 : teams.length <= 8 ? 4 : teams.length <= 15 ? 5 : 6;
  const claimed = teams.filter((t) => t.claimed).length;
  return (
    <div className="lobby-wall">
      <p className="lobby-hint">
        Open <b className="mono">{origin.replace(/^https?:\/\//, '')}/play</b> on your team’s device and type your join code, or scan your QR code.
        <span className="pill accent" style={{ marginLeft: 12 }}>{claimed}/{teams.length} teams in</span>
      </p>
      <div className="team-wall" style={{ '--cols': Math.max(1, cols) }}>
        {teams.map((t) => (
          <article key={t.id} className={`team-card ${t.claimed ? 'claimed' : ''}`} style={{ '--c': t.colorHex, '--ink': inkOn(t.colorHex) }}>
            <header>
              <h2 key={t.name} className="team-card-name">{t.name}</h2>
              {t.claimed && <span className="claimed-badge" title="This team is logged in">✓</span>}
            </header>
            <div className="team-card-body">
              <ul>
                {(t.members || []).map((m, i) => (
                  <li key={i}><b>{m.name}</b><small>{m.filiere ? `${m.filiere} · ` : ''}{yearLabel(m.year)}</small></li>
                ))}
              </ul>
              {t.joinCode && (
                <div className="join">
                  <QR text={`${origin}/join?code=${t.joinCode}`} size={cols >= 5 ? 92 : 120} />
                  <span className="join-code mono">{t.joinCode}</span>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------- main games -- */
function Progress({ team }) {
  const rp = team.games.robopath;
  const lp = team.games.locked_phone;
  return (
    <>
      <span className="prog">
        RoboPath
        <span className="pips">
          {Array.from({ length: rp.total }, (_, i) => (
            <i key={i} className={i < rp.solved ? 'on' : i < rp.solved + rp.skipped ? 'skip' : ''} />
          ))}
        </span>
        {rp.points}
      </span>
      <span className="prog">
        Locked Phone
        <span className="pips">
          {Array.from({ length: lp.total }, (_, i) => <i key={i} className={i < lp.stage - lp.skipped ? 'on' : i < lp.stage ? 'skip' : ''} />)}
        </span>
        {lp.points}
        {lp.status === 'dead' && ' 🔋✗'}
      </span>
      {team.currentGameIndex >= 2 && <span className="pill good">done</span>}
    </>
  );
}

function MainBoard({ state }) {
  const n = state.leaderboard.length;
  const rowHeight = Math.max(44, Math.min(78, Math.floor((window.innerHeight - 190) / Math.max(1, n)) - 8));
  return (
    <div className="main-board">
      <section className="lb-big">
        <Leaderboard leaderboard={state.leaderboard} teams={state.teams} rowHeight={rowHeight} detail={(t) => <Progress team={t} />} />
      </section>
      <aside className="feed card">
        <h2>Live</h2>
        <Feed items={state.feed} teams={state.teams} />
      </aside>
    </div>
  );
}

function Feed({ items, teams }) {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  return (
    <ul className="feed-list">
      {items.map((f) => (
        <li key={f.id} className={`feed-${f.type}`}>
          <span className="feed-dots">{(f.teamIds || []).slice(0, 2).map((id) => <TeamDot key={id} color={byId[id]?.colorHex} size={10} />)}</span>
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------- challenge phase -- */
function QueuePanel({ state, title = 'Up next' }) {
  const byId = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  return (
    <section className="card queue-panel">
      <h2>{title}</h2>
      {state.queue.length === 0 && <p className="muted">No match waiting.</p>}
      <ol>
        {state.queue.map((q) => (
          <li key={q.id}>
            <span className="q-pos mono">#{q.position}</span>
            <span className="q-teams">
              <TeamDot color={byId[q.challengerTeamId]?.colorHex} /> {byId[q.challengerTeamId]?.name}
              <span className="faint"> vs </span>
              <TeamDot color={byId[q.defenderTeamId]?.colorHex} /> {byId[q.defenderTeamId]?.name}
            </span>
            <span className="q-stake mono">±{q.lockedPointStake}</span>
          </li>
        ))}
      </ol>
      {state.pending.length > 0 && (
        <>
          <h3>Waiting for an answer</h3>
          <ul className="pending">
            {state.pending.map((p) => (
              <li key={p.id}>⚔ {byId[p.challengerTeamId]?.name} → {byId[p.defenderTeamId]?.name}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ChallengeBoard({ state }) {
  const n = state.leaderboard.length;
  const rowHeight = Math.max(44, Math.min(74, Math.floor((window.innerHeight - 200) / Math.max(1, n)) - 8));
  const open = state.competition.windowOpen;
  return (
    <div className="main-board">
      <section className="lb-big">
        <p className="challenge-call">
          {open
            ? <>⚔ Lower-ranked teams: challenge a team above you! Stake = {state.competition.baseChallengeStake} pts × rank difference.</>
            : <>The challenge window is closed. Remaining matches are played now.</>}
        </p>
        <Leaderboard leaderboard={state.leaderboard} teams={state.teams} rowHeight={rowHeight}
          detail={(t) => <span>{t.denialsRemaining}/{state.competition.maxDenials} denials left{t.busy ? ` · ${t.busy.toLowerCase().replace('_', ' ')}` : ''}</span>} />
      </section>
      <aside className="side-col">
        <QueuePanel state={state} />
        <section className="feed card">
          <h2>Live</h2>
          <Feed items={state.feed} teams={state.teams} />
        </section>
      </aside>
    </div>
  );
}

function MatchStage({ state }) {
  const m = state.match;
  const board = m.board;
  const a = state.teams.find((t) => t.id === m.challenge.challengerTeamId);
  const b = state.teams.find((t) => t.id === m.challenge.defenderTeamId);
  const names = [a?.name, b?.name];
  const colors = [a?.colorHex, b?.colorHex];
  useMatchSounds(board);
  const side = (t, i) => {
    const active = (board.phase === 'answer' && board.turn === i) || (board.phase === 'pick' && board.chooser === i);
    const out = board.phase === 'question' && board.tried[i];
    return (
      <div className={`ms-team ${active ? 'active' : ''} ${out ? 'out' : ''} ${board.buzzer === i && board.phase === 'answer' ? 'buzzed' : ''}`} style={{ '--c': t?.colorHex, '--ink': inkOn(t?.colorHex) }}>
        <small>{i === 0 ? 'Challenger · links ↔' : 'Defender · links ↕'}</small>
        <h2>{t?.name}</h2>
        <span className="ms-rank">#{i === 0 ? m.challenge.challengerRank : m.challenge.defenderRank}</span>
        {board.phase === 'answer' && board.turn === i && <span className="ms-flag">{board.buzzer === i ? 'BUZZED!' : 'Answers'}</span>}
      </div>
    );
  };
  return (
    <div className="match-stage">
      <div className="ms-top">
        {side(a, 0)}
        <div className="ms-mid">
          <span className="ms-stake">±{m.challenge.lockedPointStake} pts</span>
          <RoundScore board={board} colors={colors} />
          <AnswerClock board={board} offset={state.offset} big />
        </div>
        {side(b, 1)}
      </div>
      <div className="ms-body">
        <div className="ms-board">
          <HuroofBoard board={board} colors={colors} names={names} />
        </div>
        <aside className="side-col">
          <section className="card ms-q">
            <p className="ms-phase">{phaseText(board, names)}</p>
            {board.sel >= 0 && board.cells[board.sel] && <div className="ms-letter">{board.cells[board.sel].l}</div>}
            {board.q?.q && <p className="huruf-q">{board.q.q}</p>}
            {board.q?.a && <p className="huruf-a">{board.q.a}</p>}
            {board.last?.a && board.phase === 'pick' && <p className="muted small">Last answer: <span className="huruf-a">{board.last.a}</span></p>}
          </section>
          <QueuePanel state={state} />
        </aside>
      </div>
    </div>
  );
}

/* --------------------------------------------------- alerts/result -- */
function FeedAlerts({ state }) {
  const seen = useRef(null);
  const timer = useRef(null);
  const [banner, setBanner] = useState(null);
  useEffect(() => {
    const ids = state.feed.map((f) => f.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = state.feed.filter((f) => !seen.current.has(f.id));
    ids.forEach((id) => seen.current.add(id));
    if (!fresh.length) return;
    const alert = fresh.find((f) => f.alert);
    if (alert) {
      sfx.play(alert.type === 'match' ? 'alarm' : 'challenge');
      setBanner(alert);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setBanner(null), 4500);
      return;
    }
    if (fresh.some((f) => f.type === 'game' || f.type === 'team')) sfx.play('notify');
    if (fresh.some((f) => f.type === 'phase')) sfx.play('fanfare');
  }, [state.feed]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!banner || banner.winner) return null;
  const t = state.teams.find((x) => x.id === banner.teamIds?.[0]);
  return (
    <div className="alert-banner" style={{ '--c': t?.colorHex || 'var(--gold)' }} role="alert">
      {banner.text}
    </div>
  );
}

function ResultSplash({ state }) {
  const r = state.lastResult;
  const [show, setShow] = useState(null);
  const last = useRef(r?.challengeId || null);
  const timer = useRef(null);
  useEffect(() => {
    if (!r || r.challengeId === last.current) return;
    last.current = r.challengeId;
    setShow(r);
    sfx.play('win');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(null), 6000);
  }, [r]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!show) return null;
  const w = state.teams.find((t) => t.id === show.winner);
  const l = state.teams.find((t) => t.id === show.loser);
  return (
    <div className="result-splash" style={{ '--c': w?.colorHex }} onClick={() => setShow(null)}>
      <div className="rs-card">
        <small>Showdown result</small>
        <h1>🏆 {w?.name}</h1>
        <p>beats {l?.name}</p>
        <div className="rs-points">
          <span className="plus">+{show.stake}</span>
          <span className="minus">−{show.stake}</span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- podium -- */
function Podium({ state }) {
  const byId = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  const top = state.leaderboard.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const played = useRef(false);
  useEffect(() => {
    if (!played.current) {
      played.current = true;
      sfx.play('fanfare');
    }
  }, []);
  const rest = state.leaderboard.slice(3);
  return (
    <div className="podium-wrap">
      <div className="podium">
        {order.map((r) => {
          const t = byId[r.id];
          return (
            <div key={r.id} className={`podium-step p${r.rank}`} style={{ '--c': t.colorHex, '--ink': inkOn(t.colorHex) }}>
              <div className="podium-name">{r.rank === 1 && <span className="crown">👑</span>}{t.name}</div>
              <div className="podium-score">{r.score} pts</div>
              <div className="podium-block"><span>{r.rank}</span></div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <ol className="podium-rest" start={4}>
          {rest.map((r) => (
            <li key={r.id}><TeamDot color={byId[r.id].colorHex} /> {byId[r.id].name} <b>{r.score}</b></li>
          ))}
        </ol>
      )}
    </div>
  );
}
