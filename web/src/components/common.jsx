import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from '../lib/qrcode.js';
import { sfx } from '../lib/audio.js';
import { canFullscreen, enterFullscreen, isFullscreen, isStandalone } from '../lib/fullscreen.js';
import { inkOn } from '../lib/format.js';
import { usePublic } from '../lib/usePublic.js';

/* ------------------------------------------------------------- toasts -- */
const toastListeners = new Set();
let toastSeq = 0;
export function toast(text, kind = 'info') {
  const item = { id: ++toastSeq, text, kind };
  toastListeners.forEach((fn) => fn(item));
  if (kind === 'error') sfx.play('error');
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (item) => {
      setItems((list) => [...list.slice(-2), item]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), 3600);
    };
    toastListeners.add(add);
    return () => toastListeners.delete(add);
  }, []);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- brand bar -- */
export function MuteButton() {
  const [muted, setMuted] = useState(sfx.muted);
  useEffect(() => sfx.subscribe(setMuted), []);
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        sfx.setMuted(!muted);
        if (muted) sfx.play('toggle');
      }}
      aria-pressed={!muted}
      aria-label={muted ? 'Sound off' : 'Sound on'}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      {muted ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6M16 9l6 6" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
      )}
    </button>
  );
}

/** Both club logos, on every screen. */
export function BrandBar({ children, right, compact = false }) {
  return (
    <header className={`brandbar ${compact ? 'compact' : ''}`}>
      <div className="brand-logos">
        <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD — Game Dev club" /></span>
        <span className="brand-x" aria-hidden="true">×</span>
        <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC — Security club" /></span>
      </div>
      <div className="brand-center">{children}</div>
      <div className="brand-right">
        {right}
        <MuteButton />
      </div>
    </header>
  );
}

/* ------------------------------------------------------- full screen -- */
/**
 * Forces full screen on host and player screens: a first tap enters full
 * screen (and unlocks sound); leaving full screen shows a prompt to go back.
 */
export function FullscreenGuard({ title = 'Tap to start', text, onStart, children }) {
  const supported = useMemo(() => canFullscreen(), []);
  const [started, setStarted] = useState(false);
  const [refused, setRefused] = useState(false); // the browser said no: do not block the screen
  const [full, setFull] = useState(() => isFullscreen());

  useEffect(() => {
    const onChange = () => {
      const f = isFullscreen();
      setFull(f);
      if (f) setRefused(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const begin = async () => {
    sfx.unlock();
    sfx.play('click');
    const ok = await enterFullscreen();
    setFull(ok);
    setRefused(!ok);
    if (!started) {
      setStarted(true);
      onStart?.();
    }
  };

  const ios = /iP(hone|od|ad)/.test(navigator.userAgent) && !supported;
  const showGate = !started || (supported && !full && !refused);

  return (
    <>
      {children}
      {showGate && (
        <div className="fs-gate" onClick={begin} role="dialog" aria-modal="true" aria-label={title}>
          <div className="fs-gate-card" onClick={(e) => e.stopPropagation()}>
            <div className="fs-logos">
              <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD" /></span>
              <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC" /></span>
            </div>
            <h1>{started ? 'Back to full screen' : title}</h1>
            {!started && text && <p>{text}</p>}
            {started && <p>This screen must stay in full screen mode.</p>}
            <button type="button" className="btn btn-primary btn-lg" onClick={begin} autoFocus>
              {started ? 'Return to full screen' : 'Enter full screen'}
            </button>
            {ios && !isStandalone() && (
              <p className="muted small">iPhone/iPad: tap Share → “Add to Home Screen”, then open the app from its icon to play full screen.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- login -- */
const STRIPE = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#F43F5E', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#D946EF'];

/**
 * Split login: the event on the left, the code form on the right.
 * stageTitle/stageText describe what this screen is for.
 */
export function CodeLogin({ title, subtitle, label, placeholder, busy, error, onSubmit, initial = '', autoSubmit = false, maxLength = 20, footer, stageTitle, stageText }) {
  const [code, setCode] = useState(initial);
  const sent = useRef(false);
  const pub = usePublic(30000);
  const eventName = pub?.eventName || 'N7 Kickoff Cup';
  useEffect(() => {
    if (autoSubmit && initial && !sent.current) {
      sent.current = true;
      onSubmit(initial);
    }
  }, [autoSubmit, initial, onSubmit]);
  return (
    <div className="login-page">
      <aside className="login-stage">
        <a className="lp-brand" href="/">
          <span className="logo-chip light"><img src="/logos/n7gd.png" alt="N7GD" /></span>
          <span className="logo-chip dark"><img src="/logos/n7sec.png" alt="N7SEC" /></span>
          <span className="lp-brand-name">{eventName}</span>
        </a>
        <div>
          <h1>{stageTitle || eventName}</h1>
          {stageText && <p style={{ marginTop: 18 }}>{stageText}</p>}
        </div>
        <div className="login-stripe" aria-hidden="true">
          {STRIPE.map((c) => <i key={c} style={{ background: c }} />)}
        </div>
      </aside>
      <main className="login-main">
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            sfx.unlock();
            if (code.trim()) onSubmit(code.trim());
          }}
        >
          <a className="login-back" href="/">Back to the event page</a>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
          <label className="field">
            <span>{label}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={placeholder}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={maxLength}
              autoFocus
              className="code-input"
              aria-invalid={!!error}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Checking the code' : 'Continue'}
          </button>
          {footer}
        </form>
      </main>
    </div>
  );
}

/* ------------------------------------------------------- team pieces -- */
export function TeamDot({ color, size = 14 }) {
  return <span className="team-dot" style={{ background: color, width: size, height: size }} aria-hidden="true" />;
}

export function TeamTag({ team, className = '' }) {
  if (!team) return null;
  return (
    <span className={`team-tag ${className}`} style={{ background: team.colorHex, color: inkOn(team.colorHex) }}>
      {team.name}
    </span>
  );
}

export function QR({ text, size = 140 }) {
  const svg = useMemo(() => {
    if (!text) return '';
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [text]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Big 3-2-1-GO overlay. `endsAt` is the server time of GO. */
export function CountdownOverlay({ endsAt, now, label = 'Get ready' }) {
  const left = Math.ceil((endsAt - now) / 1000);
  const shown = left > 0 ? String(Math.min(left, 3)) : 'GO!';
  const last = useRef(null);
  useEffect(() => {
    if (last.current === shown) return;
    last.current = shown;
    sfx.play(shown === 'GO!' ? 'go' : 'tick');
  }, [shown]);
  return (
    <div className="countdown-overlay" aria-live="assertive">
      <p>{label}</p>
      <div key={shown} className={`countdown-num ${shown === 'GO!' ? 'go' : ''}`}>{shown}</div>
    </div>
  );
}

/** "GO!" flash shown for a moment right after the start. */
export function GoFlash({ startedAt, now }) {
  const [visible, setVisible] = useState(() => startedAt && now - startedAt < 1600);
  useEffect(() => {
    if (!visible) return undefined;
    sfx.play('go');
    const id = setTimeout(() => setVisible(false), 1400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!visible) return null;
  return (
    <div className="countdown-overlay fading" aria-live="assertive">
      <div className="countdown-num go">GO!</div>
    </div>
  );
}

export function ConnectionBadge({ connected }) {
  if (connected) return null;
  return <div className="conn-badge" role="status">Reconnecting…</div>;
}

export function Confirm({ title, text, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {text && <p className="muted">{text}</p>}
        <div className="row end">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Hook: confirm dialogs. Returns [element, ask(options) => Promise<boolean>]. */
export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const ask = (o) => new Promise((resolve) => setOpts({ ...o, resolve }));
  const el = opts ? (
    <Confirm
      {...opts}
      onConfirm={() => { opts.resolve(true); setOpts(null); }}
      onCancel={() => { opts.resolve(false); setOpts(null); }}
    />
  ) : null;
  return [el, ask];
}
