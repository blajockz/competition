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
import { HfPresenter } from '../games/huroof/Original.jsx';
import { exportParticipants } from '../lib/excel.js';
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
        stageText="Run the evening from here: registration and check-in, team draw, the 1:30 mini-games, the challenge window and every Huruf showdown."
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
  const confirmed = state.participants.filter((p) => p.checkedInAt).length;
  const badge = { match: state.match ? '●' : state.queue.length || '', people: state.participants.length ? `${confirmed}/${state.participants.length}` : '', teams: state.teams.length };

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

/** Quiz points once the quiz is over; progress while it is played. */
function quizCell(t) {
  const q = t.games.quiz;
  if (!q) return '–';
  if (['completed', 'abandoned'].includes(q.status)) return q.points;
  if (q.status === 'playing') return `${q.answered}/${q.total}…`;
  return '–';
}

/* =============================================================== EVENT */
const STEPS = ['REGISTRATION', 'LOBBY_LOCKED', 'MAIN_GAMES', 'CHALLENGE_WINDOW', 'FINISHED'];

function EventTab({ state, run, ask, pending, goto }) {
  useTicker(500);
  const c = state.competition;
  const status = c.status;
  const [minutes, setMinutes] = useState(c.settings.challengeMinutes);
  const now = serverNow(state);
  const done = state.teams.filter((t) => t.currentGameIndex >= 3).length;
  const reg = state.registration;
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
              <div className="kpis">
                <div><b className="mono">{reg.registered}</b><small>registered</small></div>
                <div className="good"><b className="mono">{reg.confirmed}</b><small>confirmed present</small></div>
              </div>
              <p className="muted">Students register at <span className="mono">/register</span>. On event day, open check-in: the big screen shows a QR code that changes every minute. Teams are drawn from <b>confirmed</b> players only.</p>
              <div className="switch-list">
                <Switch on={c.registrationOpen} label="Online registration" hint={c.registrationOpen ? 'Anyone with the link can register' : 'Closed (on-site registration still works with the check-in code)'}
                  onChange={(v) => run('setRegistration', { registrationOpen: v }, v ? 'Registration open' : 'Registration closed')} testid="sw-registration" />
                <Switch on={c.checkinOpen} label="Check-in (QR on the big screen)" hint={c.checkinOpen ? 'Players confirm their presence now' : 'Open it when people are in the room'}
                  onChange={(v) => run('setRegistration', { checkinOpen: v }, v ? 'Check-in open' : 'Check-in closed')} testid="sw-checkin" />
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={() => goto('people')}>Participants</button>
                <button type="button" className="btn btn-primary" disabled={pending || reg.confirmed < 1}
                  onClick={async () => {
                    const missing = reg.registered - reg.confirmed;
                    if (missing > 0 && !(await ask({ title: `Generate teams from ${reg.confirmed} confirmed players?`, text: `${missing} registered ${missing === 1 ? 'person has' : 'people have'} not confirmed and will not be placed in a team. Check-in closes.`, confirmLabel: 'Generate teams' }))) return;
                    run('generateTeams', {}, 'Teams generated');
                  }} data-testid="generate">Generate teams ({reg.confirmed})</button>
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
              <p className="big-timer mono" data-testid="games-clock">{clock(Math.max(0, ((c.mainGamesEndsAt || now) - now) / 1000))}</p>
              <p className="muted">{done}/{state.teams.length} teams finished the three mini-games. The challenge phase opens <b>by itself</b> when this clock reaches zero ({c.mainGamesMinutes} min after the start). Opening it earlier ends the mini-games for everyone (teams keep their points).</p>
              <div className="row">
                {[-15, -5, 5, 15].map((m) => (
                  <button key={m} type="button" className="btn btn-sm" disabled={pending} onClick={() => run('extendMainGames', { minutes: m })}>{m > 0 ? `+${m}` : m} min</button>
                ))}
              </div>
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
              detail={(t) => <span>RoboPath {t.games.robopath.points} · Phone {t.games.locked_phone.points} · Quiz {quizCell(t)} · Challenges {signed(t.challengePoints)}</span>} />
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
const FILTERS = [
  ['all', 'All'],
  ['confirmed', 'Confirmed'],
  ['waiting', 'Not confirmed'],
  ['self', 'Self-registered'],
];

function Switch({ on, label, hint, onChange, testid }) {
  return (
    <label className={`switch ${on ? 'on' : ''}`}>
      <span className="switch-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={!!on} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <i aria-hidden="true" />
    </label>
  );
}

const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

function PeopleTab({ state, run, ask, pending }) {
  const c = state.competition;
  const editable = c.status === 'REGISTRATION';
  const [form, setForm] = useState({ fullName: '', phone: '', filiere: '', year: '1' });
  const [bulk, setBulk] = useState('');
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all');
  const [exporting, setExporting] = useState(false);
  const people = state.participants;
  const confirmed = people.filter((p) => p.checkedInAt).length;
  const teamsById = Object.fromEntries(state.teams.map((t) => [t.id, t]));
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = people
    .filter((p) => (view === 'confirmed' ? p.checkedInAt : view === 'waiting' ? !p.checkedInAt : view === 'self' ? p.source === 'self' : true))
    .filter((p) => !q || `${p.fullName} ${p.filiere}`.toLowerCase().includes(q) || (digits.length >= 3 && (p.phone || '').replace(/\D/g, '').includes(digits)))
    .slice()
    .sort((a, b) => (b.checkedInAt || 0) - (a.checkedInAt || 0) || b.createdAt - a.createdAt);
  const counts = { all: people.length, confirmed, waiting: people.length - confirmed, self: people.filter((p) => p.source === 'self').length };
  const years = [1, 2, 3].map((y) => people.filter((p) => p.year === y && p.checkedInAt).length);

  async function add(e) {
    e.preventDefault();
    const res = await run('addParticipant', { ...form, year: Number(form.year) });
    if (res.ok) {
      setForm((f) => ({ ...f, fullName: '', phone: '' }));
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
  async function exportXlsx() {
    setExporting(true);
    try {
      await exportParticipants(people, state.teams);
      toast('Excel file downloaded', 'good');
    } catch {
      toast('The Excel export failed. Try again.', 'error');
    }
    setExporting(false);
  }

  return (
    <div className="stack">
      {!editable && <div className="notice">Teams are generated: the list is locked. Go back to registration (Teams tab) to change it. You can still export it.</div>}

      <section className="card people-head">
        <div className="kpis">
          <div><b className="mono">{people.length}</b><small>registered</small></div>
          <div className="good"><b className="mono" data-testid="kpi-confirmed">{confirmed}</b><small>confirmed present</small></div>
          <div><b className="mono">{people.length - confirmed}</b><small>not confirmed</small></div>
          <div><b className="mono">{years.join(' · ')}</b><small>confirmed by year (1st · 2nd · 3rd)</small></div>
        </div>
        <div className="switch-list">
          <Switch on={c.registrationOpen} label="Online registration" hint="/register form" onChange={(v) => run('setRegistration', { registrationOpen: v })} />
          <Switch on={c.checkinOpen} label="Check-in" hint="QR on the big screen" onChange={(v) => run('setRegistration', { checkinOpen: v })} />
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={exportXlsx} disabled={exporting || !people.length} data-testid="export-xlsx">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            {exporting ? 'Preparing…' : 'Export Excel'}
          </button>
          {editable && people.length > 0 && (
            <>
              <button type="button" className="btn" disabled={pending || confirmed === people.length} onClick={async () => {
                if (await ask({ title: 'Mark everyone as present?', text: `${people.length - confirmed} people will be confirmed without scanning the QR code.`, confirmLabel: 'Mark all present' })) run('markAllPresent', { present: true }, 'Everyone is confirmed');
              }}>Mark all present</button>
              <button type="button" className="btn btn-ghost" disabled={pending || confirmed === 0} onClick={async () => {
                if (await ask({ title: 'Clear every confirmation?', text: 'Everyone goes back to “not confirmed”. They can scan the check-in QR again.', confirmLabel: 'Clear confirmations', danger: true })) run('markAllPresent', { present: false });
              }}>Clear confirmations</button>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="seg-tabs" role="tablist">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
                {label}<span>{counts[id]}</span>
              </button>
            ))}
          </div>
          <input className="input search" placeholder="Search a name, field or phone…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="table people-table">
            <thead><tr><th>Present</th><th>Name</th><th>Phone</th><th>Field</th><th>Year</th><th>Source</th><th>Team</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (editing?.id === p.id ? (
                <tr key={p.id} className="editing">
                  <td />
                  <td><input className="input" value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} aria-label="Full name" /></td>
                  <td><input className="input" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} aria-label="Phone" inputMode="tel" /></td>
                  <td><input className="input" value={editing.filiere} onChange={(e) => setEditing({ ...editing, filiere: e.target.value })} aria-label="Field" /></td>
                  <td><select className="input" value={editing.year} onChange={(e) => setEditing({ ...editing, year: Number(e.target.value) })} aria-label="Year">
                    <option value={1}>1st</option><option value={2}>2nd</option><option value={3}>3rd</option></select></td>
                  <td colSpan={2} />
                  <td className="row end">
                    <button type="button" className="btn btn-sm btn-primary" onClick={async () => { const r = await run('updateParticipant', editing); if (r.ok) setEditing(null); }}>Save</button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className={p.checkedInAt ? 'present' : ''}>
                  <td>
                    <button type="button" className={`presence ${p.checkedInAt ? 'on' : ''}`} disabled={!editable || pending}
                      onClick={() => run('setPresence', { id: p.id, present: !p.checkedInAt })}
                      aria-pressed={!!p.checkedInAt} aria-label={`${p.fullName}: ${p.checkedInAt ? 'confirmed' : 'not confirmed'}`} data-testid="presence">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                    </button>
                    {p.checkedInAt ? <small className="faint mono">{timeOf(p.checkedInAt)}</small> : null}
                  </td>
                  <td><b>{p.fullName}</b></td>
                  <td>{p.phone ? <a className="mono phone" href={`tel:${p.phone}`}>{p.phone}</a> : <span className="faint">—</span>}</td>
                  <td>{p.filiere || <span className="faint">—</span>}</td>
                  <td><span className={`pill ${p.year > 1 ? 'accent' : ''}`}>{yearLabel(p.year)}</span></td>
                  <td><span className="src">{p.source === 'self' ? 'Form' : p.source === 'import' ? 'Import' : 'Admin'}</span> <small className="faint mono">{timeOf(p.createdAt)}</small></td>
                  <td>{p.teamId && teamsById[p.teamId] ? <span className="row"><TeamDot color={teamsById[p.teamId].colorHex} />{teamsById[p.teamId].name}</span> : <span className="faint">—</span>}</td>
                  <td className="row end nowrap">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing({ id: p.id, fullName: p.fullName, phone: p.phone || '', filiere: p.filiere, year: p.year })}>Edit</button>
                    {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { if (await ask({ title: `Remove ${p.fullName}?`, confirmLabel: 'Remove', danger: true })) run('removeParticipant', { id: p.id }); }} aria-label={`Remove ${p.fullName}`}>✕</button>}
                  </td>
                </tr>
              )))}
              {list.length === 0 && <tr><td colSpan={8} className="muted">{people.length ? 'Nobody matches.' : 'No participant yet. Share the /register link or the QR code on the big screen.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="admin-grid">
        <form className="card stack" onSubmit={add}>
          <h2>Add at the desk</h2>
          <p className="muted small">People added here are confirmed present.</p>
          <label className="field"><span>Full name</span>
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} maxLength={80} required disabled={!editable} data-testid="p-name" />
          </label>
          <label className="field"><span>Phone number</span>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} inputMode="tel" disabled={!editable} placeholder="06 12 34 56 78" data-testid="p-phone" />
          </label>
          <label className="field"><span>Field</span>
            <input value={form.filiere} onChange={(e) => setForm({ ...form, filiere: e.target.value })} maxLength={80} disabled={!editable} list="filieres" data-testid="p-filiere" />
          </label>
          <datalist id="filieres">{[...new Set(people.map((p) => p.filiere).filter(Boolean))].map((f) => <option key={f} value={f} />)}</datalist>
          <label className="field"><span>Year</span>
            <select value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} disabled={!editable} data-testid="p-year">
              <option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={!editable || pending || !form.fullName.trim()}>Add</button>
        </form>

        <section className="card stack">
          <h2>Import (CSV / paste)</h2>
          <p className="muted small">One person per line: <span className="mono">Full Name, Phone, Field, Year</span> (the phone is optional). Commas, semicolons or tabs. A header line is skipped. Imported people still need to check in.</p>
          <textarea className="input" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Amine Benali, 0612345678, Génie Informatique, 3\nSara El Idrissi, Génie Civil, 1'} disabled={!editable} data-testid="p-bulk" />
          <div className="row">
            <label className="btn btn-sm">Load a .csv file<input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden onChange={loadFile} disabled={!editable} /></label>
            <button type="button" className="btn btn-primary" disabled={!editable || pending || !bulk.trim()} onClick={importText} data-testid="p-import">Import</button>
            {editable && people.length > 0 && (
              <button type="button" className="btn btn-sm btn-danger" onClick={async () => {
                if (await ask({ title: 'Remove all participants?', text: 'Every registration is deleted. Export the Excel file first if you need it.', confirmLabel: 'Remove all', danger: true })) run('clearParticipants');
              }}>Remove all</button>
            )}
          </div>
        </section>
      </div>
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
        <p className="muted">Teams are drawn from the participants who confirmed their presence (check-in). Sizes are balanced (1 to 4 members, as even as possible) and 2nd/3rd-year students are spread first so each team gets a senior when possible.</p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={pending || status !== 'REGISTRATION' || !people.some((p) => p.checkedInAt)} onClick={() => run('generateTeams', {}, 'Teams generated')}>Generate teams from {people.filter((p) => p.checkedInAt).length} confirmed</button>
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
            <thead><tr><th>#</th><th>Team</th><th className="num">RoboPath</th><th className="num">Phone</th><th className="num">Quiz</th><th className="num">Challenges</th><th className="num">Admin</th><th className="num">Total</th></tr></thead>
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
                    <td className="num">{quizCell(t)} {t.games.quiz?.switches > 0 && <small className="pill warn" title="Times the team left the quiz tab">⇄ {t.games.quiz.switches}</small>}</td>
                    <td className="num">{signed(ch)}</td>
                    <td className="num">{signed(admin)}</td>
                    <td className="num"><b>{r.score}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint small" style={{ marginTop: 8 }}>RoboPath and the Locked Phone are worth 0–100 points each. The N7 Quiz keeps its original scoring (up to 280 points, faster correct answers earn more) and counts once the team has finished it. ⇄ = times the team left the quiz screen.</p>
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
      {state.match ? <Presenter state={state} run={run} pending={pending} /> : (
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

function Presenter({ state, run, pending }) {
  const m = state.match;
  const A = state.teams.find((t) => t.id === m.challenge.challengerTeamId);
  const B = state.teams.find((t) => t.id === m.challenge.defenderTeamId);
  const cmd = useCallback((type, extra = {}) => run('matchAct', { command: { type, ...extra } }), [run]);
  return (
    <HfPresenter
      key={m.challenge.id}
      board={m.board}
      names={[A?.name, B?.name]}
      colors={[A?.colorHex, B?.colorHex]}
      stake={m.challenge.lockedPointStake}
      offset={state.offset}
      pending={pending}
      cmd={cmd}
      onSettle={(side) => run('settleMatch', side === null ? {} : { winnerTeamId: side === 0 ? A.id : B.id }, 'Points transferred')}
      onAbort={() => run('abortMatch', { reason: 'cancelled by the admin' })}
    />
  );
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
    mainGamesMinutes: s.mainGamesMinutes,
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
        mainGamesMinutes: Number(f.mainGamesMinutes),
        lockedBatteryMinutes: Number(f.lockedBatteryMinutes),
        huroof: { size: Number(f.size), roundsToWin: Number(f.roundsToWin), answerTime: Number(f.answerTime), showQuestion: f.showQuestion, extraBank: f.extraBank },
      },
    }, 'Settings saved');
  }
  return (
    <form className="admin-grid" onSubmit={save}>
      <section className="card stack">
        <h2>Mini-games</h2>
        <label className="field"><span>Minutes before the challenge phase opens by itself (counted from the start)</span><input type="number" min={5} max={300} value={f.mainGamesMinutes} onChange={set('mainGamesMinutes')} data-testid="set-main-minutes" /></label>
        <p className="faint small">Default 90 (1:30:00). During the games, use the ± buttons on the Event tab instead.</p>
        <h2 style={{ marginTop: 10 }}>Challenges</h2>
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
