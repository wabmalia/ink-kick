import * as THREE from 'three';
import { CONE_RADIUS, CONE_SPOTS, CONES, DUEL, SPRINT, TACKLE, type Box, type Lane } from '../game/training';
import { whenFontReady } from './font';

// The training ground's markings, painted in gold over the pitch: the duel
// and tackle boxes on the left half, the two lanes running up the right half
// with their gates and names, and the cones.

const GOLD = 0xffc23a;
const LIFT = 0.016;

const paint = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.9, transparent: true, opacity: 0.9 });

function flat(w: number, h: number, x: number, z: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paint);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, LIFT, z);
  m.receiveShadow = true;
  // After the grass, which is transparent too, so it never paints over.
  m.renderOrder = 1;
  return m;
}

function word(text: string, x: number, z: number, color = '#ffc23a', size = 1, outline = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '400 92px "Caveat Brush", cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.strokeStyle = '#12152a';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  const paintText = () => {
    if (outline) ctx.strokeText(text, 256, 68);
    ctx.fillText(text, 256, 68);
  };
  paintText();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2 * size, 0.8 * size),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, LIFT, z);
  m.renderOrder = 1;
  whenFontReady(() => {
    ctx.clearRect(0, 0, 512, 128);
    paintText();
    tex.needsUpdate = true;
  });
  return m;
}

function lane(group: THREE.Group, l: Lane) {
  const [a, b] = l.gates;
  for (const gy of l.gates) group.add(flat(l.half * 2, 0.16, l.x, gy));
  // Dashed edges between the gates.
  for (const side of [-1, 1]) {
    for (let y = a + 0.3; y < b - 0.3; y += 1.2) group.add(flat(0.06, 0.6, l.x + side * l.half, y + 0.3));
  }
  // The name just past the near gate, where it reads best.
  group.add(word(l.name, l.x, b + 0.75));
}

// Four solid edges, the name inside the near-left corner.
function box(group: THREE.Group, b: Box, name: string) {
  const { x, y, hw, hh } = b;
  const t = 0.14;
  group.add(
    flat(hw * 2 + t, t, x, y - hh), flat(hw * 2 + t, t, x, y + hh),
    flat(t, hh * 2, x - hw, y), flat(t, hh * 2, x + hw, y),
    word(name, x - hw + 1.8, y + hh - 0.6),
  );
}

// Hot pink: the strongest contrast on the green, and unlike the gold
// markings or the white lines.
const POKE = 0xff4fd8;

/** A thin pink ring on the ground around your feet, how far a press
 *  still pokes, with "Poke" under it. The ring is scaled to the reach; the
 *  word is moved, not scaled. */
export function buildReachRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 64),
    new THREE.MeshBasicMaterial({ color: POKE, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = LIFT * 2;
  ring.renderOrder = 2;
  const label = word('Poke', 0, 0, '#ff4fd8', 1.5, true);
  label.position.y = LIFT * 2;
  label.renderOrder = 2;
  return { ring, label };
}

export function buildTraining() {
  const group = new THREE.Group();
  lane(group, SPRINT);
  lane(group, CONES);
  box(group, DUEL, 'Duel');
  box(group, TACKLE, 'Tackle');

  const coneGeo = new THREE.ConeGeometry(CONE_RADIUS * 1.6, 0.5, 18);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, roughness: 0.6 });
  for (const c of CONE_SPOTS) {
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(c.x, 0.25, c.y);
    cone.castShadow = true;
    group.add(cone);
  }
  return group;
}
