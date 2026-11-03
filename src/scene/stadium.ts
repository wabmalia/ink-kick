import * as THREE from 'three';
import { CONFIG } from '../config';

// The static set: striped pitch with its markings, goals with nets, stands
// with an instanced crowd, and four floodlight towers. Only the floodlights
// cast shadows, and only players, ball and goal frames cast them.

const { width: W, height: H, goalWidth, goalDepth } = CONFIG.pitch;
const GOAL_HEIGHT = 2.2;
// Grass beyond the lines, up to the stands.
const APRON = 4;
const PX = 32;

function pitchTexture() {
  const gw = W + APRON * 2;
  const gh = H + APRON * 2;
  const canvas = document.createElement('canvas');
  canvas.width = gw * PX;
  canvas.height = gh * PX;
  const ctx = canvas.getContext('2d')!;
  const stripe = 4;
  for (let x = 0; x < gw; x += stripe) {
    ctx.fillStyle = Math.round(x / stripe) % 2 ? '#2f7a3a' : '#2a6e34';
    ctx.fillRect(x * PX, 0, stripe * PX, gh * PX);
  }
  // Metres from the pitch centre to canvas pixels.
  const m = (v: number, axis: 'x' | 'y') => (v + (axis === 'x' ? gw : gh) / 2) * PX;
  ctx.strokeStyle = 'rgba(238, 240, 250, 0.9)';
  ctx.fillStyle = 'rgba(238, 240, 250, 0.9)';
  ctx.lineWidth = 0.12 * PX;
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    ctx.strokeRect(m(x0, 'x'), m(y0, 'y'), (x1 - x0) * PX, (y1 - y0) * PX);
  const arc = (x: number, y: number, r: number, a0 = 0, a1 = Math.PI * 2) => {
    ctx.beginPath();
    ctx.arc(m(x, 'x'), m(y, 'y'), r * PX, a0, a1);
    ctx.stroke();
  };
  const spot = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(m(x, 'x'), m(y, 'y'), 0.15 * PX, 0, Math.PI * 2);
    ctx.fill();
  };

  rect(-W / 2, -H / 2, W / 2, H / 2);
  ctx.beginPath();
  ctx.moveTo(m(0, 'x'), m(-H / 2, 'y'));
  ctx.lineTo(m(0, 'x'), m(H / 2, 'y'));
  ctx.stroke();
  arc(0, 0, 2.8);
  spot(0, 0);
  for (const side of [-1, 1]) {
    const line = (side * W) / 2;
    const box = 5;
    rect(Math.min(line, line - side * box), -5, Math.max(line, line - side * box), 5);
    rect(Math.min(line, line - side * 1.8), -3.6, Math.max(line, line - side * 1.8), 3.6);
    spot(line - side * 3.6, 0);
    // The D, outside the box only.
    const a = Math.acos(1.4 / 2.8);
    if (side < 0) arc(line + 3.6, 0, 2.8, -a, a);
    else arc(line - 3.6, 0, 2.8, Math.PI - a, Math.PI + a);
    for (const corner of [-1, 1]) {
      const cy = (corner * H) / 2;
      const start = Math.atan2(-corner, -side);
      arc(line, cy, 0.7, start - Math.PI / 4, start + Math.PI / 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, gw, gh };
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
  return tex;
}

function goal(side: number) {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f5fb, roughness: 0.35 });
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
  const tex = netTexture();
  const net = (w: number, h: number, repeatW: number, repeatH: number) => {
    const t = tex.clone();
    t.repeat.set(repeatW, repeatH);
    t.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 1 });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
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
    const uv = geo.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4);
    const t = tex.clone();
    t.needsUpdate = true;
    const sideNet = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide }));
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

function stands(scene: THREE.Scene) {
  const front = 2;
  const terraces: Terrace[] = [
    { x: 0, z: -(H / 2 + APRON + front), out: new THREE.Vector2(0, -1), length: W + APRON * 2 + 6 },
    { x: 0, z: H / 2 + APRON + front, out: new THREE.Vector2(0, 1), length: W + APRON * 2 + 6 },
    { x: -(W / 2 + APRON + front), z: 0, out: new THREE.Vector2(-1, 0), length: H + APRON * 2 },
    { x: W / 2 + APRON + front, z: 0, out: new THREE.Vector2(1, 0), length: H + APRON * 2 },
  ];
  const concrete = new THREE.MeshStandardMaterial({ color: 0x353b66, roughness: 0.9 });
  const fan = new THREE.BoxGeometry(0.42, 0.62, 0.34);
  fan.translate(0, 0.31, 0);
  const spacing = 0.62;
  let total = 0;
  for (const t of terraces) total += ROWS * Math.floor(t.length / spacing);
  const crowd = new THREE.InstancedMesh(fan, new THREE.MeshStandardMaterial({ roughness: 0.9 }), total);
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
      scene.add(step);
      const seats = Math.floor(t.length / spacing);
      for (let i = 0; i < seats; i++) {
        const a = (i - (seats - 1) / 2) * spacing + (Math.random() - 0.5) * 0.12;
        const pos = new THREE.Vector3(t.x + t.out.x * d + along.x * a, top, t.z + t.out.y * d + along.y * a);
        // Empty seats here and there.
        const s = Math.random() < 0.12 ? 0 : 0.85 + Math.random() * 0.3;
        m.compose(pos, q, new THREE.Vector3(s, s, s));
        crowd.setMatrixAt(n, m);
        crowd.setColorAt(n, color.setHex(CROWD_COLORS[Math.floor(Math.random() * CROWD_COLORS.length)]!));
        n++;
      }
    }
  }
  scene.add(crowd);
}

function floodlights(scene: THREE.Scene) {
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
      scene.add(pole);
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
      scene.add(head);

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
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x1d2140, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(goal(-1), goal(1));
  stands(scene);
  return { lights: floodlights(scene) };
}
