import { DEFAULT_QUALITY, type GameView, type Quality } from '../game/view';
import { summarize } from './frame-stats';

// Diagnostics, at ?perf (never linked, like the lab): frame times as drawn,
// and a test that runs through rendering settings one at a time and shows a
// table to screenshot. For finding what costs frames on a phone; see
// docs/render-performance.md. ?perf&ratio=1&shadows=0&samples=0 starts with
// those settings instead; ?perf=auto goes to the training ground and runs
// the test by itself, for a device nobody can tap (a simulator).

export const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

const STEPS: { name: string; q: Partial<Quality> }[] = [
  { name: 'As shipped', q: {} },
  { name: 'Density 1.5', q: { ratio: 1.5 } },
  { name: 'Density 1', q: { ratio: 1 } },
  { name: 'No shadows', q: { shadows: false } },
  { name: 'No MSAA', q: { samples: 0 } },
  { name: 'All three off', q: { ratio: 1, shadows: false, samples: 0 } },
];
const WARMUP_MS = 2000;
const MEASURE_MS = 6000;

const fmt = (s: ReturnType<typeof summarize>) =>
  `${s.fps.toFixed(0)} fps · avg ${s.avg.toFixed(1)} · p95 ${s.p95.toFixed(1)} · worst ${s.worst.toFixed(0)} ms · drops ${s.drops}`;

export function mountPerf(view: GameView) {
  const params = new URLSearchParams(location.search);
  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
  const base: Quality = {
    ratio: num('ratio') ?? DEFAULT_QUALITY.ratio,
    shadows: params.get('shadows') !== '0',
    samples: num('samples') ?? DEFAULT_QUALITY.samples,
  };
  view.setQuality(base);

  const panel = document.createElement('div');
  panel.className = 'perf';
  const live = document.createElement('p');
  const setting = document.createElement('p');
  setting.className = 'perf-setting';
  const run = document.createElement('button');
  run.type = 'button';
  run.textContent = 'Run test';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy results';
  copy.hidden = true;
  const table = document.createElement('table');
  panel.append(live, setting, run, copy, table);
  // The last test as plain text, to paste somewhere from a phone.
  let report = '';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // No clipboard access (an old browser, or not https): select the
      // text instead, so a long press can copy it.
      const area = document.createElement('textarea');
      area.value = report;
      area.className = 'perf-text';
      panel.append(area);
      area.select();
      return;
    }
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy results'), 1500);
  });
  document.body.append(panel);

  const describe = (q: Quality) => `density ${q.ratio} · shadows ${q.shadows ? 'on' : 'off'} · MSAA ${q.samples}x · ${innerWidth}x${innerHeight} @${devicePixelRatio}`;
  setting.textContent = describe(base);

  // The last few seconds, for the live line; and a test's own window.
  let recent: number[] = [];
  let measuring: number[] | null = null;
  let lastAt = 0;
  setInterval(() => {
    live.textContent = fmt(summarize(recent));
    recent = [];
  }, 2000);

  if (params.get('perf') === 'auto') {
    setTimeout(() => {
      document.getElementById('train')?.click();
      setTimeout(() => run.click(), 3000);
    }, 1500);
  }

  run.addEventListener('click', async () => {
    run.disabled = true;
    copy.hidden = true;
    table.replaceChildren();
    const lines = [`Ink Kick ?perf, ${new Date().toISOString().slice(0, 16)}`, `Screen ${innerWidth}x${innerHeight} CSS px at DPR ${devicePixelRatio}`, navigator.userAgent, ''];
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (const step of STEPS) {
      const q = { ...base, ...step.q };
      view.setQuality(q);
      setting.textContent = `Testing: ${step.name} (${describe(q)})`;
      await wait(WARMUP_MS);
      measuring = [];
      await wait(MEASURE_MS);
      const s = summarize(measuring);
      measuring = null;
      const row = table.insertRow();
      for (const cell of [step.name, s.fps.toFixed(0), s.p95.toFixed(1), s.worst.toFixed(0), String(s.drops)]) row.insertCell().textContent = cell;
      lines.push(`${step.name}: ${fmt(s)} (${describe(q)})`);
    }
    const head = table.createTHead().insertRow();
    for (const h of ['Setting', 'fps', 'p95 ms', 'worst', 'drops']) head.insertCell().textContent = h;
    view.setQuality(base);
    setting.textContent = describe(base);
    report = lines.join('\n');
    copy.hidden = false;
    run.disabled = false;
  });

  /** Called after each frame is drawn. */
  return (now: number) => {
    if (lastAt) {
      const ms = now - lastAt;
      recent.push(ms);
      measuring?.push(ms);
    }
    lastAt = now;
  };
}
