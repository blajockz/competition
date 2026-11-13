// The public page: introduces the event, follows it live, and sends teams to
// their join screen. Staff screens (/admin, /host) are deliberately not linked.
import { useEffect } from 'react';
import { usePublic } from '../lib/usePublic.js';
import { useTicker } from '../lib/useLive.js';
import { clock, inkOn } from '../lib/format.js';
import { MuteButton } from '../components/common.jsx';
import HeroHive from '../components/HeroHive.jsx';
import '../games/huroof/huroof.css';
import './landing.css';

const PHASES = [
  { key: 'REGISTRATION', title: 'Registration', text: 'The organisers register everyone with their track and year.' },
  { key: 'LOBBY_LOCKED', title: 'Teams and lobby', text: 'Balanced teams are drawn. Each team logs in, sees its colour and picks a name.' },
  { key: 'MAIN_GAMES', title: 'The gauntlet', text: 'Countdown, then every team plays RoboPath and the Locked Phone on its own device.' },
  { key: 'CHALLENGE_WINDOW', title: 'Challenge window', text: 'Lower-ranked teams challenge the teams above them in live Huruf matches.' },
  { key: 'FINISHED', title: 'Podium', text: 'Scores freeze and the final standings go up on the big screen.' },
];
const phaseIndex = (status) => {
  if (status === 'COUNTDOWN') return 2;
  const i = PHASES.findIndex((p) => p.key === status);
  return i < 0 ? 0 : i;
};

function StatusLine({ data }) {
  useTicker(1000, data?.status === 'CHALLENGE_WINDOW' || data?.status === 'COUNTDOWN');
  if (!data) return <p className="lp-status" aria-live="polite"><span className="lp-dot" />Checking the event status</p>;
  const now = Date.now() + (data.offset || 0);
  let text;
  let live = false;
  switch (data.status) {
    case 'REGISTRATION':
      text = data.participantCount ? `Registration is open: ${data.participantCount} players so far.` : 'Registration is open.';
      break;
    case 'LOBBY_LOCKED':
      text = `Teams are in the lobby: ${data.claimedCount} of ${data.teamCount} logged in.`;
      live = true;
      break;
    case 'COUNTDOWN':
      text = 'The gauntlet is about to start.';
      live = true;
      break;
    case 'MAIN_GAMES':
      text = `Live now: ${data.teamCount} teams are playing the mini-games.`;
      live = true;
      break;
    case 'CHALLENGE_WINDOW': {
      const left = Math.max(0, (data.challengeTimerEnd - now) / 1000);
      text = left > 0 ? `Challenge window open, ${clock(left)} left.` : 'Challenge window closed, last matches in play.';
      live = true;
      break;
    }
    default:
      text = 'The final results are in.';
  }
  return (
    <p className={`lp-status ${live ? 'live' : ''}`} aria-live="polite">
      <span className="lp-dot" />
      {text}
    </p>
  );
}

function Standings({ data }) {
  if (!data?.standings?.length) return null;
  const done = data.status === 'FINISHED';
  const top = data.standings.slice(0, 8);
  const max = Math.max(1, ...top.map((t) => Math.abs(t.score)));
  return (
    <section className="lp-section lp-standings" aria-labelledby="standings-title">
      <div className="lp-section-head">
        <h2 id="standings-title">{done ? 'Final standings' : 'Live standings'}</h2>
        <p>{done ? 'Congratulations to every team.' : 'Updated every few seconds from the event.'}</p>
      </div>
      <div className="lp-standings-grid">
        <ol className="lp-board">
          {top.map((t) => (
            <li key={t.rank + t.name} style={{ '--c': t.colorHex }}>
              <span className="lp-rank">{t.rank}</span>
              <span className="lp-team">{t.name}</span>
              <span className="lp-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (Math.max(0, t.score) / max) * 100)}%` }} /></span>
              <span className="lp-score">{t.score}</span>
            </li>
          ))}
        </ol>
        {data.match && (
          <div className="lp-match">
            <p className="lp-match-label"><span className="lp-dot" />On the big screen now</p>
            <div className="lp-match-teams">
              <span style={{ background: data.match.challenger.colorHex, color: inkOn(data.match.challenger.colorHex) }}>{data.match.challenger.name}</span>
              <small>against</small>
              <span style={{ background: data.match.defender.colorHex, color: inkOn(data.match.defender.colorHex) }}>{data.match.defender.name}</span>
            </div>
            <p className="lp-match-stake">{data.match.stake} points change hands</p>
          </div>
        )}
      </div>
    </section>
  );
}

function RoboArt() {
  return (
    <div className="art art-robo" aria-hidden="true">
      <div className="robo-grid">
        <i className="t b" /><i className="t b" /><i className="t b star" /><i />
        <i /><i /><i className="t o" /><i />
        <i /><i /><i className="t g star" /><i className="t g" />
      </div>
      <img src="/mascot/idle.gif" alt="" className="robo-ghost" width="72" height="72" />
    </div>
  );
}

function PhoneArt() {
  return (
    <div className="art art-phone" aria-hidden="true">
      <div className="ph">
        <span className="ph-time">18:04</span>
        <span className="ph-owner">Rayan’s phone</span>
        <span className="ph-locks"><i className="on" /><i className="on" /><i /><i /></span>
        <span className="ph-batt"><i /></span>
      </div>
    </div>
  );
}

function HurufArt() {
  // حروف, written right to left, one hexagon per letter
  const letters = [['ف', '#3B82F6'], ['و', null], ['ر', '#F59E0B'], ['ح', '#3B82F6']];
  return (
    <div className="art art-huruf" aria-hidden="true">
      <svg viewBox="0 0 420 130">
        {letters.map(([l, c], k) => {
          const cx = 62 + k * 98;
          const cy = 65;
          const r = 56;
          const p = [0, 1, 2, 3, 4, 5].map((j) => {
            const a = (Math.PI / 180) * (-90 + 60 * j);
            return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
          }).join(' ');
          return (
            <g key={k}>
              <polygon points={p} fill={c || '#FBF8FF'} stroke="#4F2D68" strokeWidth="4" />
              <text x={cx} y={cy + 3} fill={c ? '#fff' : '#351E48'}>{l}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Landing() {
  const data = usePublic();
  const name = data?.eventName || 'N7 Kickoff Cup';
  useEffect(() => {
    document.title = name;
  }, [name]);
  const current = phaseIndex(data?.status);
  const stake = data?.baseChallengeStake ?? 50;
  const denials = data?.maxDenials ?? 2;

  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="lp-brand" href="/" aria-label={`${name}, home`}>
          <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD" /></span>
          <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC" /></span>
          <span className="lp-brand-name">{name}</span>
        </a>
        <nav className="lp-nav-links" aria-label="Sections">
          <a href="#games">Games</a>
          <a href="#evening">The evening</a>
          <a href="#rules">Rules</a>
        </nav>
        <div className="lp-nav-actions">
          <MuteButton />
          <a className="btn btn-primary" href="/play">Join your team</a>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <h1 className="lp-title">
              <span>Solve it.<small>RoboPath</small></span>
              <span>Crack it.<small>The Locked Phone</small></span>
              <span>Claim it.<small>Huruf showdown</small></span>
            </h1>
            <p className="lp-lead">
              {name} is the joint evening of N7GD and N7SEC. Teams of up to four, mixed across years,
              program a ghost through a maze, break into a missing president’s phone, then fight for points
              letter by letter. Every point lands on one shared leaderboard.
            </p>
            <div className="lp-cta">
              <a className="btn btn-primary btn-lg" href="/play">Join your team</a>
              <a className="btn btn-ghost btn-lg" href="#games">How it works</a>
            </div>
            <StatusLine data={data} />
          </div>
          <div className="lp-hero-art">
            <HeroHive />
          </div>
        </section>

        <Standings data={data} />

        <section className="lp-section" id="games" aria-labelledby="games-title">
          <div className="lp-section-head">
            <h2 id="games-title">Three games, played in order</h2>
            <p>The two mini-games are worth up to 100 points each, so no single game decides the night.</p>
          </div>
          <ol className="lp-games">
            <li className="game-robo">
              <RoboArt />
              <div className="g-text">
                <span className="g-num">1</span>
                <h3>RoboPath</h3>
                <p>Write a tiny program so the ghost collects every star without falling off. Six levels, fewer slots each time, loops and colour conditions to master.</p>
                <p className="g-points">10 to 25 points per level, 100 in total</p>
              </div>
            </li>
            <li className="game-phone">
              <PhoneArt />
              <div className="g-text">
                <span className="g-num">2</span>
                <h3>The Locked Phone</h3>
                <p>Rayan, the club president, vanished an hour before kickoff and left his phone behind. Read his messages, photos and mail to open four locks before the battery dies.</p>
                <p className="g-points">20 points per lock, plus a battery bonus</p>
              </div>
            </li>
            <li className="game-huruf">
              <HurufArt />
              <div className="g-text">
                <span className="g-num">3</span>
                <h3>Huruf showdown</h3>
                <p>Once the mini-games close, lower-ranked teams challenge the teams above them. Buzz first, answer for a letter, and link your two sides of the board.</p>
                <p className="g-points">{stake} points for every rank between the two teams</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="lp-section" id="evening" aria-labelledby="evening-title">
          <div className="lp-section-head">
            <h2 id="evening-title">How the evening runs</h2>
            <p>Follow along here or on the big screen. Your team’s device moves to each step on its own.</p>
          </div>
          <ol className="lp-timeline">
            {PHASES.map((p, i) => (
              <li key={p.key} className={i < current ? 'past' : i === current && data ? 'now' : ''} aria-current={i === current && data ? 'step' : undefined}>
                <span className="tl-mark" aria-hidden="true" />
                <h3>{p.title}</h3>
                <p>{p.text}</p>
                {i === current && data && <span className="tl-now">Now</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-section lp-rules" id="rules" aria-labelledby="rules-title">
          <div className="lp-section-head">
            <h2 id="rules-title">The rules that matter</h2>
            <p>Everything is checked and scored by the event server, live.</p>
          </div>
          <div className="lp-rules-grid">
            <dl>
              <div>
                <dt>Fair teams</dt>
                <dd>Teams of one to four players, as even in size as possible. Second- and third-year students are spread first, so every team gets a senior when there are enough.</dd>
              </div>
              <div>
                <dt>Stuck on a stage?</dt>
                <dd>Every RoboPath level and every phone lock can be skipped. You get no points for it and the next one opens. A skipped level can still be solved later.</dd>
              </div>
              <div>
                <dt>Challenges only go up</dt>
                <dd>A team can only challenge a team ranked above it, and each pair plays once. Every team may refuse {denials} {denials === 1 ? 'time' : 'times'}; after that, challenges are accepted automatically.</dd>
              </div>
              <div>
                <dt>One match at a time</dt>
                <dd>Accepted challenges wait in line and are played one after the other on the big screen, so the whole room watches every showdown.</dd>
              </div>
            </dl>
            <figure className="lp-example">
              <figcaption>What a challenge is worth</figcaption>
              <div className="ex-row">
                <span className="ex-rank" style={{ '--c': '#F97316' }}>5th</span>
                <span className="ex-vs">challenges</span>
                <span className="ex-rank" style={{ '--c': '#3B82F6' }}>2nd</span>
              </div>
              <p className="ex-math"><b>3</b> ranks apart × <b>{stake}</b> points</p>
              <p className="ex-total">{3 * stake} points</p>
              <p className="ex-note">The stake is locked when the challenge is accepted. The winner takes it from the loser.</p>
            </figure>
          </div>
        </section>

        <section className="lp-final">
          <div>
            <h2>Got your join code?</h2>
            <p>It is on the big screen next to your team’s name. You can also scan your team’s QR code.</p>
          </div>
          <a className="btn btn-primary btn-lg" href="/play">Join your team</a>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-logos">
          <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD" /></span>
          <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC" /></span>
        </div>
        <p>Organised by N7GD, the game development club, and N7SEC, the security club.</p>
      </footer>
    </div>
  );
}
