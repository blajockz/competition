// Admin control panel: registration, balanced team generation, phase controls,
// score overrides, challenge timer, and the Huruf presenter console.
import { useCallback, useMemo, useState } from 'react';
import { actor } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { serverNow, useLive, useTicker } from '../lib/useLive.js';
import { sfx } from '../lib/audio.js';
import { clock, inkOn, signed, STATUS_LABEL, yearLabel } from '../lib/format.js';
import { BrandBar, CodeLogin, ConnectionBadge, TeamDot, toast, useConfirm } from '../components/common.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import HuroofBoard from '../games/huroof/HuroofBoard.jsx';
import { AnswerClock, phaseText, RoundScore, useMatchSounds } from '../games/huroof/MatchParts.jsx';
import './admin.css';

export default function Admin() {
  const { token, busy, error, signIn, signOut } = useSession('admin');
  const submit = useCallback((code) => signIn({ code }), [signIn]);
  if (!token) {
    return (
      <CodeLogin
        title="Organiser access"
        subtitle="Enter the admin code to manage registration, teams, phases and scores."
        label="Admin code"
        stageTitle="Control room"
        stageText="Run the evening from here: register players, draw teams, start the gauntlet, open the challenge window and present each showdown."
        placeholder="ADM-XXXX-XXXX"
        busy={busy}
        error={error}
        onSubmit={submit}
      />
    );
  }
  return <AdminPanel token={token} onLogout={signOut} />;
}

const TABS = [
  ['event', 'Event'],
  ['people', 'Participants'],
  ['teams', 'Teams'],
  ['scores', 'Scores'],
  ['match', 'Challenges'],
  ['settings', 'Settings'],
];

function AdminPanel({ token, onLogout }) {
  const denied = useCallback(() => onLogout('Admin session ended: log in again.'), [onLogout]);
  const { state, connected } = useLive(token, denied);
  const [tab, setTab] = useState('event');
  const [confirmEl, ask] = useConfirm();
  const send = useMemo(() => actor('admin', token), [token]);
  const [pending, setPending] = useState(false);

  /** Runs an admin action; shows errors; returns the result. */
  const run = useCallback(async (action, payload = {}, okText) => {
    setPending(true);
    const res = await send(action, payload);
    setPending(false);
    if (!res.ok) {
      if (res.status === 401) denied();
      else toast(res.error, 'error');
    } else if (okText) {
      toast(okText, 'good');
    }
    return res;
  }, [send, denied]);

  if (!state) return <div className="page"><BrandBar /><main className="page-main"><p className="muted">Connecting…</p></main></div>;
  const status = state.competition.status;
  const ctx = { state, run, ask, pending };
  const badge = { match: state.match ? '●' : state.queue.length || '', people: state.participants.length, teams: state.teams.length };

  return (
    <div className="page admin-page">
      <BrandBar
        compact
        right={<button type="button" className="btn btn-sm btn-ghost" onClick={() => onLogout()}>Log out</button>}
      >
        <span className="brand-title">Admin</span>
        <span className="pill accent status-pill" data-testid="status">{STATUS_LABEL[status]}</span>
      </BrandBar>
      <nav className="admin-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); sfx.play('click'); }} data-testid={`tab-${id}`}>
            {label}{badge[id] ? <span className="tab-badge">{badge[id]}</span> : null}
          </button>
        ))}
      </nav>
      <main className="page-main admin-main">
        {tab === 'event' && <EventTab {...ctx} goto={setTab} />}
        {tab === 'people' && <PeopleTab {...ctx} />}
        {tab === 'teams' && <TeamsTab {...ctx} />}
        {tab === 'scores' && <ScoresTab {...ctx} />}
        {tab === 'match' && <MatchTab {...ctx} />}
        {tab === 'settings' && <SettingsTab {...ctx} />}
      </main>
      {confirmEl}
      <ConnectionBadge connected={connected} />
    </div>
  );
}

/* =============================================================== EVENT */
const STEPS = ['REGISTRATION', 'LOBBY_LOCKED', 'MAIN_GAMES', 'CHALLENGE_WINDOW', 'FINISHED'];

function EventTab({ state, run, ask, pending, goto }) {
  useTicker(500);
  const c = state.competition;
  const status = c.status;
  const [minutes, setMinutes] = useState(c.settings.challengeMinutes);
  const now = serverNow(state);
  const done = state.teams.filter((t) => t.currentGameIndex >= 2).length;
  const claimed = state.teams.filter((t) => t.claimed).length;
  const stepIndex = STEPS.indexOf(status === 'COUNTDOWN' ? 'MAIN_GAMES' : status);

  return (
    <div className="stack">
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>
            <span>{i + 1}</span>{STATUS_LABEL[s]}
          </li>
        ))}
      </ol>

      <div className="admin-grid">
        <section className="card stack">
          <h2>Next step</h2>
          {status === 'REGISTRATION' && (
            <>
              <p className="muted">{state.participants.length} participants registered. Add everyone, then generate balanced teams.</p>
              <div className="row">
                <button type="button" className="btn" onClick={() => goto('people')}>Manage participants</button>
                <button type="button" className="btn btn-primary" disabled={pending || state.participants.length < 1}
                  onClick={() => run('generateTeams', {}, 'Teams generated')} data-testid="generate">Generate teams</button>
              </div>
            </>
          )}
          {status === 'LOBBY_LOCKED' && (
            <>
              <p className="muted">{claimed}/{state.teams.length} teams logged in. Teams can rename themselves now. Player screens stay locked until you begin.</p>
              <div className="row">
                <button type="button" className="btn btn-primary btn-lg" disabled={pending}
                  onClick={async () => {
                    const missing = state.teams.length - claimed;
                    if (missing > 0 && !(await ask({ title: 'Begin the competition?', text: `${missing} team(s) have not logged in yet. They can still join after the start.`, confirmLabel: 'Begin' }))) return;
                    run('beginCompetition', {}, 'Countdown started!');
                  }} data-testid="begin">▶ Begin competition</button>
                <button type="button" className="btn" onClick={() => goto('teams')}>Review teams</button>
              </div>
            </>
          )}
          {status === 'COUNTDOWN' && <p className="countdown-note">Countdown running: {Math.max(0, Math.ceil((c.countdownEndsAt - now) / 1000))}…</p>}
          {status === 'MAIN_GAMES' && (
            <>
              <p className="muted">{done}/{state.teams.length} teams finished both mini-games. Opening the challenge phase ends the mini-games for everyone (teams keep their points).</p>
              <div className="row">
                <label className="field inline">
                  <span>Challenge window (minutes)</span>
                  <input type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </label>
                <button type="button" className="btn btn-gold btn-lg" disabled={pending}
                  onClick={async () => {
                    if (done < state.teams.length && !(await ask({ title: 'Open the challenge phase?', text: `${state.teams.length - done} team(s) are still playing. Their games stop now and they keep the points earned so far.`, confirmLabel: 'Open challenges', danger: true }))) return;
                    run('openChallengeWindow', { minutes: Number(minutes) }, 'Challenge phase open');
                  }} data-testid="open-challenges">⚔ Open challenge phase</button>
              </div>
            </>
          )}
          {status === 'CHALLENGE_WINDOW' && (
            <>
              <p className="big-timer mono">{clock(Math.max(0, (c.challengeTimerEnd - now) / 1000))}</p>
              <p className="muted">{c.windowOpen ? 'Window open: teams can send challenges.' : 'Window closed: finish the queued matches, then end the competition.'} {state.queue.length} queued{state.match ? ', 1 being played' : ''}.</p>
              <div className="row">
                {[-5, -1, 1, 5].map((m) => (
                  <button key={m} type="button" className="btn btn-sm" disabled={pending} onClick={() => run('extendChallengeWindow', { minutes: m })}>{m > 0 ? `+${m}` : m} min</button>
                ))}
                <button type="button" className="btn btn-primary" onClick={() => goto('match')}>Open the presenter console</button>
              </div>
            </>
          )}
          {(status === 'MAIN_GAMES' || status === 'CHALLENGE_WINDOW') && (
            <div className="row">
              <button type="button" className="btn btn-danger" disabled={pending}
                onClick={async () => {
                  const extra = state.match || state.queue.length ? ' The live match and the queue are cancelled (no points).' : '';
                  if (await ask({ title: 'End the competition?', text: `Scores are frozen and the podium is shown.${extra}`, confirmLabel: 'End competition', danger: true })) run('finishCompetition', {}, 'Competition finished');
                }} data-testid="finish">■ End competition</button>
            </div>
          )}
          {status === 'FINISHED' && <p className="muted">The competition is over. The big screen shows the podium.</p>}
        </section>

        <section className="card">
          <div className="card-head"><h2>Leaderboard</h2></div>
          {state.teams.length ? (
            <Leaderboard leaderboard={state.leaderboard} teams={state.teams} rowHeight={50} gap={6} compact
              detail={(t) => <span>RoboPath {t.games.robopath.points} · Phone {t.games.locked_phone.points} · Challenges {signed(t.challengePoints)}</span>} />
          ) : <p className="muted">No teams yet.</p>}
        </section>

        <section className="card">
          <h2>Activity</h2>
          <ul className="admin-feed">
            {state.feed.length === 0 && <li className="muted">Nothing yet.</li>}
            {state.feed.map((f) => <li key={f.id}><span className="faint mono">{new Date(f.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {f.text}</li>)}
          </ul>
        </section>

        <section className="card stack">
          <h2>Danger zone</h2>
          <p className="muted small">Reset clears teams, scores and challenges. Participants can be kept.</p>
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={pending}
              onClick={async () => {
                if (await ask({ title: 'Reset the competition?', text: 'Teams, scores, games and challenges are deleted. The participant list is kept.', confirmLabel: 'Reset, keep participants', danger: true })) run('resetCompetition', { keepParticipants: true }, 'Competition reset');
              }}>Reset (keep participants)</button>
            <button type="button" className="btn btn-danger" disabled={pending}
              onClick={async () => {
                if (await ask({ title: 'Delete everything?', text: 'Participants, teams, scores and challenges are all deleted. This cannot be undone.', confirmLabel: 'Delete everything', danger: true })) run('resetCompetition', { keepParticipants: false }, 'Everything deleted');
              }}>Reset everything</button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ========================================================= PARTICIPANTS */
function PeopleTab({ state, run, ask, pending }) {
  const editable = state.competition.status === 'REGISTRATION';
  const [form, setForm] = useState({ fullName: '', filiere: '', year: '1' });
  const [bulk, setBulk] = useState('');
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('');
  const counts = [1, 2, 3].map((y) => state.participants.filter((p) => p.year === y).length);
  const teamsById = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  const list = state.participants.filter((p) => !filter || `${p.fullName} ${p.filiere}`.toLowerCase().includes(filter.toLowerCase()));

  async function add(e) {
    e.preventDefault();
    const res = await run('addParticipant', { ...form, year: Number(form.year) });
    if (res.ok) {
      setForm((f) => ({ ...f, fullName: '' }));
      sfx.play('score');
    }
  }
  async function importText() {
    const res = await run('importParticipants', { text: bulk });
    if (res.ok) {
      toast(`${res.added} participants added${res.errors?.length ? ` (${res.errors.length} lines skipped)` : ''}`, 'good');
      if (res.errors?.length) toast(res.errors.slice(0, 3).join(' · '), 'error');
      setBulk('');
    }
  }
  function loadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 60000) {
      toast('The file is too big (60 KB max)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBulk(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="stack">
      {!editable && <div className="notice">Teams are generated: the list is locked. Go back to registration (Teams tab) to change it.</div>}
      <div className="admin-grid">
        <form className="card stack" onSubmit={add}>
          <h2>Add a participant</h2>
          <label className="field"><span>Full name</span>
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} maxLength={80} required disabled={!editable} data-testid="p-name" />
          </label>
          <label className="field"><span>Filière (track / major)</span>
            <input value={form.filiere} onChange={(e) => setForm({ ...form, filiere: e.target.value })} maxLength={80} disabled={!editable} list="filieres" data-testid="p-filiere" />
          </label>
          <datalist id="filieres">{[...new Set(state.participants.map((p) => p.filiere).filter(Boolean))].map((f) => <option key={f} value={f} />)}</datalist>
          <label className="field"><span>Academic year</span>
            <select value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} disabled={!editable} data-testid="p-year">
              <option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={!editable || pending || !form.fullName.trim()}>Add</button>
        </form>

        <section className="card stack">
          <h2>Import (CSV / paste)</h2>
          <p className="muted small">One person per line: <span className="mono">Full Name, Filière, Year</span>. Commas, semicolons or tabs. A header line is skipped. Year: 1, 2 or 3 (“2nd Year”, “3ème” work too).</p>
          <textarea className="input" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Amine Benali, Génie Informatique, 3\nSara El Idrissi, Génie Civil, 1'} disabled={!editable} data-testid="p-bulk" />
          <div className="row">
            <label className="btn btn-sm">Load a .csv file<input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden onChange={loadFile} disabled={!editable} /></label>
            <button type="button" className="btn btn-primary" disabled={!editable || pending || !bulk.trim()} onClick={importText} data-testid="p-import">Import</button>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Participants ({state.participants.length})</h2>
          <span className="muted small">1st: {counts[0]} · 2nd: {counts[1]} · 3rd: {counts[2]}</span>
          <input className="input search" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {editable && state.participants.length > 0 && (
            <button type="button" className="btn btn-sm btn-danger" onClick={async () => {
              if (await ask({ title: 'Remove all participants?', confirmLabel: 'Remove all', danger: true })) run('clearParticipants');
            }}>Remove all</button>
          )}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Filière</th><th>Year</th><th>Team</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (editing?.id === p.id ? (
                <tr key={p.id}>
                  <td><input className="input" value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} /></td>
                  <td><input className="input" value={editing.filiere} onChange={(e) => setEditing({ ...editing, filiere: e.target.value })} /></td>
                  <td><select className="input" value={editing.year} onChange={(e) => setEditing({ ...editing, year: Number(e.target.value) })}>
                    <option value={1}>1st</option><option value={2}>2nd</option><option value={3}>3rd</option></select></td>
                  <td />
                  <td className="row end">
                    <button type="button" className="btn btn-sm btn-primary" onClick={async () => { const r = await run('updateParticipant', editing); if (r.ok) setEditing(null); }}>Save</button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <td><b>{p.fullName}</b></td>
                  <td>{p.filiere || <span className="faint">—</span>}</td>
                  <td><span className={`pill ${p.year > 1 ? 'accent' : ''}`}>{yearLabel(p.year)}</span></td>
                  <td>{p.teamId && teamsById[p.teamId] ? <span className="row"><TeamDot color={teamsById[p.teamId].colorHex} />{teamsById[p.teamId].name}</span> : <span className="faint">—</span>}</td>
                  <td className="row end">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing({ id: p.id, fullName: p.fullName, filiere: p.filiere, year: p.year })}>Edit</button>
                    {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => run('removeParticipant', { id: p.id })} aria-label={`Remove ${p.fullName}`}>✕</button>}
                  </td>
                </tr>
              )))}
              {list.length === 0 && <tr><td colSpan={5} className="muted">No participant.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ================================================================ TEAMS */
function TeamsTab({ state, run, ask, pending }) {
  const status = state.competition.status;
  const lobby = status === 'LOBBY_LOCKED';
  const people = state.participants;
  const [names, setNames] = useState({});

  if (!state.teams.length) {
    return (
      <section className="card stack">
        <h2>No teams yet</h2>
        <p className="muted">Register participants, then generate teams: sizes are balanced (1 to 4 members, as even as possible) and 2nd/3rd-year students are spread first so each team gets a senior when possible.</p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={pending || status !== 'REGISTRATION' || !people.length} onClick={() => run('generateTeams', {}, 'Teams generated')}>Generate teams</button>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">{state.teams.length} teams · {people.length} participants{lobby ? ' · you can move members and rename teams until the start.' : ''}</p>
        {lobby && (
          <div className="row">
            <button type="button" className="btn" disabled={pending} onClick={async () => {
              if (await ask({ title: 'Generate new teams?', text: 'Teams, names, colours and join codes are made again. Teams already logged in must log in with their new code.', confirmLabel: 'Regenerate', danger: true })) run('generateTeams', {}, 'New teams generated');
            }}>↻ Regenerate</button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={async () => {
              if (await ask({ title: 'Back to registration?', text: 'Teams are deleted so you can change the participant list.', confirmLabel: 'Back to registration', danger: true })) run('backToRegistration');
            }}>← Back to registration</button>
          </div>
        )}
      </div>
      <div className="team-admin-grid">
        {state.teams.map((t) => {
          const members = people.filter((p) => p.teamId === t.id);
          const draft = names[t.id] ?? t.name;
          return (
            <section key={t.id} className="card team-admin" style={{ '--c': t.colorHex }}>
              <header style={{ background: t.colorHex, color: inkOn(t.colorHex) }}>
                <b>{t.name}</b>
                <span className="mono">{t.joinCode}</span>
              </header>
              <div className="stack" style={{ padding: 12 }}>
                <div className="row small">
                  <span className={`pill ${t.claimed ? 'good' : ''}`}>{t.claimed ? 'Logged in' : 'Not logged in'}</span>
                  <span className="pill">#{t.rank ?? '—'} · {t.score} pts</span>
                  {t.name !== t.placeholderName && <span className="faint">was {t.placeholderName}</span>}
                </div>
                <ul className="tm-members">
                  {members.map((p) => (
                    <li key={p.id}>
                      <span><b>{p.fullName}</b> <small className="muted">{p.filiere} · {yearLabel(p.year)}</small></span>
                      {lobby && (
                        <select className="input input-sm" value={t.id} aria-label={`Move ${p.fullName}`} onChange={(e) => run('moveParticipant', { participantId: p.id, teamId: e.target.value })}>
                          {state.teams.map((x) => <option key={x.id} value={x.id}>{x.id === t.id ? 'Move to…' : x.name}</option>)}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
                <form className="row" onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await run('renameTeam', { teamId: t.id, name: draft }, 'Name saved');
                  if (r.ok) setNames((n) => { const c = { ...n }; delete c[t.id]; return c; });
                }}>
                  <input className="input grow" value={draft} maxLength={24} onChange={(e) => setNames({ ...names, [t.id]: e.target.value })} aria-label="Team name" />
                  <button type="submit" className="btn btn-sm" disabled={draft.trim() === t.name || draft.trim().length < 2}>Rename</button>
                </form>
                <div className="row">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={async () => {
                    if (await ask({ title: `New join code for ${t.name}?`, text: 'The old code stops working and the team’s devices are logged out.', confirmLabel: 'New code' })) run('newJoinCode', { teamId: t.id }, 'New join code created');
                  }}>New join code</button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* =============================================================== SCORES */
function ScoresTab({ state, run, pending }) {
  const [form, setForm] = useState({ teamId: '', points: '', reason: '' });
  const byId = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  async function submit(e) {
    e.preventDefault();
    const r = await run('adjustScore', { teamId: form.teamId, points: Number(form.points), reason: form.reason }, 'Score adjusted');
    if (r.ok) setForm({ ...form, points: '', reason: '' });
  }
  return (
    <div className="admin-grid">
      <section className="card">
        <h2>Scores</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Team</th><th className="num">RoboPath</th><th className="num">Phone</th><th className="num">Challenges</th><th className="num">Admin</th><th className="num">Total</th></tr></thead>
            <tbody>
              {state.leaderboard.map((r) => {
                const t = byId[r.id];
                const admin = state.adjustments.filter((a) => a.teamId === r.id && a.source === 'admin').reduce((s, a) => s + a.points, 0);
                const ch = t.challengePoints - admin;
                return (
                  <tr key={r.id}>
                    <td>{r.rank}</td>
                    <td><span className="row"><TeamDot color={t.colorHex} />{t.name}</span></td>
                    <td className="num">{t.games.robopath.points} <small className="faint">({t.games.robopath.solved}✓ {t.games.robopath.skipped}↷)</small></td>
                    <td className="num">{t.games.locked_phone.points} <small className="faint">({t.games.locked_phone.stage}/4)</small></td>
                    <td className="num">{signed(ch)}</td>
                    <td className="num">{signed(admin)}</td>
                    <td className="num"><b>{r.score}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint small" style={{ marginTop: 8 }}>Each mini-game is worth 0–100 points so no game weighs more than another.</p>
      </section>

      <form className="card stack" onSubmit={submit}>
        <h2>Score override</h2>
        <label className="field"><span>Team</span>
          <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} required>
            <option value="">Choose a team…</option>
            {state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Points (negative to remove)</span>
          <input type="number" step={1} value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} required />
        </label>
        <label className="field"><span>Reason (shown on the big screen)</span>
          <input value={form.reason} maxLength={120} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Bonus: best team spirit" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending || !form.teamId || !Number(form.points)}>Apply</button>

        <h3>History</h3>
        <ul className="adj-list">
          {state.adjustments.length === 0 && <li className="muted">No adjustment yet.</li>}
          {[...state.adjustments].reverse().map((a) => (
            <li key={a.id}>
              <TeamDot color={byId[a.teamId]?.colorHex} />
              <span className="grow">{byId[a.teamId]?.name}: <b>{signed(a.points)}</b> <small className="muted">{a.reason}</small></span>
              {a.source === 'admin' ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => run('removeAdjustment', { id: a.id })} aria-label="Undo">Undo</button>
              ) : <span className="pill">challenge</span>}
            </li>
          ))}
        </ul>
      </form>
    </div>
  );
}

/* ============================================================ CHALLENGES */
function MatchTab({ state, run, ask, pending }) {
  const byId = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  const status = state.competition.status;
  const history = state.challenges.filter((c) => ['COMPLETED', 'DENIED', 'EXPIRED', 'CANCELLED', 'ABORTED'].includes(c.status)).slice().reverse();
  const pendingList = state.challenges.filter((c) => c.status === 'PENDING');
  return (
    <div className="stack">
      {status !== 'CHALLENGE_WINDOW' && !state.match && <div className="notice">The challenge phase is not open. Open it from the Event tab once the mini-games are done.</div>}
      {state.match ? <Presenter state={state} run={run} ask={ask} pending={pending} /> : (
        status === 'CHALLENGE_WINDOW' && <section className="card"><h2>No match being played</h2><p className="muted">The next accepted challenge starts here automatically.</p></section>
      )}
      <div className="admin-grid">
        <section className="card">
          <h2>Queue ({state.queue.length})</h2>
          <ul className="adj-list">
            {state.queue.length === 0 && <li className="muted">Empty.</li>}
            {state.queue.map((q) => (
              <li key={q.id}>
                <span className="mono">#{q.position}</span>
                <span className="grow">{byId[q.challengerTeamId]?.name} <span className="faint">vs</span> {byId[q.defenderTeamId]?.name} · ±{q.lockedPointStake}{q.autoAccepted ? ' · auto' : ''}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { if (await ask({ title: 'Cancel this match?', confirmLabel: 'Cancel match', danger: true })) run('cancelChallenge', { id: q.id }); }}>Cancel</button>
              </li>
            ))}
          </ul>
          <h3 style={{ marginTop: 14 }}>Waiting for an answer</h3>
          <ul className="adj-list">
            {pendingList.length === 0 && <li className="muted">None.</li>}
            {pendingList.map((p) => (
              <li key={p.id}>
                <span className="grow">{byId[p.challengerTeamId]?.name} → {byId[p.defenderTeamId]?.name}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => run('cancelChallenge', { id: p.id })}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>History</h2>
          <ul className="adj-list">
            {history.length === 0 && <li className="muted">Nothing yet.</li>}
            {history.map((h) => (
              <li key={h.id}>
                <span className={`pill ${h.status === 'COMPLETED' ? 'good' : h.status === 'DENIED' ? 'warn' : ''}`}>{h.status.toLowerCase()}</span>
                <span className="grow">{byId[h.challengerTeamId]?.name} vs {byId[h.defenderTeamId]?.name}
                  {h.status === 'COMPLETED' && <> · <b>{byId[h.winnerTeamId]?.name}</b> won ±{h.lockedPointStake}</>}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Presenter({ state, run, ask, pending }) {
  const m = state.match;
  const b = m.board;
  const A = state.teams.find((t) => t.id === m.challenge.challengerTeamId);
  const B = state.teams.find((t) => t.id === m.challenge.defenderTeamId);
  const names = [A?.name, B?.name];
  const colors = [A?.colorHex, B?.colorHex];
  const cmd = (type, extra = {}) => run('matchAct', { command: { type, ...extra } });
  useMatchSounds(b);
  const [ownerMode, setOwnerMode] = useState(false);

  const onCell = (i) => {
    if (ownerMode) {
      const o = b.cells[i].o;
      cmd('setOwner', { i, o: o === -1 ? 0 : o === 0 ? 1 : -1 });
      return;
    }
    if (b.cells[i].o !== -1) return;
    cmd('pick', { i });
  };

  const inQuestion = b.phase === 'question' || b.phase === 'answer' || b.phase === 'missed';
  return (
    <section className="card presenter">
      <div className="card-head">
        <h2>Live match · presenter</h2>
        <div className="row">
          <span className="team-tag" style={{ background: A?.colorHex, color: inkOn(A?.colorHex) }}>{A?.name} ↔</span>
          <RoundScore board={b} colors={colors} />
          <span className="team-tag" style={{ background: B?.colorHex, color: inkOn(B?.colorHex) }}>{B?.name} ↕</span>
          <span className="pill">±{m.challenge.lockedPointStake} pts</span>
        </div>
      </div>
      <div className="presenter-grid">
        <div className="presenter-board">
          <HuroofBoard board={b} colors={colors} names={names} onCell={b.phase === 'lobby' || b.phase === 'roundOver' || b.phase === 'matchOver' ? undefined : onCell} />
          <label className="check small" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={ownerMode} onChange={(e) => setOwnerMode(e.target.checked)} /> Fix mode: tap a cell to change its owner
          </label>
        </div>
        <div className="stack presenter-side">
          <p className="ms-phase">{phaseText(b, names)}</p>
          {b.phase === 'lobby' && <button type="button" className="btn btn-primary btn-lg" onClick={() => cmd('start')} disabled={pending} data-testid="hf-start">▶ Start the match</button>}
          {b.phase === 'pick' && <p className="muted">Ask {names[b.chooser]} for a letter, then tap it on the board.</p>}

          {inQuestion && b.q && (
            <div className="q-card">
              <div className="row between"><span className="ms-letter small-letter">{b.cells[b.sel]?.l}</span><AnswerClock board={b} offset={state.offset} /></div>
              <p className="huruf-q">{b.q.q}</p>
              <p className="huruf-a">{b.q.a}</p>
              <small className="faint">Answer visible only here.{b.reveal ? ' Shown on the big screen.' : ''}</small>
            </div>
          )}
          {inQuestion && !b.q && <p className="form-error">No question for this letter.</p>}

          {b.phase === 'question' && (
            <div className="row">
              {[0, 1].map((i) => (
                <button key={i} type="button" className="btn" disabled={b.tried[i]} onClick={() => cmd('give', { team: i })} style={{ borderColor: colors[i] }}>
                  Give turn to {names[i]}
                </button>
              ))}
            </div>
          )}
          {b.phase === 'answer' && (
            <div className="row">
              <span className="pill accent">{names[b.turn]} answers</span>
              <button type="button" className="btn btn-good btn-lg" onClick={() => cmd('judge', { correct: true })} data-testid="hf-correct">✓ Correct</button>
              <button type="button" className="btn btn-danger btn-lg" onClick={() => cmd('judge', { correct: false })} data-testid="hf-wrong">✗ Wrong</button>
            </div>
          )}
          {inQuestion && (
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => cmd('swap')}>New question</button>
              <button type="button" className="btn btn-sm" onClick={() => cmd('unpick')}>Other letter</button>
              <button type="button" className="btn btn-sm" onClick={() => cmd('reveal')}>{b.reveal ? 'Hide answer' : 'Show answer on screen'}</button>
              {b.phase === 'answer' && <button type="button" className="btn btn-sm" onClick={() => cmd('timer', { cmd: b.timer ? 'stop' : 'start' })}>{b.timer ? 'Stop clock' : 'Restart clock'}</button>}
            </div>
          )}
          {b.phase === 'roundOver' && <button type="button" className="btn btn-primary btn-lg" onClick={() => cmd('nextRound')}>Next round</button>}
          {b.phase === 'matchOver' && (
            <button type="button" className="btn btn-gold btn-lg" disabled={pending} onClick={() => run('settleMatch', {}, 'Points transferred')} data-testid="hf-settle">
              🏆 Confirm: {names[b.matchWinner]} wins ±{m.challenge.lockedPointStake}
            </button>
          )}
          <div className="row presenter-tools">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => cmd('undo')} disabled={!b.undo}>↶ Undo</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={async () => {
              const w = await pickWinner(ask, names);
              if (w !== null) run('settleMatch', { winnerTeamId: w === 0 ? A.id : B.id }, 'Result forced');
            }}>Force a winner…</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={async () => {
              if (await ask({ title: 'Cancel this match?', text: 'No points are exchanged. The next match in the queue starts.', confirmLabel: 'Cancel match', danger: true })) run('abortMatch', { reason: 'cancelled by the admin' });
            }}>Cancel match</button>
          </div>
        </div>
      </div>
    </section>
  );
}

async function pickWinner(ask, names) {
  if (await ask({ title: `Does ${names[0]} win?`, text: `Choose “${names[0]} wins”, or cancel to choose ${names[1]}.`, confirmLabel: `${names[0]} wins` })) return 0;
  if (await ask({ title: `Does ${names[1]} win?`, confirmLabel: `${names[1]} wins` })) return 1;
  return null;
}

/* ============================================================= SETTINGS */
function SettingsTab({ state, run, pending }) {
  const c = state.competition;
  const s = c.settings;
  const [f, setF] = useState(() => ({
    baseChallengeStake: c.baseChallengeStake,
    maxDenials: c.maxDenials,
    responseTimeoutSec: s.responseTimeoutSec,
    challengeMinutes: s.challengeMinutes,
    lockedBatteryMinutes: s.lockedBatteryMinutes,
    size: s.huroof.size,
    roundsToWin: s.huroof.roundsToWin,
    answerTime: s.huroof.answerTime,
    showQuestion: s.huroof.showQuestion,
    extraBank: s.huroof.extraBank,
  }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save(e) {
    e.preventDefault();
    run('updateSettings', {
      settings: {
        baseChallengeStake: Number(f.baseChallengeStake),
        maxDenials: Number(f.maxDenials),
        responseTimeoutSec: Number(f.responseTimeoutSec),
        challengeMinutes: Number(f.challengeMinutes),
        lockedBatteryMinutes: Number(f.lockedBatteryMinutes),
        huroof: { size: Number(f.size), roundsToWin: Number(f.roundsToWin), answerTime: Number(f.answerTime), showQuestion: f.showQuestion, extraBank: f.extraBank },
      },
    }, 'Settings saved');
  }
  return (
    <form className="admin-grid" onSubmit={save}>
      <section className="card stack">
        <h2>Challenges</h2>
        <label className="field"><span>Base stake (points × rank difference)</span><input type="number" min={0} max={1000} value={f.baseChallengeStake} onChange={set('baseChallengeStake')} /></label>
        <label className="field"><span>Denials per team</span><input type="number" min={0} max={10} value={f.maxDenials} onChange={set('maxDenials')} /></label>
        <label className="field"><span>Seconds to answer a challenge before it is accepted automatically</span><input type="number" min={15} max={300} value={f.responseTimeoutSec} onChange={set('responseTimeoutSec')} /></label>
        <label className="field"><span>Default challenge window (minutes)</span><input type="number" min={1} max={120} value={f.challengeMinutes} onChange={set('challengeMinutes')} /></label>
      </section>
      <section className="card stack">
        <h2>Huruf matches</h2>
        <label className="field"><span>Board size</span><select value={f.size} onChange={set('size')}><option value={4}>4 × 4 (quick)</option><option value={5}>5 × 5</option></select></label>
        <label className="field"><span>Rounds to win</span><select value={f.roundsToWin} onChange={set('roundsToWin')}><option value={1}>1 (single round)</option><option value={2}>2 (best of 3)</option><option value={3}>3 (best of 5)</option></select></label>
        <label className="field"><span>Answer clock</span><select value={f.answerTime} onChange={set('answerTime')}>{[0, 5, 8, 12, 20].map((v) => <option key={v} value={v}>{v ? `${v} s` : 'Off'}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={f.showQuestion} onChange={set('showQuestion')} /> Show the question on the big screen</label>
        <label className="check"><input type="checkbox" checked={f.extraBank} onChange={set('extraBank')} /> Use the extra question bank</label>
        <p className="faint small">Changes apply to the next match.</p>
      </section>
      <section className="card stack">
        <h2>The Locked Phone</h2>
        <label className="field"><span>Minutes for a full battery to drain on its own</span><input type="number" min={20} max={240} value={f.lockedBatteryMinutes} onChange={set('lockedBatteryMinutes')} /></label>
        <p className="faint small">Applies to phones turned on after the change.</p>
        <button type="submit" className="btn btn-primary" disabled={pending}>Save settings</button>
      </section>
    </form>
  );
}
