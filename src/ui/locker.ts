import {
  ATTRIBUTES, canLower, canRaise, LABELS, loadAttributes, lower, MAX, raise, saveAttributes, spare,
  type Attribute, type Attributes,
} from '../game/attributes';

// The Locker room's attributes: a hexagon with one corner per attribute, and
// at each corner its name and − / + buttons. Lowering one frees a point to
// spend on another; a button fades out whenever its move isn't allowed.

const SVG = 'http://www.w3.org/2000/svg';
// The chart's size in CSS pixels, and the hexagon's radius at a 10.
const W = 300;
const H = 214;
const R = 63;
const angle = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / ATTRIBUTES.length;
const point = (i: number, v: number): [number, number] => [W / 2 + Math.cos(angle(i)) * (R * v) / MAX, H / 2 + Math.sin(angle(i)) * (R * v) / MAX];

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

let attrs = loadAttributes();

// The info button's dialog: what each attribute does. Esc, Got it or a click
// outside closes it.
function infoDialog() {
  const dialog = document.getElementById('attr-info') as HTMLDialogElement;
  document.getElementById('attr-info-open')!.addEventListener('click', () => {
    dialog.showModal();
    // The dialog itself, so Got it doesn't open wearing the focus ring.
    dialog.focus();
  });
  document.getElementById('attr-info-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
}

/** The attributes as set in the Locker room. */
export const myAttributes = (): Attributes => ({ ...attrs });

export function mountLocker(host: HTMLElement, left: HTMLElement) {
  infoDialog();
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'radar', 'aria-hidden': 'true' });
  for (const v of [5, 10]) {
    svg.append(svgEl('polygon', { class: `ring ring-${v}`, points: ATTRIBUTES.map((_, i) => point(i, v).join(',')).join(' ') }));
  }
  ATTRIBUTES.forEach((_, i) => {
    const [x, y] = point(i, MAX);
    svg.append(svgEl('line', { class: 'spoke', x1: W / 2, y1: H / 2, x2: x, y2: y }));
  });
  const shape = svgEl('polygon', { class: 'shape' });
  svg.append(shape);
  const dots = ATTRIBUTES.map(() => svg.appendChild(svgEl('circle', { class: 'dot', r: 4.5 })));
  host.append(svg);

  // Each corner's controls, just outside the 10 ring: further out to the
  // sides than up and down, since they're wider than they are tall.
  const corners = ATTRIBUTES.map((a, i) => {
    const [x, y] = point(i, MAX);
    const box = document.createElement('div');
    box.className = 'corner';
    box.style.left = `${x + Math.cos(angle(i)) * 46}px`;
    box.style.top = `${y + Math.sin(angle(i)) * 24}px`;
    const name = document.createElement('span');
    name.className = 'corner-name';
    name.textContent = LABELS[a];
    const row = document.createElement('span');
    row.className = 'corner-row';
    const button = (text: string, label: string, act: (x: Attributes, k: Attribute) => Attributes) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'step';
      b.textContent = text;
      b.setAttribute('aria-label', `${label} ${LABELS[a]}`);
      b.addEventListener('click', () => {
        attrs = act(attrs, a);
        saveAttributes(attrs);
        draw();
      });
      return b;
    };
    const minus = button('−', 'Lower', lower);
    const value = document.createElement('output');
    value.className = 'corner-value';
    const plus = button('+', 'Raise', raise);
    row.append(minus, value, plus);
    box.append(name, row);
    host.append(box);
    return { a, minus, value, plus };
  });

  const draw = () => {
    shape.setAttribute('points', ATTRIBUTES.map((a, i) => point(i, attrs[a]).join(',')).join(' '));
    ATTRIBUTES.forEach((a, i) => {
      const [x, y] = point(i, attrs[a]);
      dots[i]!.setAttribute('cx', String(x));
      dots[i]!.setAttribute('cy', String(y));
    });
    for (const { a, minus, value, plus } of corners) {
      value.textContent = String(attrs[a]);
      // aria-disabled rather than disabled, so a button keeps focus when it
      // runs out (the click is ignored anyway).
      minus.setAttribute('aria-disabled', String(!canLower(attrs, a)));
      plus.setAttribute('aria-disabled', String(!canRaise(attrs, a)));
    }
    const n = spare(attrs);
    left.textContent = `${n} point${n === 1 ? '' : 's'} available`;
    left.classList.toggle('to-spend', n > 0);
  };
  draw();
}
