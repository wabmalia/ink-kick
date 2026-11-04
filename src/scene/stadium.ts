import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { adBoards } from './ads';
import { CONFIG } from '../config';

// The static set: striped pitch with its markings, goals with nets, stands
// with an instanced crowd, and four floodlight towers. Only the floodlights
// cast shadows, and only players, ball and goal frames cast them.

const { width: W, height: H, goalWidth, goalDepth } = CONFIG.pitch;
const GOAL_HEIGHT = 2.2;
// Grass beyond the lines, up to the stands.
const APRON = 4;
const PX = 48;

// A small seeded random, so the pitch is painted the same way every time.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 1D noise in -1..1, for wobbling a stroke along its length.
function wobbler(rand: () => number) {
  const knots = Array.from({ length: 64 }, () => rand() * 2 - 1);
  return (t: number) => {
    const i = Math.floor(t);
    const f = t - i;
    const a = knots[((i % 64) + 64) % 64]!;
    const b = knots[(((i + 1) % 64) + 64) % 64]!;
    return a + (b - a) * f * f * (3 - 2 * f);
  };
}

type Pt = [number, number];

// Points every 0.2 m along a straight line, run on a little past each end
// the way a quick sketch overshoots.
function segment(x0: number, y0: number, x1: number, y1: number, over = 0.12): Pt[] {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const n = Math.max(2, Math.ceil((len + over * 2) / 0.2));
  return Array.from({ length: n + 1 }, (_, i) => {
    const d = -over + ((len + over * 2) * i) / n;
    return [x0 + ux * d, y0 + uy * d];
  });
}

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / 0.2));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

// The pitch as a watercolour: stripes with ragged edges, wet-on-wet washes,
// blooms and splatter, then the markings in chalk over a faint, slightly
// misregistered ink line. Painted once, so nothing here flickers.
function pitchTexture() {
  const gw = W + APRON * 2;
  const gh = H + APRON * 2;
  const canvas = document.createElement('canvas');
  canvas.width = gw * PX;
  canvas.height = gh * PX;
  const ctx = canvas.getContext('2d')!;
  const rand = seeded(11);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  // Metres from the pitch centre to canvas pixels.
  const mx = (v: number) => (v + gw / 2) * PX;
  const my = (v: number) => (v + gh / 2) * PX;

  ctx.fillStyle = '#2c7437';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Mown stripes, each edge laid down by hand.
  const stripe = 4;
  for (let x = 0; x < gw; x += stripe) {
    const left = wobbler(rand);
    const right = wobbler(rand);
    ctx.beginPath();
    for (let y = 0; y <= gh; y += 0.5) ctx.lineTo((x + left(y * 0.6) * 0.18) * PX, y * PX);
    for (let y = gh; y >= 0; y -= 0.5) ctx.lineTo((x + stripe + right(y * 0.6) * 0.18) * PX, y * PX);
    ctx.closePath();
    ctx.fillStyle = Math.round(x / stripe) % 2 ? 'rgba(66, 150, 70, 0.75)' : 'rgba(30, 98, 48, 0.55)';
    ctx.fill();
  }

  // Wet-on-wet: soft washes of neighbouring greens bleeding into each other.
  const washes = ['#3f9142', '#226230', '#56a447', '#2b7e4d', '#78b04f', '#1f5a3a'];
  for (let i = 0; i < 160; i++) {
    const x = rand() * gw;
    const y = rand() * gh;
    const r = (0.8 + rand() * 3) * PX;
    const g = ctx.createRadialGradient(x * PX, y * PX, 0, x * PX, y * PX, r);
    g.addColorStop(0, pick(washes) + Math.floor(20 + rand() * 30).toString(16));
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x * PX - r, y * PX - r, r * 2, r * 2);
  }

  // Blooms: where water ran back into a drying wash and pushed the pigment
  // out into a darker, ragged rim.
  for (let i = 0; i < 28; i++) {
    const cx = rand() * gw;
    const cy = rand() * gh;
    const r = 0.5 + rand() * 1.6;
    const edge = wobbler(rand);
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.15) {
      const rr = (r + edge(a * 2) * r * 0.25) * PX;
      ctx.lineTo(cx * PX + Math.cos(a) * rr, cy * PX + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(120, 190, 100, 0.13)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(16, 60, 32, 0.22)';
    ctx.lineWidth = 0.05 * PX;
    ctx.stroke();
  }

  // Splatter flicked off the brush.
  for (let i = 0; i < 70; i++) {
    const cx = rand() * gw;
    const cy = rand() * gh;
    const colour = pick(['rgba(18, 62, 34, 0.45)', 'rgba(150, 200, 90, 0.4)', 'rgba(30, 90, 50, 0.35)']);
    const dots = 4 + Math.floor(rand() * 10);
    for (let d = 0; d < dots; d++) {
      const a = rand() * Math.PI * 2;
      const dist = rand() * rand() * 0.9;
      ctx.beginPath();
      ctx.arc((cx + Math.cos(a) * dist) * PX, (cy + Math.sin(a) * dist) * PX, (0.015 + rand() * 0.06) * PX, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
    }
  }

  // One brush pass along a path: wobbling sideways, swelling and thinning,
  // and with gaps where the brush ran dry if dry is set.
  const pass = (pts: Pt[], width: number, colour: string, jitter: number, opts: { shift?: Pt; dry?: boolean } = {}) => {
    const side = wobbler(rand);
    const swell = wobbler(rand);
    const gaps = wobbler(rand);
    const [sx, sy] = opts.shift ?? [0, 0];
    const at = (i: number): Pt => {
      const [x, y] = pts[i]!;
      const [x2, y2] = pts[Math.min(pts.length - 1, i + 1)]!;
      const [x1, y1] = pts[Math.max(0, i - 1)]!;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const off = side(i * 0.25) * jitter;
      return [x - ((y2 - y1) / len) * off + sx, y + ((x2 - x1) / len) * off + sy];
    };
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    for (let i = 0; i < pts.length - 1; i++) {
      if (opts.dry && gaps(i * 0.4) < -0.1) continue;
      const [ax, ay] = at(i);
      const [bx, by] = at(i + 1);
      ctx.lineWidth = width * (1 + swell(i * 0.3) * 0.3) * PX;
      ctx.beginPath();
      ctx.moveTo(mx(ax), my(ay));
      ctx.lineTo(mx(bx), my(by));
      ctx.stroke();
    }
  };
  const mark = (pts: Pt[]) => {
    pass(pts, 0.17, 'rgba(20, 24, 51, 0.3)', 0.04, { shift: [0.025, 0.02] });
    pass(pts, 0.12, 'rgba(244, 242, 234, 0.88)', 0.025);
    pass(pts, 0.05, 'rgba(255, 255, 255, 0.45)', 0.04, { dry: true });
  };
  const spot = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(mx(x + 0.02), my(y + 0.02), 0.17 * PX, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 24, 51, 0.3)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx(x), my(y), 0.14 * PX, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244, 242, 234, 0.9)';
    ctx.fill();
  };
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    mark(segment(x0, y0, x1, y0));
    mark(segment(x1, y0, x1, y1));
    mark(segment(x1, y1, x0, y1));
    mark(segment(x0, y1, x0, y0));
  };

  rect(-W / 2, -H / 2, W / 2, H / 2);
  mark(segment(0, -H / 2, 0, H / 2));
  // Circles start and finish a touch apart, overlapping, as drawn freehand.
  mark(arcPoints(0, 0, CONFIG.pitch.centreCircle, -0.2, Math.PI * 2 + 0.05));
  spot(0, 0);
  for (const side of [-1, 1]) {
    const line = (side * W) / 2;
    rect(Math.min(line, line - side * 5), -5, Math.max(line, line - side * 5), 5);
    rect(Math.min(line, line - side * 1.8), -3.6, Math.max(line, line - side * 1.8), 3.6);
    spot(line - side * 3.6, 0);
    // The D, outside the box only.
    const a = Math.acos(1.4 / 2.8);
    if (side < 0) mark(arcPoints(line + 3.6, 0, 2.8, -a, a));
    else mark(arcPoints(line - 3.6, 0, 2.8, Math.PI - a, Math.PI + a));
    for (const corner of [-1, 1]) {
      const cy = (corner * H) / 2;
      const start = Math.atan2(-corner, -side);
      mark(arcPoints(line, cy, 0.7, start - Math.PI / 4, start + Math.PI / 4));
    }
  }

  raggedEdge(ctx, gw, gh, rand);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, gw, gh };
}

// No ruled border round the grass: the wash stops at a wandering, rounded
// edge out in the run-off, where it dried with a darker rim, and spilled
// past it here and there. Outside the edge the canvas is clear.
function raggedEdge(ctx: CanvasRenderingContext2D, gw: number, gh: number, rand: () => number) {
  const inset = 1;
  const corner = 2.2;
  const big = wobbler(rand);
  const fine = wobbler(rand);
  // Round the inset rectangle, metre by metre, each point pushed in by its
  // own amount.
  const x0 = inset + corner;
  const y0 = inset + corner;
  const x1 = gw - inset - corner;
  const y1 = gh - inset - corner;
  const outline: Pt[] = [];
  const along = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= 12; i++) {
      const a = a0 + ((a1 - a0) * i) / 12;
      outline.push([cx + Math.cos(a) * corner, cy + Math.sin(a) * corner]);
    }
  };
  const straight = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.3);
    for (let i = 1; i < n; i++) outline.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  };
  along(x1, y0, -Math.PI / 2, 0);
  straight(x1 + corner, y0, x1 + corner, y1);
  along(x1, y1, 0, Math.PI / 2);
  straight(x1, y1 + corner, x0, y1 + corner);
  along(x0, y1, Math.PI / 2, Math.PI);
  straight(x0 - corner, y1, x0 - corner, y0);
  along(x0, y0, Math.PI, Math.PI * 1.5);
  straight(x0, y0 - corner, x1, y0 - corner);
  const cx = gw / 2;
  const cy = gh / 2;
  const edge = outline.map(([x, y], i): Pt => {
    const dx = cx - x;
    const dy = cy - y;
    const len = Math.hypot(dx, dy);
    const push = big(i * 0.05) * 0.55 + fine(i * 0.4) * 0.12;
    return [x + (dx / len) * push, y + (dy / len) * push];
  });
  const path = () => {
    ctx.beginPath();
    for (const [x, y] of edge) ctx.lineTo(x * PX, y * PX);
    ctx.closePath();
  };

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  path();
  ctx.fillStyle = '#000';
  ctx.fill();
  // The rim, only where there's paint.
  ctx.globalCompositeOperation = 'source-atop';
  path();
  ctx.strokeStyle = 'rgba(14, 52, 28, 0.4)';
  ctx.lineWidth = 0.28 * PX;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // Spills just past the edge.
  for (let i = 0; i < 26; i++) {
    const [x, y] = edge[Math.floor(rand() * edge.length)]!;
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy);
    const out = 0.15 + rand() * 0.45;
    const r = 0.08 + rand() * 0.3;
    ctx.beginPath();
    ctx.arc((x + (dx / len) * out) * PX, (y + (dy / len) * out) * PX, r * PX, 0, Math.PI * 2);
    ctx.fillStyle = rand() < 0.5 ? 'rgba(38, 110, 52, 0.7)' : 'rgba(26, 86, 44, 0.6)';
    ctx.fill();
  }
}

function netTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(238, 240, 250, 0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps: averaged down, the thin lines fade below the alphaTest and
  // whole nets vanish (Chromium picks those levels sooner than Firefox).
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function scaleUvs(geo: THREE.BufferGeometry, u: number, v: number) {
  const uv = geo.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
}

let netMaterial: THREE.MeshStandardMaterial | null = null;
const NET_MATERIAL = () =>
  (netMaterial ??= new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 1 }));
let frameMaterial: THREE.MeshStandardMaterial | null = null;
const FRAME_MATERIAL = () => (frameMaterial ??= new THREE.MeshStandardMaterial({ color: 0xf4f5fb, roughness: 0.35 }));

// Merges every mesh in a group that never moves into one mesh per material
// (and shadow setting), so the stadium costs a handful of draws, not dozens.
function bake(group: THREE.Group, scene: THREE.Scene) {
  group.updateMatrixWorld(true);
  const sets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const material = o.material as THREE.Material;
    const key = `${material.uuid}:${o.castShadow}:${o.receiveShadow}`;
    let set = sets.get(key);
    if (!set) sets.set(key, (set = { material, cast: o.castShadow, receive: o.receiveShadow, geos: [] }));
    const geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    set.geos.push(geo);
  });
  for (const { material, cast, receive, geos } of sets.values()) {
    const merged = new THREE.Mesh(mergeGeometries(geos)!, material);
    merged.castShadow = cast;
    merged.receiveShadow = receive;
    scene.add(merged);
    for (const g of geos) g.dispose();
  }
}

function goal(side: number) {
  const group = new THREE.Group();
  const white = FRAME_MATERIAL();
  const r = CONFIG.post.radius * 0.7;
  const line = (side * W) / 2;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL_HEIGHT, 12), white);
    post.position.set(line, GOAL_HEIGHT / 2, (s * goalWidth) / 2);
    post.castShadow = true;
    group.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, goalWidth + r * 2, 12), white);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(line, GOAL_HEIGHT, 0);
  bar.castShadow = true;
  group.add(bar);

  // Net: back, two sides and a roof, sloping down to the back.
  const backX = line + side * goalDepth;
  const backH = GOAL_HEIGHT * 0.7;
  // The tiling goes in the UVs, so every piece of net shares one material
  // and they bake into a single mesh.
  const net = (w: number, h: number, repeatW: number, repeatH: number) => {
    const geo = new THREE.PlaneGeometry(w, h);
    scaleUvs(geo, repeatW, repeatH);
    return new THREE.Mesh(geo, NET_MATERIAL());
  };
  const back = net(goalWidth, backH, goalWidth * 4, backH * 4);
  back.position.set(backX, backH / 2, 0);
  back.rotation.y = Math.PI / 2;
  group.add(back);
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(goalDepth, 0);
    shape.lineTo(goalDepth, backH);
    shape.lineTo(0, GOAL_HEIGHT);
    const geo = new THREE.ShapeGeometry(shape);
    // ShapeGeometry UVs are in shape units; scale them into net squares.
    scaleUvs(geo, 4, 4);
    const sideNet = new THREE.Mesh(geo, NET_MATERIAL());
    sideNet.position.set(line, 0, (s * goalWidth) / 2);
    sideNet.scale.x = side;
    group.add(sideNet);
  }
  const slope = Math.hypot(goalDepth, GOAL_HEIGHT - backH);
  const roof = net(slope, goalWidth, slope * 4, goalWidth * 4);
  roof.position.set(line + (side * goalDepth) / 2, (GOAL_HEIGHT + backH) / 2, 0);
  roof.rotation.set(-Math.PI / 2, 0, 0);
  roof.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), side * -Math.atan2(GOAL_HEIGHT - backH, goalDepth));
  group.add(roof);
  return group;
}

// Stepped terraces along one side, with a crowd on each step.
interface Terrace {
  // Centre of the front edge, the direction pointing away from the pitch,
  // and the length along the pitch.
  x: number;
  z: number;
  out: THREE.Vector2;
  length: number;
}

const ROWS = 9;
const STEP_DEPTH = 1.1;
const STEP_RISE = 0.55;
const CROWD_COLORS = [0xf2b134, 0xf2b134, 0xe2553f, 0xe2553f, 0xeef0fa, 0x353b66, 0x9aa0bf, 0x1d2140];

function stands(scene: THREE.Scene, fixed: THREE.Group) {
  const front = 2;
  const terraces: Terrace[] = [
    { x: 0, z: -(H / 2 + APRON + front), out: new THREE.Vector2(0, -1), length: W + APRON * 2 + 6 },
    { x: 0, z: H / 2 + APRON + front, out: new THREE.Vector2(0, 1), length: W + APRON * 2 + 6 },
    { x: -(W / 2 + APRON + front), z: 0, out: new THREE.Vector2(-1, 0), length: H + APRON * 2 },
    { x: W / 2 + APRON + front, z: 0, out: new THREE.Vector2(1, 0), length: H + APRON * 2 },
  ];
  const concrete = new THREE.MeshStandardMaterial({ color: 0x353b66, roughness: 0.9 });
  const spacing = 0.62;
  let total = 0;
  for (const t of terraces) total += ROWS * Math.floor(t.length / spacing);
  // The crowd: low-poly stickmen, drawn as three batches (bodies, heads and
  // arms) however many there are. They catch no shadows and cast none.
  const crowdMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const body = new THREE.CapsuleGeometry(0.085, 0.3, 2, 6);
  body.translate(0, 0.3, 0);
  const head = new THREE.SphereGeometry(0.13, 7, 5);
  head.translate(0, 0.66, 0);
  const arm = new THREE.CapsuleGeometry(0.035, 0.26, 1, 4);
  // Hanging from the shoulder.
  arm.translate(0, -0.15, 0);
  const bodies = new THREE.InstancedMesh(body, crowdMaterial, total);
  const heads = new THREE.InstancedMesh(head, crowdMaterial, total);
  const arms = new THREE.InstancedMesh(arm, crowdMaterial, total * 2);
  const armLocal = new THREE.Matrix4();
  const armRot = new THREE.Matrix4();
  const paper = new THREE.Color(0xf4efe4);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  let n = 0;
  for (const t of terraces) {
    const along = new THREE.Vector2(-t.out.y, t.out.x);
    const yaw = Math.atan2(-t.out.x, -t.out.y);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (let row = 0; row < ROWS; row++) {
      const top = (row + 1) * STEP_RISE;
      const d = row * STEP_DEPTH + STEP_DEPTH / 2;
      const step = new THREE.Mesh(new THREE.BoxGeometry(t.length, top, STEP_DEPTH), concrete);
      step.position.set(t.x + t.out.x * d, top / 2, t.z + t.out.y * d);
      step.rotation.y = yaw;
      step.receiveShadow = true;
      fixed.add(step);
      const seats = Math.floor(t.length / spacing);
      for (let i = 0; i < seats; i++) {
        const a = (i - (seats - 1) / 2) * spacing + (Math.random() - 0.5) * 0.12;
        const pos = new THREE.Vector3(t.x + t.out.x * d + along.x * a, top, t.z + t.out.y * d + along.y * a);
        // Empty seats here and there.
        const s = Math.random() < 0.12 ? 0 : 0.85 + Math.random() * 0.3;
        m.compose(pos, q, new THREE.Vector3(s, s, s));
        color.setHex(CROWD_COLORS[Math.floor(Math.random() * CROWD_COLORS.length)]!);
        bodies.setMatrixAt(n, m);
        bodies.setColorAt(n, color);
        heads.setMatrixAt(n, m);
        heads.setColorAt(n, paper);
        // Arms down, up in a V cheering, or just the one waving.
        const pose = Math.random();
        for (const side of [-1, 1]) {
          const up = pose < 0.3 || (pose < 0.45 && side > 0);
          const angle = side * (up ? Math.PI - 0.45 - Math.random() * 0.3 : 0.12 + Math.random() * 0.15);
          armLocal.makeTranslation(side * 0.08, 0.46, 0).multiply(armRot.makeRotationZ(angle));
          arms.setMatrixAt(n * 2 + (side > 0 ? 1 : 0), armLocal.premultiply(m));
          arms.setColorAt(n * 2 + (side > 0 ? 1 : 0), color);
        }
        n++;
      }
    }
  }
  scene.add(bodies, heads, arms);
}

function floodlights(scene: THREE.Scene, fixed: THREE.Group) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a5080, roughness: 0.6, metalness: 0.4 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff3d0, emissiveIntensity: 3 });
  const height = 22;
  const lights: THREE.SpotLight[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W / 2 + APRON + 8);
      const z = sz * (H / 2 + APRON + 8);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, height, 10), steel);
      pole.position.set(x, height / 2, z);
      fixed.add(pole);
      const head = new THREE.Group();
      head.position.set(x, height + 1, z);
      head.lookAt(0, 0, 0);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 0.4), steel);
      head.add(frame);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1, 0.1), lamp);
          bulb.position.set((i - 1) * 1.25, (j - 0.5) * 1.15, 0.22);
          head.add(bulb);
        }
      }
      fixed.add(head);

      const spot = new THREE.SpotLight(0xfff1d6, 2.2, 0, 0.62, 0.65, 0);
      spot.position.copy(head.position);
      spot.target.position.set(-sx * 3, 0, -sz * 2);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.camera.near = 20;
      spot.shadow.camera.far = 70;
      spot.shadow.bias = -0.0004;
      spot.shadow.normalBias = 0.02;
      spot.shadow.radius = 3;
      scene.add(spot, spot.target);
      lights.push(spot);
    }
  }
  return lights;
}

export function buildStadium(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x12152a);
  scene.fog = new THREE.Fog(0x12152a, 70, 140);
  scene.add(new THREE.HemisphereLight(0x3a4270, 0x0d0f1e, 0.9));

  const { tex, gw, gh } = pitchTexture();
  // Transparent where the painted edge leaves the canvas clear.
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent: true }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x1d2140, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // Everything that never moves is built here, then baked.
  const fixed = new THREE.Group();
  fixed.add(goal(-1), goal(1));
  stands(scene, fixed);
  adBoards(fixed);
  const lights = floodlights(scene, fixed);
  bake(fixed, scene);
  return { lights };
}
