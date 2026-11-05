import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Team } from '../engine/sim';

// The scoreboard: a big painted board at the middle of the far side, raised
// above the advertising boards in front of the stand. Placed from the camera,
// so it sits at the top of the screen whatever its shape. Its face is a canvas
// repainted only when the score changes.

const W = 512;
const H = 224;
const SCALE = 2;
const { height } = CONFIG.pitch;
const BOARD = { w: 9, h: 3.94 };
// Standing on the front of the far stand (see stadium.ts: apron, then a gap).
const STAND_FRONT = -(height / 2 + 4 + 2) + 0.3;
// Where its middle goes on screen, in normalised device coordinates: centred,
// near the top, its bottom edge just over the advertising boards.
const AIM = new THREE.Vector2(0, 0.75);
// Never so low that it hides the boards.
const MIN_CENTRE = BOARD.h / 2 + 1.3;

function rough(ctx: CanvasRenderingContext2D, seed: number) {
  // A wandering rounded edge, like the menu's washes.
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts: [number, number][] = [];
  const inset = 10;
  const n = 64;
  const wob = Array.from({ length: 12 }, () => rand() * 2 - 1);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = t * Math.PI * 2;
    // A squircle, so the board stays mostly rectangular.
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const k = 0.18;
    const x = Math.sign(c) * Math.abs(c) ** k;
    const y = Math.sign(sn) * Math.abs(sn) ** k;
    const f = t * wob.length;
    const w0 = wob[Math.floor(f) % wob.length]!;
    const w1 = wob[(Math.floor(f) + 1) % wob.length]!;
    const push = (w0 + (w1 - w0) * (f % 1)) * 5;
    pts.push([W / 2 + x * (W / 2 - inset + push), H / 2 + y * (H / 2 - inset + push)]);
  }
  ctx.beginPath();
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.closePath();
}

export class Billboard {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private shown = '';
  private face: THREE.Mesh;
  private legs: THREE.Mesh[] = [];
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -STAND_FRONT);
  private hit = new THREE.Vector3();

  constructor() {
    // Twice the size it's drawn at, so the numbers stay crisp on the board.
    this.canvas.width = W * SCALE;
    this.canvas.height = H * SCALE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 16;
    // Lit by itself, so it reads at night whatever the floodlights do.
    this.face = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD.w, BOARD.h),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    const steel = new THREE.MeshStandardMaterial({ color: 0x353b66, roughness: 0.7 });
    for (const side of [-1, 1]) {
      // Unit tall, stretched to reach the ground in place().
      const geo = new THREE.CylinderGeometry(0.14, 0.2, 1, 8);
      geo.translate(0, 0.5, 0);
      const leg = new THREE.Mesh(geo, steel);
      leg.position.set(side * BOARD.w * 0.32, 0, -0.05);
      this.legs.push(leg);
      this.group.add(leg);
    }
    this.group.add(this.face);
    this.draw({ gold: 0, red: 0 });
    // The hand-drawn font may still be loading.
    void document.fonts.load("80px 'Caveat Brush'").then(() => {
      this.shown = '';
      this.draw({ gold: 0, red: 0 });
    });
  }

  // Stands it where the camera's ray through AIM meets the front of the far
  // stand, its legs reaching the ground.
  place(camera: THREE.PerspectiveCamera) {
    this.ray.setFromCamera(AIM, camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
    const centre = Math.max(MIN_CENTRE, this.hit.y);
    // Square to the pitch, tipped back partway towards the camera above so
    // it reads without looking like a sticker on the screen.
    this.group.position.set(this.hit.x, 0, this.hit.z);
    this.face.position.y = centre;
    this.face.rotation.x = -0.6 * Math.atan2(camera.position.y - centre, camera.position.z - this.hit.z);
    for (const leg of this.legs) leg.scale.y = centre - BOARD.h / 2 + 0.3;
  }

  setScore(score: Record<Team, number>) {
    this.draw(score);
  }

  private draw(score: Record<Team, number>) {
    const key = `${score.gold}-${score.red}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.clearRect(0, 0, W, H);
    rough(ctx, 7);
    ctx.fillStyle = '#1f2552';
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (const [x, y, r, c] of [[110, 60, 180, '#2a3270'], [420, 180, 200, '#161b40'], [300, 40, 120, '#26306a']] as const) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, c + '00');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    rough(ctx, 7);
    ctx.strokeStyle = 'rgba(84, 104, 200, 0.8)';
    ctx.lineWidth = 7;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Dark outlines round the lettering, as on the advert boards, so it
    // survives the paint pass's wobble and bleed.
    const text = (t: string, x: number, y: number, size: number, colour: string) => {
      ctx.font = `${size}px 'Caveat Brush', cursive`;
      ctx.lineWidth = size * 0.14;
      ctx.strokeStyle = '#0d1026';
      ctx.strokeText(t, x, y);
      ctx.fillStyle = colour;
      ctx.fillText(t, x, y);
    };
    text('GOLD', 128, 56, 50, '#ffc53d');
    text('RED', 384, 56, 50, '#ff7660');
    text(String(score.gold), 128, 150, 150, '#f4f5fb');
    text(String(score.red), 384, 150, 150, '#f4f5fb');
    text('-', 256, 142, 90, '#9aa0bf');
    this.texture.needsUpdate = true;
  }
}
