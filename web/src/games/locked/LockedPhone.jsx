// The Locked Phone, the second game of the gauntlet (ported from the stand-alone game).
// The phone runs in the browser (phone.js); the server checks every answer,
// keeps the battery and the hints, and awards the points.
import { useEffect, useRef, useState } from 'react';
import { createPhone } from './phone.js';
import { sfx } from '../../lib/audio.js';
import { clock } from '../../lib/format.js';
import { useConfirm } from '../../components/common.jsx';
import './locked.css';

const LOCK_LABELS = ['9fel 1', '9fel 2', '9fel 3', '9fel 4'];

function battClass(b) {
  return b <= 20 ? 'low' : b <= 45 ? 'mid' : '';
}

/** Battery and clock, computed from the server data and the server time. */
function liveVitals(d, now) {
  if (!d.startedAt) return { battery: 100, elapsed: 0 };
  const end = d.endedAt || now;
  const elapsed = Math.max(0, (end - d.startedAt) / 1000);
  if (d.endReason === 'dead') return { battery: 0, elapsed };
  const b = 100 - Math.floor(elapsed / d.drainPerSec) - d.wrong * 5 - d.hints * 10;
  return { battery: Math.max(0, Math.min(100, b)), elapsed };
}

function seenKey(teamId) {
  return `ucp.lp.seen.${teamId}`;
}

/**
 * @param data        the team's Locked Phone state from the server
 * @param act         (action, payload) => Promise
 * @param team        { id, name, colorHex }
 * @param serverNow   () => server time in ms
 * @param onContinue  leave the finished game
 */
export default function LockedPhone({ data, act, team, serverNow, onContinue }) {
  const refs = {
    view: useRef(null), screen: useRef(null), sb: useRef(null), sbTime: useRef(null),
    sbPct: useRef(null), sbB: useRef(null), sbBi: useRef(null), homeBar: useRef(null),
  };
  const phone = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const actRef = useRef(act);
  actRef.current = act;
  const [, setTick] = useState(0);
  const [hintArmed, setHintArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmEl, ask] = useConfirm();
  const lowWarned = useRef(false);
  const lastStage = useRef(data.stage);

  const now = serverNow();
  const { battery, elapsed } = liveVitals(data, now);
  const playing = data.status === 'playing';
  const ended = data.status === 'completed' || data.status === 'dead' || data.status === 'abandoned';
  const vitals = { ...data, battery };

  // create the phone once
  useEffect(() => {
    let seen = [];
    try {
      seen = JSON.parse(localStorage.getItem(seenKey(team.id)) || '[]');
    } catch {
      seen = [];
    }
    const els = Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, r.current]));
    phone.current = createPhone(els, {
      now: serverNow,
      seen: Array.isArray(seen) ? seen : [],
      onSeen: (list) => {
        try {
          localStorage.setItem(seenKey(team.id), JSON.stringify(list.slice(-200)));
        } catch {
          /* ignore */
        }
      },
      sound: (name) => sfx.play(name),
      attempt: (lock, answer) => actRef.current('lockedAttempt', { lock, answer }),
    });
    phone.current.update({ ...dataRef.current, battery: liveVitals(dataRef.current, serverNow()).battery });
    return () => phone.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // new data from the server
  useEffect(() => {
    phone.current?.update(vitals);
    if (data.stage !== lastStage.current) {
      lastStage.current = data.stage;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // the clock and the battery move every second
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      const v = liveVitals(dataRef.current, serverNow());
      phone.current?.update({ ...dataRef.current, battery: v.battery });
      if (v.battery <= 20 && v.battery > 0 && !lowWarned.current) {
        lowWarned.current = true;
        phone.current?.toast(`Batterie na9sa: ${v.battery}%`, 'bad');
        sfx.play('lowBattery');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [playing, serverNow]);

  // the phone dies
  const wasDead = useRef(data.status === 'dead');
  useEffect(() => {
    if (data.status === 'dead' && !wasDead.current) sfx.play('powerOff');
    if (data.status === 'completed' && data.endReason === 'found') sfx.play('fanfare');
    wasDead.current = data.status === 'dead';
  }, [data.status, data.endReason]);

  async function start() {
    if (starting) return;
    setStarting(true);
    sfx.play('start');
    const res = await act('lockedStart');
    setStarting(false);
    if (!res.ok) phone.current?.toast(res.error, 'bad');
  }

  // hints: tap once to arm, tap again within 4 s to confirm (as in the original game)
  const hintTimer = useRef(null);
  async function hint() {
    if (!playing || busy) return;
    if (!hintArmed) {
      setHintArmed(true);
      sfx.play('toggle');
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHintArmed(false), 4000);
      return;
    }
    clearTimeout(hintTimer.current);
    setHintArmed(false);
    setBusy(true);
    const res = await act('lockedHint');
    setBusy(false);
    if (!res.ok) {
      phone.current?.toast(res.error, 'bad');
      sfx.play('error');
      return;
    }
    sfx.play('hint');
    phone.current?.toast('Tlmi7 tzad f dossier · −10%', 'bad');
  }
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  async function skip() {
    if (!playing || busy || data.stage > 3) return;
    const last = data.stage === 3;
    const yes = await ask({
      title: `Fout ${LOCK_LABELS[data.stage]}?`,
      text: last
        ? `Skip lock ${data.stage + 1}: you get 0 of its ${data.lockPoints} points and no battery bonus. This is the last lock: the Locked Phone ends here.`
        : `Skip lock ${data.stage + 1}: it opens, but you get 0 of its ${data.lockPoints} points. The next lock starts right away.`,
      confirmLabel: 'Skip this lock',
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    const res = await act('lockedSkip');
    setBusy(false);
    if (!res.ok) {
      phone.current?.toast(res.error, 'bad');
      sfx.play('error');
      return;
    }
    sfx.play('level');
    phone.current?.toast(`${LOCK_LABELS[data.stage]} fattet · 0 pts`, 'bad');
  }

  const hintsTotal = Math.max(0, data.maxHints - data.hints);
  let hintLabel = 'Tlmi7at ma kaynach';
  if (playing) {
    if (hintArmed) hintLabel = 'Dghet 3awed bach tconfirmi · −10%';
    else if (data.hintsLeftForLock <= 0) hintLabel = hintsTotal <= 0 ? 'Kheddemtou les 2 tlmi7at' : 'Mab9awch tlmi7at l had l9fel';
    else hintLabel = `Khoud tlmi7 · −10% (${hintsTotal}/${data.maxHints} ba9in)`;
  }

  const locks = [0, 1, 2, 3].map((i) => {
    const skipped = data.skipped?.[i];
    const st = data.stage > i ? (skipped ? 'skip' : 'done') : data.stage === i ? 'now' : 'wait';
    const name = st === 'done' ? data.lockNames[i] : st === 'skip' ? `${data.lockNames[i]}` : `9fel ${i + 1}`;
    const label = st === 'done' ? 'Me7loul' : st === 'skip' ? 'Fattet' : st === 'now' ? (playing ? 'Khdamin' : 'Wajed') : 'Msdoud';
    return { i, st, name, label };
  });

  return (
    <>
      <div className="lp-root">
        <div className="wrap">
          <section className="vitals" aria-label="L7ala dyal lo3ba">
            <div className="tag"><span>Dalil 017</span><span>Telephone dyal R. Benali</span></div>
            <div className="vrow">
              <div style={{ minWidth: 0 }}>
                <div className="lbl">Équipe</div>
                <div className="team" style={{ color: team.colorHex }}>{team.name}</div>
              </div>
              <div><div className="lbl">Lw9t</div><div className="timer">{clock(elapsed)}</div></div>
              <div><div className="lbl">Batterie</div><div className={`batt ${battClass(battery)}`} data-testid="lp-battery">{battery}%</div></div>
            </div>
            <div className="lp-actions">
            <button className={`hint-btn ${hintArmed ? 'confirm' : ''}`} type="button" onClick={hint} disabled={!playing || busy || (!hintArmed && data.hintsLeftForLock <= 0)}>
              {hintLabel}
            </button>
            <button className="hint-btn lp-skip-btn" type="button" onClick={skip} disabled={!playing || busy || data.stage > 3} data-testid="lp-skip">
              {playing && data.stage <= 3 ? `Fout ${LOCK_LABELS[data.stage]} · skip (0 pts)` : 'Skip'}
            </button>
            </div>
            <div className="bbar"><i className={battClass(battery)} style={{ width: `${battery}%` }} /></div>
          </section>

          <div className="phone">
            <div className="screen on-wall" ref={refs.screen}>
              <svg className="pitch" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
                <g fill="none" stroke="var(--pitch-line)" strokeWidth="1.5">
                  <path d="M120 20 L280 20 L400 300 L0 300 Z" />
                  <path d="M60 160 L340 160" />
                  <ellipse cx="200" cy="160" rx="70" ry="22" />
                  <path d="M160 20 L165 52 L235 52 L240 20" />
                </g>
              </svg>
              <div className="sb" ref={refs.sb}>
                <span ref={refs.sbTime}>18:04</span>
                <span className="cam" />
                <span className="sb-r">
                  <span className="sb-pct" ref={refs.sbPct}>100%</span>
                  <span className="sb-b" ref={refs.sbB}><i ref={refs.sbBi} style={{ width: '100%' }} /></span>
                </span>
              </div>
              <div className="view" ref={refs.view} />
              <button className="hb" type="button" aria-label="Rje3 l l’accueil" ref={refs.homeBar}><i /></button>
            </div>
          </div>

          <section className="casefile" aria-label="Dossier">
            <h2>Dossier <span className="lp-points" data-testid="lp-points">{data.points} / 100 pts</span></h2>
            <div>
              <h3>L9foul</h3>
              <ol className="locks">
                {locks.map((l) => (
                  <li key={l.i} className={l.st === 'skip' ? 'wait lp-skipped' : l.st}>
                    <span className="num">{l.i + 1}</span>
                    <span>{l.name}</span>
                    <span className={`st ${l.st === 'skip' ? 'wait' : l.st}`}>{l.label}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3>Tlmi7at li khditou</h3>
              <ul className="hintlog">
                {data.hintLog.length ? (
                  data.hintLog.map((h, k) => <li key={k}><b>9fel {h.stage + 1}</b>{h.text}</li>)
                ) : (
                  <li className="empty">Mazal walou. 3ndkom ghir 2 tlmi7at f lo3ba kamla, kol wa7ed b 10% mn batterie.</li>
                )}
              </ul>
            </div>
            <div>
              <h3>L9awanin</h3>
              <ul className="rules">
                <li><b>Code wla mot de passe ghalat:</b> −5% batterie.</li>
                <li><b>Tlmi7at:</b> ghir 2 f lo3ba kamla, kol wa7ed b −10% batterie.</li>
                <li><b>Batterie kat9es b rasha</b> w ntouma kat l3bo.</li>
                <li><b>F 0%</b> telephone kaytfa w lo3ba katsala.</li>
                <li><b>Skip:</b> ila ma3reftouch chi 9fel, t9edro tfoutouh, walakin bla points.</li>
                <li><b>Score:</b> {data.lockPoints} pts 3la kol 9fel me7loul + bonus dyal batterie (batterie ÷ 5) ila l9itou lflag. Max 100.</li>
              </ul>
            </div>
          </section>
        </div>

        {data.status === 'ready' && (
          <div className="overlay">
            <div className="card">
              <div className="tag"><span>Dalil 017</span><span>Tl9a f salle dyal club</span></div>
              <div className="card-body">
                <h1>Telephone Msdoud</h1>
                <p><strong>Rayan, président dyal club, ghber sa3a 9bel lkickoff.</strong> 7ta wa7ed mab9a y9der ywslo. Kolchi li l9ina howa telephone dyalo, mkhelli 3la tabla f salle dyal club. 7elloh, 9elbo f les applications dyalo w l9aw fin mkhebbi.</p>
                <div className="cost">
                  <div><b>−5%</b>3la kol code wla mot de passe ghalat</div>
                  <div><b>−10%</b>3la kol tlmi7 (ghir 2 f lo3ba kamla)</div>
                  <div><b>1%/{Math.round(data.drainPerSec)}s</b>batterie kat9es b rasha</div>
                </div>
                <p>F 0% telephone kaytfa w lo3ba katsala. Kol 9fel b {data.lockPoints} point, w ila l9itou lflag <b>n7sec{'{…}'}</b> katzad lbatterie li ba9ya. Ila ma3reftouch chi 9fel, t9edro tfoutouh (skip) bla points.</p>
                <div className="start">
                  <div className="lp-team-chip" style={{ borderColor: team.colorHex }}>{team.name}</div>
                  <button className="btn-main" type="button" onClick={start} disabled={starting} data-testid="lp-start">
                    {starting ? '…' : 'Bdaw lw9t'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {ended && (
          <div className="overlay">
            <div className="card">
              <div className="tag"><span>{data.endReason === 'found' ? 'L9adiya tsddat' : 'Dalil 017'}</span><span>{team.name}</span></div>
              <div className="card-body">
                {data.endReason === 'found' && <h1>🚩 L9itou lflag!</h1>}
                {data.endReason === 'finished' && <h1>Salat lo3ba</h1>}
                {data.endReason === 'dead' && <h1>Telephone tfa.</h1>}
                {(data.endReason === 'gave_up' || data.endReason === 'closed') && <h1>Lw9t sala</h1>}
                {data.flag && (
                  <div className="proof" style={{ fontSize: 'clamp(18px,5vw,26px)', wordBreak: 'break-all' }}>{data.flag}</div>
                )}
                <p>
                  {data.endReason === 'dead'
                    ? 'Batterie wslat 0% 9bel matl9aw lflag.'
                    : data.endReason === 'found'
                      ? 'Lo3ba salat. Brawo!'
                      : data.endReason === 'finished'
                        ? 'Fouttou l9fel lekher, donc ma kaynch flag.'
                        : 'Admin sedd lmini-games.'}{' '}
                  Score dyalkom tsjjel f tableau.
                </p>
                <div className="where-big" style={{ textAlign: 'center' }}>Score: {data.points} / 100</div>
                <div className="stats">
                  <div><small>L9foul li t7lo</small><b>{locks.filter((l) => l.st === 'done').length} / 4</b></div>
                  <div><small>Lw9t</small><b>{clock(elapsed)}</b></div>
                  <div><small>Ajwiba ghalta</small><b>{data.wrong}</b></div>
                  <div><small>Tlmi7at / Skips</small><b>{data.hints} / {data.skipped.filter(Boolean).length}</b></div>
                </div>
                <div className="gm-row">
                  <button className="btn-main" type="button" onClick={onContinue} data-testid="lp-continue">Continue</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {confirmEl}
    </>
  );
}
