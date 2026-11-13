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
import { HfStage } from '../games/huroof/Original.jsx';
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
        stageText="Registration and check-in QR codes, teams and their join codes, the 1:30 game clock, the live leaderboard and every Huruf match, shown to the whole room."
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
  if (status === 'REGISTRATION') body = <RegistrationWall state={state} now={now} />;
  else if (status === 'LOBBY_LOCKED' || status === 'COUNTDOWN') body = <LobbyWall state={state} />;
  else if (status === 'MAIN_GAMES') body = <MainBoard state={state} />;
  else if (status === 'CHALLENGE_WINDOW') body = state.match ? <MatchStage state={state} now={now} /> : <ChallengeBoard state={state} />;
  else body = <Podium state={state} />;

  const end = state.competition.challengeTimerEnd;
  const gamesEnd = state.competition.mainGamesEndsAt;
  let clockEl = null;
  if (status === 'CHALLENGE_WINDOW' && end) clockEl = <WindowClock end={end} now={now} />;
  else if (status === 'MAIN_GAMES' && gamesEnd) clockEl = <GamesClock end={gamesEnd} now={now} />;
  return (
    <FullscreenGuard title="Big screen ready" text="Tap to put the big screen in full screen and turn the sound on.">
      <div className="host-page">
        <BrandBar right={clockEl}>
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
    REGISTRATION: 'Registration & check-in',
    LOBBY_LOCKED: 'Find your team',
    COUNTDOWN: 'Get ready…',
    MAIN_GAMES: 'Mini-games · Live leaderboard',
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

/** The 1:30:00 clock of the mini-games: the challenge phase opens when it reaches zero. */
function GamesClock({ end, now }) {
  const left = Math.max(0, (end - now) / 1000);
  return (
    <div className={`host-clock games ${left < 300 ? 'urgent' : ''}`} data-testid="games-clock">
      <small>{left > 0 ? 'Challenge phase in' : 'Time is up'}</small>
      <b className="mono">{clock(left)}</b>
    </div>
  );
}

/* --------------------------------------------- registration & check-in -- */
function RegistrationWall({ state, now }) {
  const reg = state.registration;
  const origin = window.location.origin;
  const host = origin.replace(/^https?:\/\//, '');
  const slotLeft = reg.slotMs ? 1 - ((now % reg.slotMs) / reg.slotMs) : 0;
  const checkinUrl = reg.checkinKey ? `${origin}/checkin?k=${reg.checkinKey}` : '';
  const seen = useRef(null);
  const fresh = new Set();
  if (seen.current === null) seen.current = new Set(reg.recent.map((p) => p.id));
  for (const p of reg.recent) {
    if (!seen.current.has(p.id)) fresh.add(p.id);
  }
  useEffect(() => {
    if (!fresh.size) return;
    sfx.play('notify');
    reg.recent.forEach((p) => seen.current.add(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg.recent]);

  return (
    <div className={`reg-wall ${reg.checkinOpen ? 'with-checkin' : ''}`}>
      <section className="reg-panel reg-signup">
        <header>
          <span className="reg-step">1</span>
          <div>
            <h2>Register</h2>
            <p>Scan with your phone camera. Full name, phone, field and year: thirty seconds.</p>
          </div>
        </header>
        <div className="reg-qr-wrap">
          <QR text={`${origin}/register`} size={reg.checkinOpen ? 'min(19vw, 32vh)' : 'min(30vw, 50vh)'} />
        </div>
        <p className="reg-url mono">{host}/register</p>
        {!reg.registrationOpen && <p className="pill warn">Online registration is closed. Register on site with the check-in code.</p>}
      </section>

      <section className={`reg-panel reg-checkin ${reg.checkinOpen ? 'open' : ''}`}>
        <header>
          <span className="reg-step">2</span>
          <div>
            <h2>Check in</h2>
            <p>{reg.checkinOpen ? 'You are here? Scan this code to confirm your presence. Only confirmed players get a team.' : 'Opens on event day, right before the games. Teams are drawn from confirmed players only.'}</p>
          </div>
        </header>
        {reg.checkinOpen ? (
          <>
            <div className="reg-qr-wrap live" data-testid="checkin-qr" data-url={checkinUrl}>
              <QR text={checkinUrl} size="min(30vw, 50vh)" />
              <svg className="reg-ring" viewBox="0 0 100 100" aria-hidden="true">
                <rect x="2" y="2" width="96" height="96" rx="10" pathLength="100" style={{ strokeDashoffset: 100 - slotLeft * 100 }} />
              </svg>
            </div>
            <p className="reg-url"><span className="pill accent">The code changes every minute</span></p>
          </>
        ) : (
          <div className="reg-closed">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            <span>Check-in is not open yet</span>
          </div>
        )}
      </section>

      <aside className="reg-side">
        <div className="reg-counters">
          <div><b className="mono" data-testid="reg-count">{reg.registered}</b><small>registered</small></div>
          <div className="good"><b className="mono" data-testid="confirmed-count">{reg.confirmed}</b><small>here &amp; confirmed</small></div>
        </div>
        <div className="reg-meter" aria-hidden="true"><i style={{ width: `${reg.registered ? (reg.confirmed / reg.registered) * 100 : 0}%` }} /></div>
        <h3>Just checked in</h3>
        <ul className="reg-recent">
          {reg.recent.length === 0 && <li className="muted">Nobody yet.</li>}
          {reg.recent.map((p) => (
            <li key={p.id} className={fresh.has(p.id) ? 'fresh' : ''}>
              <span className="reg-avatar">{initials(p.name)}</span>
              <span><b>{p.name}</b><small>{p.filiere}{p.filiere ? ' · ' : ''}{yearLabel(p.year)}</small></span>
            </li>
          ))}
        </ul>
        <p className="reg-games">RoboPath · The Locked Phone · N7 Quiz · 1v1 Huruf showdown</p>
      </aside>
    </div>
  );
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
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
  const qz = team.games.quiz;
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
      <span className="prog">
        Quiz
        <span className="pips quiz">
          <i className={qz.answered >= qz.total ? 'on' : qz.answered > 0 ? 'half' : ''} style={{ '--q': `${(qz.answered / qz.total) * 100}%` }} />
        </span>
        {['completed', 'abandoned'].includes(qz.status) ? qz.points : qz.status === 'playing' ? `${qz.answered}/${qz.total}` : '–'}
      </span>
      {team.currentGameIndex >= 3 && <span className="pill good">done</span>}
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

function MatchStage({ state, now }) {
  const m = state.match;
  const a = state.teams.find((t) => t.id === m.challenge.challengerTeamId);
  const b = state.teams.find((t) => t.id === m.challenge.defenderTeamId);
  const end = state.competition.challengeTimerEnd;
  return (
    <HfStage
      board={m.board}
      names={[a?.name, b?.name]}
      colors={[a?.colorHex, b?.colorHex]}
      teams={[a, b]}
      offset={state.offset}
      stake={m.challenge.lockedPointStake}
      clockText={end ? clock(Math.max(0, (end - now) / 1000)) : ''}
      clockUrgent={!!end && end - now < 60000}
    />
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
