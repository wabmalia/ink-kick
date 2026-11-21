// A fullscreen button beside How to play, on touch screens whose browser can
// put a page fullscreen (Android, iPad; not iPhone, where Safari only does
// it for video). Going fullscreen also locks the screen sideways where the
// browser allows it (Android). The CSS keeps it off desktop. Opened as an
// installed app (the arcade's home-screen app, say) there's no browser bar
// to hide, so there's no button either.

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

/** Running as an installed app rather than in a browser tab. */
function installed() {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // A fullscreen page also matches display-mode: fullscreen; an app opened
  // that way does without being asked.
  return standalone || matchMedia('(display-mode: standalone)').matches || (matchMedia('(display-mode: fullscreen)').matches && !current());
}

function show() {
  const on = !!current();
  const label = on ? 'Exit fullscreen' : 'Fullscreen';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.setAttribute('aria-pressed', String(on));
  button.hidden = !supported || (!on && installed());
}

export function mountFullscreen() {
  button.hidden = true;
  if (!supported) return;
  button.addEventListener('click', () => void (current() ? exit() : enter()));
  document.addEventListener('fullscreenchange', show);
  document.addEventListener('webkitfullscreenchange', show);
  show();
}
