// A Fullscreen button under How to play, on touch screens whose browser can
// put a page fullscreen (Android, iPad; not iPhone, where Safari only does
// it for video). Going fullscreen also locks the screen sideways where the
// browser allows it (Android). The CSS keeps it off desktop.

type Prefixed = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type PrefixedEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = document as Prefixed;
const root = document.documentElement as PrefixedEl;
const button = document.getElementById('fullscreen') as HTMLButtonElement;

const supported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
const current = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

async function enter() {
  try {
    await (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
  } catch {
    return;
  }
  // Only works once fullscreen, and not everywhere: a bonus, not a must.
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation.lock?.('landscape').catch(() => {});
}

async function exit() {
  try {
    await (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
  } catch {
    // Already out.
  }
}

function show() {
  const on = !!current();
  button.textContent = on ? 'Exit fullscreen' : 'Fullscreen';
  button.setAttribute('aria-pressed', String(on));
}

export function mountFullscreen() {
  button.hidden = !supported;
  if (!supported) return;
  button.addEventListener('click', () => void (current() ? exit() : enter()));
  document.addEventListener('fullscreenchange', show);
  document.addEventListener('webkitfullscreenchange', show);
  show();
}
