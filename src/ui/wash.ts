import { BRIGHT } from '../scene/splashes';

// Watercolour washes behind the menu's cards and buttons, and the splash
// behind the title, painted onto a canvas at each element's size the way the
// pitch is: a wandering edge with a darker dried rim, blooms, a spill or two.
// Each element keeps its own seed, so it looks the same when repainted at a
// new size; repaints happen only when a size changes.

interface Wash {
  base: string;
  // Paler lifts and deeper pools inside the wash.
  lights: string[];
  darks: string[];
  rim: string;
}

const WASHES: Record<string, Wash> = {
  card: { base: '#1f2552', lights: ['#2a3270', '#26306a'], darks: ['#161b40', '#141936'], rim: 'rgba(84, 104, 200, 0.55)' },
  ink: { base: '#1c2148', lights: ['#262d62'], darks: ['#141936'], rim: 'rgba(120, 136, 210, 0.6)' },
  gold: { base: '#ffc23a', lights: ['#ffeab0', '#ffd774'], darks: ['#f5a312'], rim: 'rgba(225, 140, 0, 0.85)' },
  red: { base: '#ff7660', lights: ['#ffc2b3', '#ff9c8a'], darks: ['#f0553c'], rim: 'rgba(222, 70, 46, 0.85)' },
  blue: { base: '#66a6ff', lights: ['#c7e2ff', '#94c1ff'], darks: ['#4a8af5'], rim: 'rgba(52, 116, 230, 0.85)' },
  green: { base: '#52d27c', lights: ['#d2f7d4', '#8ee5a8'], darks: ['#36b863'], rim: 'rgba(36, 160, 80, 0.85)' },
};

// Room round the element for the edge to wander out into, in CSS pixels.
const PAD = 10;
// And for the splatter a button throws when it's highlighted.
const SPLAT_PAD = 30;
// The splatter's paints, per button: its own colours, then the odd other.
const SPLATS: Record<string, string[]> = {
  ink: ['#9aa6e8', '#c9cde4', '#7f8fe0'],
  gold: ['#ffc23a', '#f5a312', '#ffe3a0'],
  red: ['#ff7660', '#f0553c', '#ffc2b3'],
  blue: ['#66a6ff', '#4a8af5', '#c7e2ff'],
  green: ['#52d27c', '#36b863', '#d2f7d4'],
};
const TITLE_PAD = 70;

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h;
}

// Smooth noise round a loop, -1..1, for edges that wander and close up.
function loopNoise(rand: () => number, knots = 24) {
  const k = Array.from({ length: knots }, () => rand() * 2 - 1);
  return (t: number) => {
    const x = (((t % 1) + 1) % 1) * knots;
    const i = Math.floor(x);
    const f = x - i;
    const a = k[i % knots]!;
    const b = k[(i + 1) % knots]!;
    return a + (b - a) * f * f * (3 - 2 * f);
  };
}

// A rounded rectangle's outline with every point pushed in or out a little.
function raggedRect(rand: () => number, x: number, y: number, w: number, h: number, radius: number, wobble: number) {
  const big = loopNoise(rand, 14);
  const fine = loopNoise(rand, 40);
  const r = Math.min(radius, w / 2, h / 2);
  const pts: [number, number, number, number][] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
  };
  const side = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
    for (let i = 1; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, nx, ny]);
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  side(x + w, y + r, x + w, y + h - r, 1, 0);
  corner(x + w - r, y + h - r, 0);
  side(x + w - r, y + h, x + r, y + h, 0, 1);
  corner(x + r, y + h - r, Math.PI / 2);
  side(x, y + h - r, x, y + r, -1, 0);
  corner(x + r, y + r, Math.PI);
  side(x + r, y, x + w - r, y, 0, -1);
  return pts.map(([px, py, nx, ny], i): [number, number] => {
    const t = i / pts.length;
    const push = (big(t) * 0.75 + fine(t) * 0.25) * wobble;
    return [px + nx * push, py + ny * push];
  });
}

function trace(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.closePath();
}

// pad: room left round the element; inner: how far inside it the edge sits,
// for an element that clips what's drawn outside it.
function paintWash(ctx: CanvasRenderingContext2D, w: number, h: number, wash: Wash, rand: () => number, pad: number, inner: number) {
  const edge = raggedRect(rand, pad + inner, pad + inner, w - inner * 2, h - inner * 2, Math.min(18, h / 2.5), Math.min(8, h / 7));
  ctx.save();
  trace(ctx, edge);
  ctx.fillStyle = wash.base;
  ctx.fill();
  ctx.clip();
  // Lifts and pools bleeding into each other.
  const blobs = Math.round(4 + (w * h) / 9000);
  for (let i = 0; i < blobs; i++) {
    const x = pad + rand() * w;
    const y = pad + rand() * h;
    const r = (0.25 + rand() * 0.5) * Math.max(w, h) * 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const colour = rand() < 0.55 ? wash.lights[Math.floor(rand() * wash.lights.length)]! : wash.darks[Math.floor(rand() * wash.darks.length)]!;
    g.addColorStop(0, colour);
    g.addColorStop(1, colour + '00');
    ctx.globalAlpha = 0.35 + rand() * 0.35;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  // The rim where the wash dried, darker and uneven.
  ctx.save();
  trace(ctx, edge);
  ctx.clip();
  trace(ctx, edge);
  ctx.strokeStyle = wash.rim;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
  // A spill or two over the edge.
  for (let i = 0; i < 2; i++) {
    const [x, y] = edge[Math.floor(rand() * edge.length)]!;
    ctx.beginPath();
    ctx.arc(x + (rand() - 0.5) * 6, y + (rand() - 0.5) * 6, 1.5 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = wash.base;
    ctx.fill();
  }
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

// The title: every bright paint at once, as on a goal.
function paintSplash(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number) {
  const cx = TITLE_PAD + w / 2;
  const cy = TITLE_PAD + h * 0.55;
  const paints = BRIGHT.map(hex);
  const blot = (x: number, y: number, r: number, colour: string, alpha: number) => {
    const edge = loopNoise(rand, 16);
    const pts: [number, number][] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const rr = r * (1 + edge(i / 48) * 0.28);
      pts.push([x + Math.cos(a) * rr * 1.25, y + Math.sin(a) * rr * 0.8]);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    trace(ctx, pts);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.globalAlpha = Math.min(1, alpha + 0.2);
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.strokeStyle = colour;
    ctx.filter = 'brightness(0.75)';
    ctx.stroke();
    ctx.restore();
  };
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 0.45;
    blot(cx + Math.cos(a) * d * w * 0.55, cy + Math.sin(a) * d * h * 0.6, (0.18 + rand() * 0.2) * h, paints[i % paints.length]!, 0.55 + rand() * 0.2);
  }
  // Droplets and streaks flung outwards: up and to the sides, clear of the
  // tagline underneath.
  for (let i = 0; i < 70; i++) {
    const a = Math.PI + (rand() - 0.5) * 1.15 * Math.PI + (rand() < 0.5 ? 0 : Math.PI * 0.08);
    const d = 0.45 + rand() * 0.6;
    const x = cx + Math.cos(a) * d * (w / 2 + TITLE_PAD * 0.6);
    const y = cy + Math.min(0.15, Math.sin(a)) * d * (h / 2 + TITLE_PAD * 0.5);
    const r = 1.5 + rand() * rand() * 9;
    const stretch = rand() < 0.35 ? 2 + rand() * 2.5 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.globalAlpha = 0.6 + rand() * 0.35;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * stretch, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = paints[Math.floor(rand() * paints.length)]!;
    ctx.fill();
    ctx.restore();
  }
}

// The favicon: the title's splash in a square, with S! on it. Run once to
// make the files in public/ (see the README), not at load.
export async function iconDataUrl(size: number) {
  await document.fonts.load(`${size}px 'Caveat Brush'`);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Small icons zoom in past the flung droplets so the mark fills the tab.
  const zoom = size <= 64 ? 1.4 : 1.05;
  const zoomed = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(size / 2, size / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-size / 2, -size / 2);
  };
  zoomed();
  // paintSplash works in CSS pixels round a box with TITLE_PAD either side.
  const box = size * 0.62;
  const scale = size / (box + TITLE_PAD * 2);
  ctx.scale(scale, scale);
  paintSplash(ctx, box, box * 0.8, seeded(hash('icon')));
  zoomed();
  ctx.font = `${size * 0.62}px 'Caveat Brush'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(size * 0.5, size * 0.55);
  ctx.rotate(-0.07);
  const draw = (text: string, x: number, colour: string) => {
    ctx.fillStyle = '#0d1026';
    ctx.fillText(text, x + size * 0.035, size * 0.04);
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = '#0d1026';
    ctx.strokeText(text, x, 0);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, 0);
  };
  draw('S', -size * 0.07, '#ffc53d');
  draw('!', size * 0.22, '#ff5e45');
  return canvas.toDataURL('image/png');
}

// Droplets and streaks flicked off a button's edge, flying outwards.
function paintSplat(ctx: CanvasRenderingContext2D, w: number, h: number, colours: string[], rand: () => number) {
  const edge = raggedRect(rand, SPLAT_PAD, SPLAT_PAD, w, h, Math.min(18, h / 2.5), 2);
  const cx = SPLAT_PAD + w / 2;
  const cy = SPLAT_PAD + h / 2;
  const others = BRIGHT.map(hex);
  const count = Math.round(14 + (w + h) / 12);
  for (let i = 0; i < count; i++) {
    const [ex, ey] = edge[Math.floor(rand() * edge.length)]!;
    // Out from the middle, through the edge point.
    const a = Math.atan2((ey - cy) / h, (ex - cx) / w) + (rand() - 0.5) * 0.6;
    const out = 3 + rand() * rand() * (SPLAT_PAD - 6);
    const x = ex + Math.cos(a) * out;
    const y = ey + Math.sin(a) * out;
    const r = 1 + rand() * rand() * 4.5;
    const stretch = rand() < 0.4 ? 1.8 + rand() * 2.2 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.globalAlpha = 0.65 + rand() * 0.35;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * stretch, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = rand() < 0.15 ? others[Math.floor(rand() * others.length)]! : colours[Math.floor(rand() * colours.length)]!;
    ctx.fill();
    ctx.restore();
  }
}

function paint(el: HTMLElement) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return;
  const title = el.classList.contains('title');
  // A dialog may scroll on a short window, which clips anything painted
  // past its box.
  const clips = el.tagName === 'DIALOG';
  const pad = title ? TITLE_PAD : clips ? 0 : PAD;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + pad * 2) * dpr);
  canvas.height = Math.ceil((h + pad * 2) * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const rand = seeded(hash(el.id || el.className + (el.textContent ?? '')));
  if (title) paintSplash(ctx, w, h, rand);
  else paintWash(ctx, w, h, WASHES[el.dataset.wash ?? 'card'] ?? WASHES.card!, rand, pad, clips ? 9 : 0);
  el.style.setProperty('--wash', `url("${canvas.toDataURL()}")`);
  el.style.setProperty('--wash-pad', `${pad}px`);

  const splat = SPLATS[el.dataset.wash ?? ''];
  if (!splat) return;
  const sc = document.createElement('canvas');
  sc.width = Math.ceil((w + SPLAT_PAD * 2) * dpr);
  sc.height = Math.ceil((h + SPLAT_PAD * 2) * dpr);
  const sctx = sc.getContext('2d')!;
  sctx.scale(dpr, dpr);
  paintSplat(sctx, w, h, splat, rand);
  el.style.setProperty('--splat', `url("${sc.toDataURL()}")`);
  el.style.setProperty('--splat-pad', `${SPLAT_PAD}px`);
}

// Which wash a button gets, from its colour class.
function kindOf(el: HTMLElement) {
  if (el.classList.contains('ink-btn')) return 'ink';
  for (const k of ['gold', 'red', 'blue', 'green']) if (el.classList.contains(k) && el.classList.contains('brush')) return k;
  return 'card';
}

const sizes = new WeakMap<Element, string>();
const observer = new ResizeObserver(entries => {
  for (const e of entries) {
    const el = e.target as HTMLElement;
    const size = `${el.offsetWidth}x${el.offsetHeight}`;
    if (sizes.get(el) === size) continue;
    sizes.set(el, size);
    paint(el);
  }
});

export function paintMenu() {
  for (const el of document.querySelectorAll<HTMLElement>('.card, .brush, .ink-btn, .title')) {
    el.dataset.wash ??= kindOf(el);
    observer.observe(el);
  }
}
