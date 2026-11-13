// N7 Quiz — the third mini-game. Same look, rules and scoring as the original
// n7-quiz (N7GD × N7SEC): 20 questions, 20 s each, EN/FR, score revealed at the end.
// The server owns the deck, the clock and the answers; this screen only shows
// the current question and sends the team's choice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../../lib/audio.js';
import { toast } from '../../components/common.jsx';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import './quiz.css';

const LOCK_DELAY = 700; // ms before the final screen after the last answer
const LANG_KEY = 'ucp.quiz.lang';

const Translate = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" /></svg>
);
const VolumeUp = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
);
const VolumeOff = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
);

// Every string the team sees, per language. Question text comes from the server.
const UI = {
  en: {
    how: (r) => [
      `Answer ${r.n} questions about gaming and basic security, in random order. They come in three levels: easy, medium and hard.`,
      `You get ${r.timeLimit} seconds per question. Agree on one answer with your team and select it.`,
      `Correct answers earn up to ${r.maxPoints} points, and faster is better. Medium questions count ×${r.mult[2]}, hard ones ×${r.mult[3]}.`,
      `You won't see if an answer was right or wrong. Your score is revealed at the end.`,
      `Your team plays once. Leaving the tab or window during the quiz is recorded.`,
    ],
    team: 'Team', start: 'Start', ready: 'Get ready', skip: 'Skip this question',
    outOf: (m) => `out of ${m} points`, mute: 'Mute sound', unmute: 'Unmute sound', language: 'Language',
    warn: 'You left the quiz. This was recorded.', next: 'Continue',
    net: 'Connection problem. Check your network and try again.',
    stopped: 'Time is up for the mini-games: the quiz stopped here.',
  },
  fr: {
    how: (r) => [
      `Réponds à ${r.n} questions sur le gaming et la sécurité de base, dans un ordre aléatoire. Il y a trois niveaux : facile, moyen et difficile.`,
      `Tu as ${r.timeLimit} secondes par question. Choisissez une réponse en équipe et sélectionnez-la.`,
      `Une bonne réponse rapporte jusqu'à ${r.maxPoints} points, et plus tu es rapide, mieux c'est. Les questions moyennes comptent ×${r.mult[2]}, les difficiles ×${r.mult[3]}.`,
      `Tu ne verras pas si une réponse est juste ou fausse. Le score est révélé à la fin.`,
      `Ton équipe joue une seule fois. Quitter l'onglet ou la fenêtre pendant le quiz est enregistré.`,
    ],
    team: 'Équipe', start: 'Commencer', ready: 'Prépare-toi', skip: 'Passer cette question',
    outOf: (m) => `sur ${m} points`, mute: 'Couper le son', unmute: 'Activer le son', language: 'Langue',
    warn: 'Tu as quitté le quiz. Cela a été enregistré.', next: 'Continuer',
    net: 'Problème de connexion. Vérifie ton réseau et réessaie.',
    stopped: 'Le temps des mini-jeux est écoulé : le quiz s’est arrêté ici.',
  },
};

/** The newest of two quiz states (live stream vs. the answer we just sent). */
function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if ((a.phase === 'done') !== (b.phase === 'done')) return a.phase === 'done' ? a : b;
  if (a.phase !== b.phase) return a.phase === 'play' ? a : b;
  return (b.answered || 0) > (a.answered || 0) ? b : a;
}

export default function Quiz({ data, act, team, offset = 0, onContinue }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem(LANG_KEY) === 'fr' ? 'fr' : 'en'; } catch { return 'en'; }
  });
  const [local, setLocal] = useState(null);
  const srv = newer(data, local);
  const [shown, setShown] = useState(null); // the question currently on screen
  const [now, setNow] = useState(() => Date.now() + offset);
  const [picked, setPicked] = useState(null);
  const [locked, setLocked] = useState(false);
  const [muted, setMuted] = useState(sfx.muted);
  const [warn, setWarn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(srv?.phase === 'done');

  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const srvRef = useRef(srv);
  srvRef.current = srv;
  const shownRef = useRef(null);
  const lockedRef = useRef(false);
  const tickRef = useRef(0);
  const cdRef = useRef(-1);
  const switchesRef = useRef(data?.switches || 0);
  const T = UI[lang];
  const L = lang === 'fr' ? 1 : 0;
  const rules = srv?.rules || { n: 20, timeLimit: 20, maxPoints: 10, mult: { 2: 1.5, 3: 2 } };
  const TIME_LIMIT = rules.timeLimit;

  useEffect(() => sfx.subscribe(setMuted), []);
  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  }, [lang]);

  // the final screen appears a moment after the last answer, like the original
  useEffect(() => {
    if (srv?.phase !== 'done' || showDone) return undefined;
    const id = setTimeout(() => { setShowDone(true); sfx.play('qFinish'); }, shownRef.current ? LOCK_DELAY : 0);
    return () => clearTimeout(id);
  }, [srv?.phase, showDone]);

  const submit = useCallback(async (choice) => {
    const sh = shownRef.current;
    if (!sh || lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    setPicked(choice);
    sfx.play(choice === null ? 'qTimeout' : 'qSelect');
    const res = await act('quizAnswer', { qid: sh.id, choice, tabSwitches: switchesRef.current });
    if (res.ok && res.quiz) {
      setLocal(res.quiz);
      setError('');
    } else if (!res.ok) {
      if (res.status === 409) return; // the mini-games are over: the live state takes over
      setError('net');
      lockedRef.current = false;
      setLocked(false);
      setPicked(null);
    }
  }, [act]);

  // One clock drives the countdown, question swaps, tick sounds and timeouts.
  useEffect(() => {
    if (srv?.phase !== 'play') return undefined;
    const id = setInterval(() => {
      const n = Date.now() + offsetRef.current;
      setNow(n);
      const s = srvRef.current;
      if (!s || s.phase !== 'play') return;
      if (!shownRef.current && n < s.q.qStart) { // 3-2-1 before the first question
        const c = Math.ceil((s.q.qStart - n) / 1000);
        if (c !== cdRef.current) { cdRef.current = c; sfx.play('qCount'); }
      }
      if (shownRef.current?.id !== s.q.id && n >= s.q.qStart) { // next question's start time reached
        const first = !shownRef.current;
        shownRef.current = s.q;
        setShown(s.q);
        lockedRef.current = false;
        setLocked(false);
        setPicked(null);
        tickRef.current = TIME_LIMIT;
        sfx.play(first ? 'qGo' : 'qNext');
        return;
      }
      const sh = shownRef.current;
      if (sh && sh.id === s.q.id && !lockedRef.current) {
        const rem = TIME_LIMIT - (n - sh.qStart) / 1000;
        const c = Math.ceil(rem);
        if (c !== tickRef.current) {
          tickRef.current = c;
          if (c > 0 && c <= 5) sfx.play('qTick');
        }
        if (rem <= 0) submit(null);
      }
    }, 100);
    return () => clearInterval(id);
  }, [srv?.phase, submit, TIME_LIMIT]);

  // Anti-cheat: count every time the team leaves the tab or window.
  useEffect(() => {
    if (srv?.phase !== 'play') return undefined;
    let away = false;
    let timer = null;
    const leave = () => { if (!away) { away = true; switchesRef.current += 1; } };
    const back = () => {
      if (!away) return;
      away = false;
      setWarn(true);
      clearTimeout(timer);
      timer = setTimeout(() => setWarn(false), 4000);
      act('quizReport', { tabSwitches: switchesRef.current });
    };
    const vis = () => (document.hidden ? leave() : back());
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [srv?.phase, act]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    sfx.unlock();
    sfx.play('qStart');
    shownRef.current = null;
    setShown(null);
    cdRef.current = -1;
    const res = await act('quizStart');
    setBusy(false);
    if (res.ok && res.quiz) setLocal(res.quiz);
    else if (!res.ok) toast(res.error, 'error');
  };

  const phase = srv?.phase || 'intro';
  const left = shown ? Math.min(TIME_LIMIT, Math.max(0, TIME_LIMIT - (now - shown.qStart) / 1000)) : TIME_LIMIT;
  const playing = phase === 'play';
  const urgent = playing && shown && !locked && left > 0 && left <= 5;
  const countdown = playing && !shown ? Math.max(1, Math.ceil((srv.q.qStart - now) / 1000)) : 0;
  const teamName = team?.name || '';

  return (
    <main className="qz-root" onContextMenu={(e) => playing && e.preventDefault()} onCopy={(e) => playing && e.preventDefault()}>
      <div className="qz-wrap">
        {urgent && <div className="qz-alarm" aria-hidden="true" />}
        <header className="qz-bar">
          <div className="qz-brand">
            <img src="/quiz/n7gd.png" alt="N7GD" />
            <span className="qz-sep" />
            <img src="/quiz/n7sec.jpg" alt="N7SEC" />
          </div>
          <div className="qz-ctrls">
            {teamName && (
              <div className="qz-chip" title={`${T.team} ${teamName}`}>
                <span className="qz-avatar" style={team?.colorHex ? { background: team.colorHex } : undefined}>{teamName.trim()[0]?.toUpperCase()}</span>
                <span className="qz-chip-name">{teamName}</span>
              </div>
            )}
            <div className="qz-seg" role="group" aria-label={T.language}>
              <Translate />
              {['en', 'fr'].map((l) => (
                <button key={l} type="button" className={lang === l ? 'qz-on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <button type="button" className="qz-mute" onClick={() => sfx.setMuted(!muted)} aria-pressed={muted} aria-label={muted ? T.unmute : T.mute}>
              {muted ? <VolumeOff /> : <VolumeUp />}
            </button>
          </div>
        </header>

        {warn && <div className="qz-warn" role="alert">{T.warn}</div>}

        <section className="qz-grow">
          {phase === 'intro' && (
            <div className="qz-hero">
              <h1 className="qz-px">N7 QUIZ</h1>
              <ol className="qz-how">
                {T.how(rules).map((line, i) => <li key={i}>{line}</li>)}
              </ol>
              <div><button type="button" className="qz-btn" disabled={busy} onClick={start} data-testid="quiz-start">{T.start}</button></div>
            </div>
          )}

          {countdown > 0 && (
            <div className="qz-countdown">
              <div key={countdown} className="qz-count-num qz-px">{countdown}</div>
              <p>{T.ready}</p>
            </div>
          )}

          {playing && shown && (
            <div key={shown.id} className="qz-game">
              <div className="qz-meta">
                <span className="qz-count qz-px">{shown.id + 1}/{srv.total}</span>
                <span className={`qz-clock ${urgent ? 'qz-hot' : ''}`}>{Math.ceil(left)}s</span>
              </div>
              <div className={`qz-bar-t ${urgent ? 'qz-low' : ''}`}>
                <i style={{ width: `${(left / TIME_LIMIT) * 100}%` }} />
              </div>
              <h2 className="qz-q">{shown.text[L]}</h2>
              <div className="qz-opts">
                {shown.options.map((o, i) => (
                  <button key={i} type="button" disabled={locked}
                    className={`qz-opt ${picked === i ? 'qz-picked' : locked && picked !== null ? 'qz-dim' : ''}`}
                    onClick={() => submit(i)} data-testid={`quiz-opt-${i}`}>
                    {o[L]}
                  </button>
                ))}
              </div>
              <div className="qz-skip-row">
                <button type="button" className="qz-skip" disabled={locked} onClick={() => submit(null)} data-testid="quiz-skip">{T.skip}</button>
              </div>
              {error === 'net' && <p className="qz-err" role="alert">{T.net}</p>}
            </div>
          )}

          {phase === 'done' && showDone && (
            <div className="qz-done" data-testid="quiz-done">
              <h1 className="qz-px" style={{ fontSize: '1.1rem' }}>{teamName}</h1>
              <div className="qz-score qz-px">{srv.score}</div>
              <p>{T.outOf(srv.max)}</p>
              {data?.status === 'abandoned' && srv.answered < srv.total && <p className="qz-err">{T.stopped}</p>}
              {onContinue && <button type="button" className="qz-btn" onClick={onContinue}>{T.next}</button>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
