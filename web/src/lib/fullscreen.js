// Full screen helpers. Browsers only allow full screen right after a tap.
// iPhones do not support it for web pages: "Add to Home Screen" is the way there.

export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

export const canFullscreen = () => {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
};

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

/** Returns true when the page is in full screen afterwards. */
export async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (!isFullscreen()) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } catch {
    /* refused: the app still works */
  }
  keepAwake();
  // Safari applies webkitRequestFullscreen a moment later
  if (!isFullscreen()) await new Promise((r) => setTimeout(r, 120));
  return isFullscreen();
}

let wakeLock = null;
export async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch {
    /* needs https; not critical */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLock === null && isFullscreen()) keepAwake();
  });
}
