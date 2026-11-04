import * as THREE from 'three';
import { CONFIG } from '../config';

// Pitch-side advertising boards along the far side and both ends, for
// sponsors that don't exist. One painted canvas holds every advert; each
// board shows one by its UVs, so they all bake into a single mesh.

interface Ad {
  name: string;
  wash: string;
  ink: string;
}

const ADS: Ad[] = [
  { name: 'Dribble Cola', wash: '#ff5e45', ink: '#fff4e0' },
  { name: 'Wet Paint', wash: '#3d8bff', ink: '#fffbe8' },
  { name: 'Offside Pizza', wash: '#ffc23a', ink: '#1d2140' },
  { name: 'Top Bins', wash: '#2ec4b6', ink: '#0d1026' },
  { name: 'Inkwell Bank', wash: '#1f2552', ink: '#ffc53d' },
  { name: 'Stickman Gym', wash: '#8a5cff', ink: '#fff4e0' },
  { name: 'Nutmeg & Co.', wash: '#ff5e8a', ink: '#fff4e0' },
  { name: 'Splash & Dash', wash: '#52d27c', ink: '#0d1026' },
];

// Twice the board's size on screen at the broadcast camera, and the same
// shape as a board, so the lettering isn't stretched.
const BOARD = { len: 4.4, h: 1.05, gap: 0.12 };
const PANEL_W = 1024;
const PANEL_H = Math.round((PANEL_W * BOARD.h) / BOARD.len);
// The lettering's dark or light outline, opposite its fill, so it survives
// the paint pass's wobble and bleed.
const outline = (ink: string) => (parseInt(ink.slice(1, 3), 16) > 128 ? '#0d1026' : '#fff4e0');

function paintAds(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  ADS.forEach((ad, i) => {
    const y = i * PANEL_H;
    ctx.fillStyle = ad.wash;
    ctx.fillRect(0, y, PANEL_W, PANEL_H);
    // Lifted and pooled pigment, so no two boards are flat colour.
    for (const [fx, fr, a] of [[0.18, 0.27, 0.25], [0.84, 0.31, -0.22], [0.51, 0.18, 0.15]] as const) {
      const x = fx * PANEL_W;
      const r = fr * PANEL_W;
      const g = ctx.createRadialGradient(x, y + PANEL_H / 2, 0, x, y + PANEL_H / 2, r);
      g.addColorStop(0, a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, PANEL_W, PANEL_H);
    }
    // Just the name, as big as fits.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = PANEL_H * 0.78;
    ctx.font = `${size}px 'Caveat Brush', cursive`;
    const fit = (PANEL_W * 0.88) / ctx.measureText(ad.name).width;
    if (fit < 1) size *= fit;
    ctx.font = `${size}px 'Caveat Brush', cursive`;
    const cy = y + PANEL_H * 0.54;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = outline(ad.ink);
    ctx.strokeText(ad.name, PANEL_W / 2, cy);
    ctx.fillStyle = ad.ink;
    ctx.fillText(ad.name, PANEL_W / 2, cy);
  });
}

function adsTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_W;
  canvas.height = PANEL_H * ADS.length;
  paintAds(canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Sharp at a glancing angle too, for the boards behind the goals (three.js
  // caps this at what the GPU allows).
  tex.anisotropy = 16;
  // The fonts may still be loading the first time: paint again once they're in.
  void document.fonts.load("80px 'Caveat Brush'").then(() => {
    paintAds(canvas);
    tex.needsUpdate = true;
  });
  return tex;
}

// A row of boards from a to b, facing the pitch.
function row(group: THREE.Group, face: THREE.Material, frame: THREE.Material, from: THREE.Vector2, to: THREE.Vector2, start: number) {
  const along = to.clone().sub(from);
  const length = along.length();
  along.normalize();
  const count = Math.floor(length / (BOARD.len + BOARD.gap));
  const yaw = Math.atan2(along.x, along.y) - Math.PI / 2;
  const used = count * (BOARD.len + BOARD.gap) - BOARD.gap;
  for (let i = 0; i < count; i++) {
    const d = (length - used) / 2 + i * (BOARD.len + BOARD.gap) + BOARD.len / 2;
    const x = from.x + along.x * d;
    const z = from.y + along.y * d;
    const ad = (start + i) % ADS.length;
    const geo = new THREE.PlaneGeometry(BOARD.len, BOARD.h);
    // Show just this advert's strip of the canvas.
    const uv = geo.attributes.uv!;
    for (let k = 0; k < uv.count; k++) {
      uv.setY(k, 1 - (ad + 1 - uv.getY(k)) / ADS.length);
    }
    const panel = new THREE.Mesh(geo, face);
    panel.position.set(x, BOARD.h / 2 + 0.08, z);
    panel.rotation.y = yaw;
    panel.translateZ(0.09);
    group.add(panel);
    const box = new THREE.Mesh(new THREE.BoxGeometry(BOARD.len + 0.08, BOARD.h + 0.12, 0.16), frame);
    box.position.set(x, BOARD.h / 2 + 0.08, z);
    box.rotation.y = yaw;
    box.castShadow = true;
    group.add(box);
  }
}

// The boards, added to the group of things that never move (they get baked).
export function adBoards(fixed: THREE.Group) {
  const { width: W, height: H } = CONFIG.pitch;
  // Lit by themselves, as boards at a night match are.
  const face = new THREE.MeshBasicMaterial({ map: adsTexture() });
  const frame = new THREE.MeshStandardMaterial({ color: 0x141936, roughness: 0.8 });
  const zFar = -(H / 2 + 4.9);
  const xEnd = W / 2 + 4.9;
  const reach = H / 2 + 3.6;
  // Far side, left to right, facing the camera.
  row(fixed, face, frame, new THREE.Vector2(-xEnd + 0.3, zFar), new THREE.Vector2(xEnd - 0.3, zFar), 0);
  // Behind each goal, facing back up the pitch.
  row(fixed, face, frame, new THREE.Vector2(-xEnd, reach), new THREE.Vector2(-xEnd, -reach), 3);
  row(fixed, face, frame, new THREE.Vector2(xEnd, -reach), new THREE.Vector2(xEnd, reach), 5);
}
