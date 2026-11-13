// Public registration (/register) and event-day check-in (/checkin?k=…).
// Students register once with their phone; on event day they scan the QR on
// the big screen to confirm they are here. Teams are drawn from confirmed
// players only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../lib/api.js';
import { usePublic } from '../lib/usePublic.js';
import { sfx } from '../lib/audio.js';
import './register.css';

const PASS_KEY = 'ucp.pass'; // { participantId, proof, fullName, filiere, year }
const KEY_KEY = 'ucp.checkinKey';
const YEARS = [[1, '1st year'], [2, '2nd year'], [3, '3rd year']];
const yearText = (y) => ({ 1: '1st year', 2: '2nd year', 3: '3rd year' }[y] || '');

function readPass() {
  try {
    const p = JSON.parse(localStorage.getItem(PASS_KEY) || 'null');
    return p && typeof p.participantId === 'string' && typeof p.proof === 'string' ? p : null;
  } catch {
    return null;
  }
}
function savePass(p) {
  try { localStorage.setItem(PASS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
function forgetPass() {
  try { localStorage.removeItem(PASS_KEY); } catch { /* ignore */ }
}

const phoneOk = (v) => {
  const d = String(v).replace(/[\s().\-/]/g, '');
  return /^(\+|00)?\d{8,15}$/.test(d);
};

/* ------------------------------------------------------------- frame -- */
function Frame({ eventName, steps, active, children, wide = false }) {
  return (
    <div className="rg-page">
      <aside className="rg-stage">
        <a className="lp-brand" href="/">
          <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD" /></span>
          <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC" /></span>
          <span className="lp-brand-name">{eventName}</span>
        </a>
        <div className="rg-stage-copy">
          <h1>{steps.title}</h1>
          <p>{steps.text}</p>
        </div>
        <ol className="rg-steps">
          {['Register', 'Check in on event day', 'Meet your team', 'Play four games'].map((label, i) => (
            <li key={label} className={i < active ? 'done' : i === active ? 'now' : ''}>
              <span className="rg-hex">{i < active ? '✓' : i + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </aside>
      <main className={`rg-main ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  );
}

/* --------------------------------------------------------- the form -- */
function PersonForm({ fields = [], busy, error, submitLabel, onSubmit, initialPhone = '' }) {
  const [f, setF] = useState({ fullName: '', phone: initialPhone, filiere: '', year: 0 });
  const [touched, setTouched] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const problems = {
    fullName: f.fullName.trim().split(/\s+/).filter(Boolean).length < 2 ? 'Write your first and last name.' : '',
    phone: !phoneOk(f.phone) ? 'Write a phone number we can reach (e.g. 06 12 34 56 78).' : '',
    filiere: !f.filiere.trim() ? 'Write your field of study.' : '',
    year: !f.year ? 'Choose your year.' : '',
  };
  const valid = !Object.values(problems).some(Boolean);
  const show = (k) => touched[k] && problems[k];

  return (
    <form
      className="rg-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched({ fullName: true, phone: true, filiere: true, year: true });
        sfx.unlock();
        if (valid) onSubmit({ ...f, fullName: f.fullName.trim(), filiere: f.filiere.trim() });
      }}
    >
      <label className={`rg-field ${show('fullName') ? 'bad' : ''}`}>
        <span>Full name</span>
        <input value={f.fullName} onChange={set('fullName')} onBlur={() => setTouched({ ...touched, fullName: true })}
          autoComplete="name" autoCapitalize="words" maxLength={80} placeholder="Ayoub BOUELKHEIR" data-testid="rg-name" />
        {show('fullName') && <em>{problems.fullName}</em>}
      </label>
      <label className={`rg-field ${show('phone') ? 'bad' : ''}`}>
        <span>Phone number</span>
        <input value={f.phone} onChange={set('phone')} onBlur={() => setTouched({ ...touched, phone: true })}
          type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="06 12 34 56 78" data-testid="rg-phone" />
        {show('phone') ? <em>{problems.phone}</em> : <small>Only the organisers see it. You use it to check in.</small>}
      </label>
      <label className={`rg-field ${show('filiere') ? 'bad' : ''}`}>
        <span>Field</span>
        <input value={f.filiere} onChange={set('filiere')} onBlur={() => setTouched({ ...touched, filiere: true })}
          list="rg-fields" maxLength={80} placeholder="Big Data & Cloud Computing" autoCapitalize="words" data-testid="rg-field" />
        <datalist id="rg-fields">{fields.map((x) => <option key={x} value={x} />)}</datalist>
        {show('filiere') && <em>{problems.filiere}</em>}
      </label>
      <fieldset className={`rg-field ${show('year') ? 'bad' : ''}`}>
        <legend>Year</legend>
        <div className="rg-years" role="radiogroup" aria-label="Year">
          {YEARS.map(([y, label]) => (
            <button key={y} type="button" role="radio" aria-checked={f.year === y} className={f.year === y ? 'on' : ''}
              onClick={() => { sfx.play('tap'); setF({ ...f, year: y }); setTouched({ ...touched, year: true }); }} data-testid={`rg-year-${y}`}>
              <b>{y}<sup>{label.split(' ')[0].slice(1)}</sup></b><small>year</small>
            </button>
          ))}
        </div>
        {show('year') && <em>{problems.year}</em>}
      </fieldset>
      {error && <p className="rg-error" role="alert">{error}</p>}
      <button className="btn btn-primary btn-lg rg-submit" type="submit" disabled={busy} data-testid="rg-submit">
        {busy ? 'Sending…' : submitLabel}
      </button>
    </form>
  );
}

/** The pass shown once registered (and kept on the phone for check-in). */
function Pass({ pass, confirmed, eventName, children }) {
  return (
    <div className={`rg-pass ${confirmed ? 'confirmed' : ''}`} data-testid="rg-pass">
      <div className="rg-pass-top">
        <span className="rg-pass-kicker">{eventName}</span>
        <span className={`rg-pass-state ${confirmed ? 'good' : ''}`}>{confirmed ? 'Checked in' : 'Registered'}</span>
      </div>
      <h2>{pass.fullName}</h2>
      <p className="rg-pass-meta">{[pass.filiere, yearText(pass.year)].filter(Boolean).join(' · ')}</p>
      <div className="rg-perforation" aria-hidden="true" />
      <div className="rg-pass-bottom">{children}</div>
    </div>
  );
}

function CheckBadge() {
  return (
    <div className="rg-badge" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" />
        <path d="M31 51 l13 13 l26 -28" />
      </svg>
    </div>
  );
}

/* ============================================================ REGISTER */
export default function Register() {
  const pub = usePublic(20000);
  const eventName = pub?.eventName || 'N7 Kickoff Cup';
  const [pass, setPass] = useState(() => readPass());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [again, setAgain] = useState(false);

  const submit = async (form) => {
    setBusy(true);
    setError('');
    const res = await request('/api/register', { body: form });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      sfx.play('error');
      return;
    }
    const p = { participantId: res.participantId, proof: res.proof, fullName: res.fullName, filiere: form.filiere, year: form.year };
    savePass(p);
    setPass(p);
    setAgain(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    sfx.play('win');
  };

  const status = pub?.status;
  const closed = pub && (!pub.registrationOpen || status !== 'REGISTRATION');
  const showForm = !pass || again;

  return (
    <Frame
      eventName={eventName}
      active={pass && !again ? 1 : 0}
      steps={{
        title: 'Save your seat.',
        text: 'Register once with your phone number. On event day, scan the code on the big screen to confirm you are here: teams are drawn from the players in the room.',
      }}
    >
      <div className="rg-card">
        {showForm ? (
          <>
            <header className="rg-head">
              <h2>Register</h2>
              <p className="muted">Thirty seconds. Everything stays with the organisers.</p>
            </header>
            {closed && !pub?.checkinOpen ? (
              <div className="rg-closed">
                <b>{status === 'REGISTRATION' ? 'Registration is closed.' : 'Teams are already formed.'}</b>
                <p className="muted">Ask the organisers at the desk.</p>
              </div>
            ) : closed && pub?.checkinOpen ? (
              <div className="rg-closed">
                <b>Online registration is closed.</b>
                <p className="muted">You are at the event? Scan the check-in code on the big screen: you can register there.</p>
              </div>
            ) : (
              <PersonForm fields={pub?.fields || []} busy={busy} error={error} submitLabel="Register" onSubmit={submit} />
            )}
            {pass && <button type="button" className="rg-link" onClick={() => setAgain(false)}>Back to {pass.fullName.split(' ')[0]}’s pass</button>}
          </>
        ) : (
          <>
            <CheckBadge />
            <header className="rg-head center">
              <h2>You’re registered!</h2>
              <p className="muted">See you on event day.</p>
            </header>
            <Pass pass={pass} eventName={eventName} confirmed={false}>
              <p><b>On event day:</b> open your camera and scan the <b>check-in</b> QR code on the big screen. This phone remembers you, so it is one tap.</p>
            </Pass>
            <div className="rg-actions">
              <button type="button" className="rg-link" onClick={() => { setAgain(true); setError(''); }} data-testid="rg-another">Register someone else on this phone</button>
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}

/* ============================================================ CHECK-IN */
export function Checkin() {
  const pub = usePublic(20000);
  const eventName = pub?.eventName || 'N7 Kickoff Cup';
  const key = useMemo(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('k') || '';
    try {
      if (fromUrl) sessionStorage.setItem(KEY_KEY, fromUrl);
      return fromUrl || sessionStorage.getItem(KEY_KEY) || '';
    } catch {
      return fromUrl;
    }
  }, []);
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', '/checkin');
  }, []);

  const [pass, setPass] = useState(() => readPass());
  const [stage, setStage] = useState(pass ? 'auto' : 'phone'); // auto | phone | register | done | error
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState('');
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState(null);
  const tried = useRef(false);

  const fail = useCallback((res) => {
    sfx.play('error');
    if (res.status === 410) setFatal('expired');
    else if (res.status === 409) setFatal(res.error);
    else setError(res.error);
  }, []);

  const finish = useCallback((res, extra = {}) => {
    const p = { participantId: res.participantId, proof: res.proof, fullName: res.fullName, ...extra };
    const prev = readPass();
    const merged = prev && prev.participantId === p.participantId ? { ...prev, ...p } : p;
    savePass(merged);
    setPass(merged);
    setDone({ already: !!res.already });
    setStage('done');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    sfx.play(res.already ? 'notify' : 'win');
  }, []);

  // one tap: this phone registered before
  useEffect(() => {
    if (stage !== 'auto' || tried.current || !key || !pass) return;
    tried.current = true;
    (async () => {
      setBusy(true);
      const res = await request('/api/checkin', { body: { key, participantId: pass.participantId, proof: pass.proof } });
      setBusy(false);
      if (res.ok) finish(res);
      else if (res.status === 404) {
        forgetPass();
        setPass(null);
        setStage('phone');
      } else fail(res);
    })();
  }, [stage, key, pass, finish, fail]);

  const byPhone = async (e) => {
    e.preventDefault();
    sfx.unlock();
    if (!phoneOk(phone)) {
      setError('Write the phone number you registered with.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await request('/api/checkin', { body: { key, phone } });
    setBusy(false);
    if (res.ok) finish(res);
    else if (res.status === 404) setStage('register');
    else fail(res);
  };

  const registerHere = async (form) => {
    setBusy(true);
    setError('');
    const res = await request('/api/register', { body: { ...form, checkinKey: key } });
    setBusy(false);
    if (res.ok) finish({ ...res, already: false }, { filiere: form.filiere, year: form.year });
    else if (res.status === 410) fail(res);
    else {
      sfx.play('error');
      setError(res.error);
    }
  };

  let body;
  if (!key || fatal === 'expired') {
    body = (
      <div className="rg-state">
        <div className="rg-scan" aria-hidden="true"><i /><i /><i /><i /></div>
        <h2>{key ? 'This code has expired' : 'Scan the code on the big screen'}</h2>
        <p className="muted">The check-in code changes every minute, so only people in the room can confirm. Open your camera and scan the QR code shown on the big screen.</p>
      </div>
    );
  } else if (fatal) {
    body = (
      <div className="rg-state">
        <h2>Check-in unavailable</h2>
        <p className="muted">{fatal}</p>
      </div>
    );
  } else if (stage === 'done' && pass) {
    body = (
      <>
        <CheckBadge />
        <header className="rg-head center">
          <h2>{done?.already ? 'Already checked in' : 'You’re checked in!'}</h2>
          <p className="muted">Stay close to the big screen.</p>
        </header>
        <Pass pass={pass} eventName={eventName} confirmed>
          <p>Teams are drawn from everyone checked in. Your team and its join code appear on the big screen in a moment.</p>
        </Pass>
        <div className="rg-actions">
          <button type="button" className="rg-link" onClick={() => { setStage('phone'); setPhone(''); setError(''); }}>Check in someone else on this phone</button>
        </div>
      </>
    );
  } else if (stage === 'auto') {
    body = (
      <div className="rg-state" aria-busy="true">
        <div className="rg-spinner" aria-hidden="true" />
        <h2>Checking you in…</h2>
        <p className="muted">{pass?.fullName}</p>
      </div>
    );
  } else if (stage === 'register') {
    body = (
      <>
        <header className="rg-head">
          <h2>Not registered yet</h2>
          <p className="muted">No problem: register now and you are checked in at once.</p>
        </header>
        <PersonForm fields={pub?.fields || []} busy={busy} error={error} submitLabel="Register & check in" onSubmit={registerHere} initialPhone={phone} />
        <button type="button" className="rg-link" onClick={() => { setStage('phone'); setError(''); }}>I already registered: try another number</button>
      </>
    );
  } else {
    body = (
      <>
        <header className="rg-head">
          <h2>Confirm you’re here</h2>
          <p className="muted">Write the phone number you registered with.</p>
        </header>
        <form className="rg-form" onSubmit={byPhone} noValidate>
          <label className="rg-field">
            <span>Phone number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel"
              maxLength={20} placeholder="06 12 34 56 78" autoFocus data-testid="ci-phone" />
          </label>
          {error && <p className="rg-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-lg rg-submit" type="submit" disabled={busy} data-testid="ci-submit">{busy ? 'Checking…' : 'Check in'}</button>
        </form>
        <button type="button" className="rg-link" onClick={() => { setStage('register'); setError(''); }}>Never registered? Register here</button>
      </>
    );
  }

  return (
    <Frame
      eventName={eventName}
      active={stage === 'done' ? 2 : 1}
      steps={{
        title: 'You made it.',
        text: 'Confirm you are in the room. Only checked-in players are placed in a team, and the teams are drawn live on the big screen.',
      }}
    >
      <div className="rg-card">{body}</div>
    </Frame>
  );
}
