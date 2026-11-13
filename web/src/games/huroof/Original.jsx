// The three Huruf screens with the ORIGINAL huroof-challenge look (Arabic, RTL):
//   HfStage     — the big screen (public/board.html)
//   HfPresenter — the presenter console (public/host.html), inside the admin panel
//   HfBuzzer    — a team's answer button (public/buzz.html)
// Team colours replace the original green / orange palette.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from '../../lib/qrcode.js';
import { sfx } from '../../lib/audio.js';
import HuroofBoard from './HuroofBoard.jsx';
import './original.css';

/* ------------------------------------------------------------- helpers -- */
const roundsWord = (n) => (n === 1 ? 'جولة واحدة' : n === 2 ? 'جولتين' : n + ' جولات');
const teamDesc = (t) => (t === 0 ? 'يربط اليمين باليسار' : 'يربط الأعلى بالأسفل');

/** CSS variables for the two team colours (and their darker shade). */
export function teamVars(colors) {
  const c0 = colors[0] || '#148a50';
  const c1 = colors[1] || '#d9680b';
  return {
    '--t0': c0,
    '--t1': c1,
    '--t0-deep': `color-mix(in srgb, ${c0} 72%, #000)`,
    '--t1-deep': `color-mix(in srgb, ${c1} 72%, #000)`,
  };
}

function SidesGlyph({ team }) {
  return (
    <svg className="hf-sides" viewBox="0 0 44 36" aria-hidden="true">
      <rect x="4" y="4" width="36" height="28" rx="3" />
      {team === 0
        ? <><line x1="4" y1="6" x2="4" y2="30" /><line x1="40" y1="6" x2="40" y2="30" /></>
        : <><line x1="8" y1="4" x2="36" y2="4" /><line x1="8" y1="32" x2="36" y2="32" /></>}
    </svg>
  );
}

function Tn({ t, names }) {
  return <span className={`hf-tn hf-t${t}`}>{names[t]}</span>;
}

/** Seconds left on the answer clock, smooth (requestAnimationFrame), server time. */
function useClock(timer, offset, onOut) {
  const [left, setLeft] = useState(null);
  const outRef = useRef(onOut);
  outRef.current = onOut;
  useEffect(() => {
    if (!timer) {
      setLeft(null);
      return undefined;
    }
    let raf = 0;
    let fired = false;
    const loop = () => {
      const ms = Math.max(0, timer.ends - (Date.now() + (offset || 0)));
      setLeft(ms / 1000);
      if (ms <= 0) {
        if (!fired) {
          fired = true;
          outRef.current?.();
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [timer?.ends, timer?.total, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}

/** Plays the original sound of each new board event, once. */
function useFx(board, map) {
  const seen = useRef(board?.fx?.seq ?? null);
  const mapRef = useRef(map);
  mapRef.current = map;
  useEffect(() => {
    const fx = board?.fx;
    if (!fx) return;
    if (seen.current === null) {
      seen.current = fx.seq;
      return;
    }
    if (fx.seq === seen.current) return;
    seen.current = fx.seq;
    mapRef.current[fx.type]?.(fx.team);
  }, [board?.fx]);
}

function Logos() {
  return (
    <span className="hf-club-logos">
      <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD" /></span>
      <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC" /></span>
    </span>
  );
}

/* ============================================================ BIG SCREEN */
export function HfStage({ board: st, names, colors, offset = 0, stake, teams = [], clockText = '', clockUrgent = false }) {
  const [flash, setFlash] = useState({ 0: 0, 1: 0 });
  const doFlash = (t) => setFlash((f) => ({ ...f, [t]: (f[t] || 0) + 1 }));
  useFx(st, {
    buzz: (t) => { sfx.play(t === 1 ? 'buzz1' : 'buzz0'); doFlash(t); },
    turn: (t) => doFlash(t),
    timeout: () => { if (st.turn === 0 || st.turn === 1) doFlash(st.turn); },
    pick: () => sfx.play('pick'),
    claim: () => sfx.play('correct'),
    wrong: () => sfx.play('wrong'),
    missed: () => sfx.play('wrong'),
    roundWon: () => sfx.play('round'),
    match: () => sfx.play('round'),
  });
  const left = useClock(st.phase === 'answer' ? st.timer : null, offset, () => sfx.play('timeUp'));
  const style = teamVars(colors);

  if (st.phase === 'lobby') {
    return (
      <div className="hf-root hf-screen hf-board-screen" dir="rtl" lang="ar" style={style}>
        <section className="hf-lobby">
          <div className="hf-lobby-brand">
            <img src="/img/huroof-logo.png" alt="تحدي الحروف" width="400" height="400" />
            <p>بانتظار المقدم لبدء المباراة</p>
          </div>
          <div className="hf-lobby-teams">
            {[0, 1].map((t) => {
              const team = teams[t];
              return (
                <div key={t} className={`hf-lobby-team hf-t${t}`}>
                  <h2>{names[t]}</h2>
                  <SidesGlyph team={t} />
                  <p className="hf-count">{teamDesc(t)}</p>
                  {team?.members?.length > 0 && (
                    <p className="hf-count">{team.members.map((m) => m.name).join('، ')}</p>
                  )}
                </div>
              );
            })}
            <p className="hf-lobby-note">كل فريق يضغط من جهازه عندما يعرف الإجابة.{stake ? ` الرهان: ${stake} نقطة.` : ''}</p>
          </div>
        </section>
        <div className="hf-corner"><Logos />{clockText && <span className={`hf-clock ${clockUrgent ? 'hf-urgent' : ''}`}>{clockText}</span>}</div>
      </div>
    );
  }

  const p = st.phase;
  const name = (t) => names[t];
  const teamNote = (t) => {
    if ((p === 'roundOver' || p === 'matchOver') && st.roundWinner === t) return 'ربط ضلعيه';
    if (p === 'pick' && st.chooser === t) return 'يختار الحرف';
    if (p === 'answer' && st.turn === t) return st.buzzer === t ? 'ضغط أولاً ويجيب الآن' : 'يجيب الآن';
    if ((p === 'answer' || p === 'missed') && st.tried[t]) return 'أخطأ في هذا السؤال';
    return teamDesc(t);
  };
  const cell = st.sel >= 0 ? st.cells[st.sel] : null;
  const q = st.q || {};

  let nowEl;
  if (p === 'roundOver' || p === 'matchOver') {
    const w = st.roundWinner;
    nowEl = (
      <div className={`hf-now hf-won hf-t${w}`}>
        {p === 'matchOver' ? (
          <>
            <h2>{name(w)} يفوز بالمباراة</h2>
            <p>النتيجة النهائية {st.score[w]} مقابل {st.score[1 - w]}.</p>
          </>
        ) : (
          <>
            <h2>{name(w)} يفوز بالجولة {st.round}</h2>
            <p>النتيجة {st.score[w]} مقابل {st.score[1 - w]}، والمباراة لمن يكسب {roundsWord(st.settings.roundsToWin)}.</p>
            {st.last?.a && <p>آخر حرف {st.last.l}: {st.last.a}</p>}
          </>
        )}
      </div>
    );
  } else {
    let top;
    const body = [];
    if (p === 'pick') {
      if (st.last) {
        top = <><div className={`hf-now-letter hf-t${st.last.team}`}>{st.last.l}</div><div className="hf-now-status"><Tn t={st.last.team} names={names} /> أخذ حرف {st.last.l}</div></>;
        if (st.last.a) body.push(<div key="a" className="hf-now-answer">{st.last.a}</div>);
      } else {
        top = <><div className="hf-now-letter hf-empty" /><div className="hf-now-status"><Tn t={st.chooser} names={names} /> يختار الحرف الأول</div></>;
      }
      body.push(<p key="r" className="hf-now-rule">الإجابة الصحيحة تمنح الفريق الحرف، ويفوز بالجولة أول فريق يصل بين ضلعيه.</p>);
      if (st.last) body.push(<div key="n" className="hf-now-status"><Tn t={st.chooser} names={names} /> يختار الحرف التالي</div>);
    } else if (cell) {
      let status = '';
      if (p === 'question') status = 'السؤال مفتوح، أول من يضغط يجيب';
      if (p === 'answer') status = <><Tn t={st.turn} names={names} /> يجيب</>;
      if (p === 'missed') status = 'لم يُجب أي فريق';
      top = <><div className="hf-now-letter">{cell.l}</div><div className="hf-now-status">{status}</div></>;
      if (q.q) body.push(<p key="q" className="hf-now-question">{q.q}</p>);
      if (q.a) body.push(<div key="a" className="hf-now-answer">{q.a}</div>);
      if (p === 'answer' && st.timer && left !== null) {
        body.push(
          <div key="t" className={`hf-timer-row hf-t${st.turn}`}>
            <div className={`hf-timer ${left <= 0 ? 'hf-out' : ''}`}><i style={{ transform: `scaleX(${st.timer.total ? left / st.timer.total : 0})` }} /></div>
            <span className="hf-timer-num">{Math.ceil(left)}</span>
          </div>,
        );
      }
    }
    nowEl = <div className="hf-now"><div className="hf-now-top">{top}</div>{body}</div>;
  }

  return (
    <div className="hf-root hf-screen hf-board-screen" dir="rtl" lang="ar" style={style}>
      <main className="hf-stage">
        <section className="hf-rail" aria-live="polite">
          <div className="hf-rail-head">
            <img src="/img/huroof-logo.png" alt="تحدي الحروف" width="76" height="76" />
            <div className="hf-rail-meta">
              <Logos />
              <span className="hf-round-label">
                الجولة {st.round}{stake ? <small> · ±{stake}</small> : null}
                {clockText && <span className={`hf-clock ${clockUrgent ? 'hf-urgent' : ''}`} title="وقت التحديات">{clockText}</span>}
              </span>
            </div>
          </div>
          {[0, 1].map((t) => {
            const pips = Array.from({ length: st.settings.roundsToWin }, (_, k) => <i key={k} className={k < st.score[t] ? 'hf-on' : ''} />);
            return (
              <div key={`${t}-${flash[t]}`} className={`hf-team hf-t${t} ${p === 'answer' && st.turn === t ? 'hf-answering' : ''} ${flash[t] ? 'hf-flash' : ''}`}>
                <SidesGlyph team={t} />
                <div className="hf-team-name">{name(t)}</div>
                <div className="hf-pips" aria-label={`${st.score[t]} جولات`}>{pips}</div>
                <div className="hf-team-note">{teamNote(t)}</div>
              </div>
            );
          })}
          {nowEl}
        </section>
        <section className="hf-arena">
          <HuroofBoard board={st} colors={colors} names={names} />
        </section>
      </main>
    </div>
  );
}

/* ============================================================== PRESENTER */
const ICONS = {
  undo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z" /></svg>,
  soundOn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></svg>,
  soundOff: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  expand: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>,
  shrink: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>,
};

function Seg({ value, options, onPick }) {
  return (
    <div className="hf-seg" role="group">
      {options.map(([val, label]) => (
        <button key={String(val)} type="button" aria-pressed={String(val) === String(value)} onClick={() => onPick(val)}>{label}</button>
      ))}
    </div>
  );
}

function SettingsForm({ st, cmd }) {
  const s = st.fullSettings || st.settings;
  const set = (patch) => cmd('settings', { patch });
  return (
    <div className="hf-form">
      <div className="hf-field"><span>يفوز بالمباراة من يكسب</span><Seg value={s.roundsToWin} options={[[1, 'جولة'], [2, 'جولتين'], [3, '3 جولات']]} onPick={(v) => set({ roundsToWin: v })} /></div>
      <div className="hf-field"><span>وقت الإجابة</span><Seg value={s.answerTime} options={[[0, 'بلا وقت'], [5, '5 ث'], [8, '8 ث'], [12, '12 ث'], [20, '20 ث']]} onPick={(v) => set({ answerTime: v })} /></div>
      <div className="hf-field hf-full"><span>حجم اللوحة{st.phase !== 'lobby' ? '، يطبق من الجولة التالية' : ''}</span><Seg value={s.size} options={[[4, '4 × 4'], [5, '5 × 5']]} onPick={(v) => set({ size: v })} /></div>
      <label className="hf-toggle hf-full">
        <span>عرض نص السؤال على الشاشة الكبيرة<small>أوقفه إذا كنت تقرأ الأسئلة بصوتك فقط.</small></span>
        <input type="checkbox" checked={!!s.showQuestion} onChange={(e) => set({ showQuestion: e.target.checked })} />
      </label>
      <label className="hf-toggle hf-full">
        <span>إضافة البنك الإضافي ({st.bank ? st.bank.extra : 0} سؤالاً)<small>أسئلة منقولة من منتدى قديم ولم تراجع، وبعض إجاباتها خاطئة. البنك الأساسي {st.bank ? st.bank.main : 0} سؤالاً.</small></span>
        <input type="checkbox" checked={!!s.extraBank} onChange={(e) => set({ extraBank: e.target.checked })} />
      </label>
      <p className="hf-hint hf-full">إذا انتهى وقت الإجابة دون جواب، ينتقل السؤال تلقائياً إلى الفريق الآخر.</p>
    </div>
  );
}

/**
 * @param cmd       (type, payload) => Promise  — a presenter command on the live board
 * @param onSettle  (sideOrNull) => void         — confirm the result (null = the board's winner)
 * @param onAbort   () => void                   — cancel the match (no points)
 */
export function HfPresenter({ board: st, names, colors, stake, offset = 0, cmd, onSettle, onAbort, pending }) {
  const [sheet, setSheet] = useState(null); // {kind:'settings'|'cell', cell}
  const [confirm, setConfirm] = useState(null);
  const [full, setFull] = useState(false);
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem('huroof.hostSound') === '1'; } catch { return false; }
  });
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const play = (n) => soundRef.current && sfx.play(n);
  useFx(st, {
    buzz: (t) => { play(t === 1 ? 'buzz1' : 'buzz0'); navigator.vibrate?.(140); },
    claim: () => play('correct'),
    wrong: () => play('wrong'),
    missed: () => play('wrong'),
    timeout: () => play('timeUp'),
    roundWon: () => play('round'),
    match: () => play('round'),
  });
  const left = useClock(st.phase === 'answer' ? st.timer : null, offset, () => navigator.vibrate?.([80, 60, 80]));
  const p = st.phase;
  const name = (t) => names[t];

  const onCell = useCallback((i) => {
    const c = st.cells[i];
    if (c.o !== -1) {
      if (['pick', 'question', 'missed'].includes(p)) setSheet({ kind: 'cell', cell: i });
      return;
    }
    if (p === 'answer') return;
    if (p === 'question' && (st.tried[0] || st.tried[1])) return;
    if (p === 'roundOver' || p === 'matchOver' || p === 'lobby') return;
    if (i === st.sel) return;
    cmd('pick', { i });
  }, [st, p, cmd]);

  // keyboard shortcuts (laptop presenter), as in the original
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape' && sheet) { setSheet(null); return; }
      if (sheet) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); cmd('undo'); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && (p === 'question' || p === 'answer')) cmd('give', { team: 0 });
      else if ((e.code === 'Digit2' || e.code === 'Numpad2') && (p === 'question' || p === 'answer')) cmd('give', { team: 1 });
      else if (e.key === 'Enter' && p === 'answer' && !e.target.closest?.('button')) { e.preventDefault(); cmd('judge', { correct: true }); }
      else if (e.key === 'Backspace' && p === 'answer') { e.preventDefault(); cmd('judge', { correct: false }); }
      else if (e.code === 'KeyN' && ['question', 'answer', 'missed'].includes(p)) cmd('swap');
      else if (e.code === 'KeyR' && st.q) cmd('reveal');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p, st.q, sheet, cmd]);

  const cell = st.sel >= 0 ? st.cells[st.sel] : null;
  const qcard = (withAnswer = true) => (!st.q ? (
    <div className="hf-qcard"><div className="hf-now-letter">{cell?.l}</div>
      <p className="hf-qnone">لا يوجد سؤال محفوظ لهذا الحرف. اطرح سؤالاً من عندك يبدأ جوابه بحرف {cell?.l}.</p></div>
  ) : (
    <>
      <div className="hf-qcard">
        <div className="hf-now-letter">{cell?.l}</div>
        <p className="hf-qtext">{st.q.q}</p>
        {withAnswer && <div className="hf-qanswer"><span className="hf-lbl">الإجابة</span><b>{st.q.a}</b></div>}
      </div>
      {st.q.src === 'forum' && <p className="hf-qwarn">من البنك الإضافي: تأكد من صحة الإجابة قبل اعتمادها.</p>}
    </>
  ));
  const revealBtn = st.q ? (
    <button className="hf-btn hf-btn-ghost" type="button" onClick={() => cmd('reveal')}>{st.reveal ? 'إخفاء الإجابة عن الشاشة' : 'إظهار الإجابة على الشاشة'}</button>
  ) : null;

  let panel = null;
  if (p === 'lobby') {
    panel = (
      <>
        <div className="hf-p-title">إعداد المباراة</div>
        <p className="hf-p-sub"><Tn t={0} names={names} /> ({teamDesc(0)}) ضد <Tn t={1} names={names} /> ({teamDesc(1)}). الرهان {stake} نقطة.</p>
        <SettingsForm st={st} cmd={cmd} />
        <div className="hf-row">
          <button className="hf-btn hf-btn-primary hf-btn-lg" type="button" onClick={() => cmd('start')} data-testid="hf-start">ابدأ المباراة</button>
        </div>
        <p className="hf-hint">يختار أحد الفريقين عشوائياً ليبدأ. كل فريق يضغط من جهازه، ويمكنك أيضاً اختيار الفريق الذي يجيب بنفسك.</p>
      </>
    );
  } else if (p === 'pick') {
    panel = (
      <>
        <div className="hf-p-title"><Tn t={st.chooser} names={names} /> يختار الحرف</div>
        <p className="hf-p-sub">اضغط في اللوحة على الحرف الذي يطلبه الفريق.</p>
        {st.last && (
          <>
            <div className="hf-divider" />
            <p className="hf-p-sub">آخر حرف: {st.last.l} ذهب إلى <Tn t={st.last.team} names={names} />{st.last.a ? `، والإجابة ${st.last.a}` : ''}.</p>
          </>
        )}
        <p className="hf-hint">لتصحيح خلية محسومة اضغط عليها. زر التراجع في الأعلى يلغي آخر خطوة.</p>
      </>
    );
  } else if (p === 'question') {
    panel = (
      <>
        {qcard()}
        <div className="hf-status-line"><i className="hf-dot hf-live" />الأزرار مفتوحة، أول من يضغط يجيب</div>
        <div className="hf-row">
          {[0, 1].map((t) => (
            <button key={t} className={`hf-btn hf-btn-team hf-t${t} hf-btn-lg`} type="button" disabled={st.tried[t]} onClick={() => cmd('give', { team: t })}>{name(t)} يجيب</button>
          ))}
        </div>
        <div className="hf-row">
          <button className="hf-btn hf-btn-ghost" type="button" onClick={() => cmd('swap')}>سؤال آخر</button>
          {revealBtn}
          <button className="hf-btn hf-btn-ghost" type="button" onClick={() => cmd('unpick')}>إلغاء الحرف</button>
        </div>
      </>
    );
  } else if (p === 'answer') {
    const t = st.turn;
    const how = st.buzzer === t && !st.tried[1 - t] ? 'ضغط الزر أولاً' : st.tried[1 - t] ? `بعد خطأ ${name(1 - t)}` : 'اخترته أنت';
    const otherCanTake = !st.tried[1 - t];
    panel = (
      <>
        <div className={`hf-answering-box hf-t${t}`}>
          <div className="hf-who">{name(t)} يجيب<small>{how}</small></div>
          {st.timer && left !== null && <span className="hf-timer-num">{Math.ceil(left)}</span>}
        </div>
        {st.q ? <div className="hf-qanswer"><span className="hf-lbl">الإجابة</span><b>{st.q.a}</b></div> : <p className="hf-qnone">لا يوجد سؤال محفوظ. احكم بنفسك.</p>}
        <div className="hf-judge">
          <button className="hf-btn hf-btn-ok" type="button" onClick={() => cmd('judge', { correct: true })} data-testid="hf-correct">إجابة صحيحة</button>
          <button className="hf-btn hf-btn-no" type="button" onClick={() => cmd('judge', { correct: false })} data-testid="hf-wrong">إجابة خاطئة</button>
        </div>
        <p className="hf-hint">
          {otherCanTake ? `إذا كانت خاطئة أو انتهى الوقت ينتقل السؤال مباشرة إلى ${name(1 - t)}.` : 'إذا كانت خاطئة يبقى الحرف مفتوحاً.'}
        </p>
        <div className="hf-divider" />
        {st.q && <p className="hf-qtext">{st.q.q}</p>}
        <div className="hf-row">
          {st.settings.answerTime ? <button className="hf-btn hf-btn-ghost" type="button" onClick={() => cmd('timer', { cmd: 'restart' })}>إعادة الوقت</button> : null}
          <button className="hf-btn hf-btn-ghost" type="button" onClick={() => cmd('swap')}>سؤال آخر</button>
          {revealBtn}
        </div>
        {otherCanTake && <button className="hf-btn hf-btn-ghost" type="button" onClick={() => cmd('give', { team: 1 - t })}>الدور خطأ، أعطه لـ{name(1 - t)}</button>}
      </>
    );
  } else if (p === 'missed') {
    panel = (
      <>
        <div className="hf-p-title">لم يُجب أي فريق</div>
        {qcard()}
        <div className="hf-row">
          <button className="hf-btn hf-btn-primary hf-btn-lg" type="button" onClick={() => cmd('swap')}>سؤال آخر للحرف نفسه</button>
          <button className="hf-btn hf-btn-ghost hf-btn-lg" type="button" onClick={() => cmd('unpick')}>اختيار حرف آخر</button>
        </div>
        <div className="hf-row">{revealBtn}</div>
        <p className="hf-hint"><Tn t={st.chooser} names={names} /> ما زال صاحب الاختيار.</p>
      </>
    );
  } else if (p === 'roundOver') {
    const w = st.roundWinner;
    panel = (
      <>
        <div className="hf-p-title"><Tn t={w} names={names} /> فاز بالجولة {st.round}</div>
        <p className="hf-p-sub">النتيجة {st.score[w]} مقابل {st.score[1 - w]}. المباراة لمن يكسب {roundsWord(st.settings.roundsToWin)}.</p>
        <p className="hf-p-sub"><Tn t={1 - w} names={names} /> يبدأ الجولة التالية بحروف جديدة.</p>
        <button className="hf-btn hf-btn-primary hf-btn-lg" type="button" onClick={() => cmd('nextRound')}>ابدأ الجولة التالية</button>
      </>
    );
  } else if (p === 'matchOver') {
    const w = st.matchWinner;
    panel = (
      <>
        <div className="hf-p-title"><Tn t={w} names={names} /> فاز بالمباراة</div>
        <p className="hf-p-sub">النتيجة النهائية {st.score[w]} مقابل {st.score[1 - w]}.</p>
        <button className="hf-btn hf-btn-primary hf-btn-lg" type="button" disabled={pending} onClick={() => onSettle(null)} data-testid="hf-settle">
          اعتماد النتيجة: +{stake} لـ{name(w)} و−{stake} لـ{name(1 - w)}
        </button>
        <p className="hf-hint">بعد الاعتماد تنتقل النقاط وتبدأ المباراة التالية في قائمة الانتظار. زر التراجع يلغي آخر حكم إذا كان خاطئاً.</p>
      </>
    );
  }

  let sheetEl = null;
  if (sheet?.kind === 'settings') {
    sheetEl = (
      <>
        <div className="hf-sheet-head"><h2>الإعدادات</h2><button className="hf-icon-btn" type="button" aria-label="إغلاق" onClick={() => setSheet(null)}>{ICONS.close}</button></div>
        <SettingsForm st={st} cmd={cmd} />
        <div className="hf-divider" />
        <div className="hf-p-sub">فرض النتيجة (عند خلل أو انسحاب)</div>
        <div className="hf-row">
          {[0, 1].map((t) => (
            <button key={t} className={`hf-btn hf-btn-team hf-t${t}`} type="button" onClick={() => setConfirm({ t })}>
              {confirm?.t === t ? `اضغط مرة أخرى: فوز ${name(t)}` : `فوز ${name(t)}`}
            </button>
          ))}
        </div>
        {confirm?.t !== undefined && (
          <div className="hf-row">
            <button className="hf-btn hf-btn-primary" type="button" onClick={() => { const t = confirm.t; setConfirm(null); setSheet(null); onSettle(t); }}>
              تأكيد فوز {name(confirm.t)} (±{stake})
            </button>
            <button className="hf-btn hf-btn-ghost" type="button" onClick={() => setConfirm(null)}>تراجع</button>
          </div>
        )}
        <div className="hf-row">
          <button className={`hf-btn ${confirm?.abort ? 'hf-btn-primary' : 'hf-btn-ghost'}`} type="button"
            onClick={() => { if (!confirm?.abort) setConfirm({ abort: true }); else { setConfirm(null); setSheet(null); onAbort(); } }}>
            {confirm?.abort ? 'اضغط مرة أخرى لإلغاء المباراة بدون نقاط' : 'إلغاء المباراة (بدون نقاط)'}
          </button>
        </div>
        <p className="hf-hint">اختصارات لوحة المفاتيح: 1 و2 لإعطاء الدور، Enter للإجابة الصحيحة، Backspace للخاطئة، N لسؤال آخر، R لإظهار الإجابة، Ctrl+Z للتراجع.</p>
      </>
    );
  } else if (sheet?.kind === 'cell') {
    const c = st.cells[sheet.cell];
    if (c) {
      const owner = c.o === 0 ? name(0) : c.o === 1 ? name(1) : 'لا أحد';
      const set = (o) => { setSheet(null); cmd('setOwner', { i: sheet.cell, o }); };
      sheetEl = (
        <>
          <div className="hf-sheet-head"><h2>حرف {c.l}</h2><button className="hf-icon-btn" type="button" aria-label="إغلاق" onClick={() => setSheet(null)}>{ICONS.close}</button></div>
          <p className="hf-p-sub">الخلية الآن لـ{owner}.</p>
          <div className="hf-row">
            {[0, 1].map((t) => (c.o === t ? null : <button key={t} className={`hf-btn hf-btn-team hf-t${t}`} type="button" onClick={() => set(t)}>أعطه لـ{name(t)}</button>))}
            {c.o !== -1 && <button className="hf-btn hf-btn-ghost" type="button" onClick={() => set(-1)}>إفراغ الخلية</button>}
          </div>
        </>
      );
    }
  }

  return (
    <div className={`hf-root hf-host-screen ${full ? 'hf-screen' : 'hf-embedded'}`} dir="rtl" lang="ar" data-phase={p} style={teamVars(colors)}>
      <header className="hf-hbar">
        <div className="hf-hscore">
          {[0, 1].map((t) => (
            <span key={t} style={{ display: 'contents' }}>
              {t === 1 && <span className="hf-vs">مقابل</span>}
              <div className={`hf-hs-team hf-t${t} ${p === 'pick' && st.chooser === t ? 'hf-picking' : ''}`}><span className="hf-sc">{st.score[t]}</span><span className="hf-nm">{name(t)}</span></div>
            </span>
          ))}
        </div>
        <span className="hf-hround">{p === 'lobby' ? '' : `الجولة ${st.round}`} · ±{stake}</span>
        <nav>
          <button className="hf-icon-btn" type="button" title="تراجع عن آخر خطوة" aria-label="تراجع عن آخر خطوة" disabled={!st.undo} style={{ opacity: st.undo ? undefined : 0.35 }} onClick={() => cmd('undo')}>{ICONS.undo}</button>
          <button className="hf-icon-btn" type="button" title={full ? 'تصغير' : 'ملء الشاشة'} aria-label={full ? 'تصغير' : 'ملء الشاشة'} onClick={() => setFull(!full)}>{full ? ICONS.shrink : ICONS.expand}</button>
          <button className="hf-icon-btn" type="button" title={soundOn ? 'صوت هذا الجهاز يعمل' : 'صوت هذا الجهاز مكتوم'} aria-label="صوت هذا الجهاز"
            onClick={() => { const v = !soundOn; setSoundOn(v); try { localStorage.setItem('huroof.hostSound', v ? '1' : '0'); } catch { /* ignore */ } }}>{soundOn ? ICONS.soundOn : ICONS.soundOff}</button>
          <button className="hf-icon-btn" type="button" title="الإعدادات" aria-label="الإعدادات" onClick={() => { setConfirm(null); setSheet({ kind: 'settings' }); }}>{ICONS.gear}</button>
        </nav>
      </header>
      <main className="hf-hmain">
        <section className="hf-hboard">
          <HuroofBoard board={st} colors={colors} names={names} onCell={onCell} />
        </section>
        <section className="hf-hpanel" aria-live="polite">{panel}</section>
      </main>
      {sheetEl && (
        <div className="hf-sheet" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="hf-sheet-card" role="dialog" aria-modal="true">{sheetEl}</div>
        </div>
      )}
    </div>
  );
}

/* ================================================================ BUZZER */
export function HfBuzzer({ board: s, side, names, colors, stake, onBuzz }) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState('');
  const team = side;
  const other = 1 - side;
  useFx(s, {
    claim: () => sfx.play('correct'),
    wrong: (t) => t === side && sfx.play('wrong'),
    roundWon: () => sfx.play('round'),
    match: () => sfx.play('round'),
  });
  useEffect(() => { setNote(''); }, [s.phase, s.turn, s.sel]);

  const [state, msg, sub] = useMemo(() => {
    if (s.phase === 'lobby') return ['idle', 'بانتظار بدء المباراة', 'اترك هذه الصفحة مفتوحة.'];
    if (s.phase === 'roundOver' || s.phase === 'matchOver') {
      const won = s.roundWinner === team;
      const what = s.phase === 'matchOver' ? 'المباراة' : 'الجولة';
      return ['over', won ? `فزتم ب${what}` : `انتهت ${what}`, won ? 'أحسنتم.' : 'استعدوا للجولة القادمة.'];
    }
    if (s.phase === 'answer') {
      if (s.turn === team) return ['mine', 'أجيبوا الآن', s.buzzer === team ? 'ضغطتم أولاً.' : ''];
      if (s.tried[team]) return ['out', 'أخطأتم في هذا السؤال', 'الدور الآن للفريق الآخر.'];
      return ['theirs', 'الفريق الآخر يجيب', 'إذا أخطأ أو انتهى وقته يصبح السؤال لكم.'];
    }
    if (s.phase === 'question') {
      if (s.armed) return ['ready', 'اضغطوا عندما تعرفون الإجابة', ''];
      return ['out', 'انتظروا', ''];
    }
    if (s.phase === 'missed') return ['idle', 'لم يُجب أي فريق', 'انتظروا السؤال التالي.'];
    return ['idle', s.phase === 'pick' ? (s.chooser === team ? 'اختاروا الحرف التالي' : 'بانتظار اختيار الحرف') : 'انتظروا', ''];
  }, [s, team]);

  const press = async (e) => {
    e.preventDefault();
    if (pending || state !== 'ready') return;
    setPending(true);
    navigator.vibrate?.(60);
    sfx.play('pick');
    const res = await onBuzz();
    if (res?.ok && res.accepted === false) setNote('سبقكم الفريق الآخر');
    setTimeout(() => setPending(false), 120);
  };

  // space / enter also buzz (keyboard devices)
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' || e.key === 'Enter') pressRef.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`hf-root hf-screen hf-buzz-screen hf-t${team}`} dir="rtl" lang="ar" data-state={state} style={teamVars(colors)} onContextMenu={(e) => e.preventDefault()}>
      <header className="hf-bz-head">
        <div className="hf-bz-team">{names[team]}</div>
        <Logos />
        <div className="hf-bz-score">{s.score[team]} مقابل {s.score[other]}{stake ? <small> · ±{stake}</small> : null}</div>
      </header>
      <main className="hf-bz-body">
        <div className="hf-bz-letter">
          {s.letter && s.phase !== 'pick' ? <><div className="hf-now-letter">{s.letter}</div><span>الحرف الحالي</span></> : null}
        </div>
        <button className={`hf-bz-btn ${pending ? 'hf-down' : ''}`} type="button" onPointerDown={press} disabled={state !== 'ready'} data-testid="buzz">
          {state === 'mine' ? 'دوركم' : 'اضغط'}
        </button>
        <div className="hf-bz-msg" aria-live="assertive">
          {note || msg}
          {!note && sub && <small>{sub}</small>}
        </div>
      </main>
    </div>
  );
}

/** QR code as an inline SVG (used by the stage lobby when needed). */
export function QrSvg({ text, className = 'hf-qr' }) {
  const svg = useMemo(() => {
    if (!text) return '';
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
