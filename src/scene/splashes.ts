import * as THREE from 'three';

// Watercolour on the grass: droplets kicked up by footsteps, slides, kicks
// and the rolling ball; team ink from kicks, shot trails and tackles; and
// stains where the ball hits a wall. Purely for show, worked out by each
// screen from what it already draws, so nothing extra goes over the network. A fixed pool, all drawn in one batch; when
// it's full the oldest goes first.

const MAX = 1400;
// Pale greens and near-white, with some deeper pigment: water and paint
// flicked off the grass, showing on light stripes and dark ones.
export const GRASS_DROPS = [0xcfe8b0, 0xa8d68a, 0xe9f3d8, 0xf4f7ea, 0x3f8a3c, 0x2a6433, 0x7fbf5a];
// Deeper greens for the ball cutting through the grass.
export const TURF_DROPS = [0x3f8a3c, 0x2a6433, 0x5ea24a, 0x7fbf5a, 0x1f5a34];
// The box of paints a wall hit picks from.
export const PAINTS = [0x3d8bff, 0xff5e8a, 0xffb02e, 0x8a5cff, 0x2ec4b6, 0xffe066, 0xff6b4a];
// Brighter still, all at once, for a goal.
export const BRIGHT = [0x2f8cff, 0xff2e88, 0xffb000, 0x8f4dff, 0x00d4b4, 0xffe600, 0xff4d2e, 0x34e05b];

interface Drop {
  x: number;
  z: number;
  vx: number;
  vz: number;
  size: number;
  spin: number;
  age: number;
  life: number;
  alpha: number;
  // Fraction of its life after which it starts to fade.
  fadeFrom: number;
  // Stains spread and stay put; drops fly, then soak in and shrink.
  stain: boolean;
}

export interface Burst {
  x: number;
  z: number;
  // Direction it flies, roughly.
  dx: number;
  dz: number;
  count: number;
  speed: number;
  size: number;
  colors: number[];
  // How far off the direction drops may stray, in radians.
  spread: number;
  life?: number;
  alpha?: number;
  stain?: boolean;
}

// An uneven blot rather than a perfect disc.
function blotGeometry() {
  const shape = new THREE.Shape();
  const n = 11;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.72 + 0.38 * Math.abs(Math.sin(i * 2.7 + 1.3));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// A basic material whose opacity comes from each instance.
function fadingMaterial() {
  const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute float instanceAlpha;\nvarying float vAlpha;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = instanceAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'varying float vAlpha;\n#include <common>')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>');
  };
  return m;
}

export class Splashes {
  readonly mesh: THREE.InstancedMesh;
  private drops: Drop[] = [];
  private alphas: THREE.InstancedBufferAttribute;
  private next = 0;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private color = new THREE.Color();

  constructor() {
    const geo = blotGeometry();
    this.alphas = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('instanceAlpha', this.alphas);
    this.mesh = new THREE.InstancedMesh(geo, fadingMaterial(), MAX);
    this.mesh.frustumCulled = false;
    // After the grass and the ground, which are see-through too and sit at
    // the same spot: left to a tie, which one drew last came down to the
    // order things were made in, and the grass painted over every splash.
    this.mesh.renderOrder = 1;
    for (let i = 0; i < MAX; i++) {
      this.drops.push({ x: 0, z: 0, vx: 0, vz: 0, size: 0, spin: 0, age: 1, life: 1, alpha: 0, fadeFrom: 0, stain: false });
      this.mesh.setColorAt(i, this.color.setHex(0xffffff));
    }
  }

  burst(b: Burst) {
    const len = Math.hypot(b.dx, b.dz) || 1;
    const base = Math.atan2(b.dz / len, b.dx / len);
    for (let i = 0; i < b.count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % MAX;
      const a = base + (Math.random() - 0.5) * b.spread;
      const v = b.speed * (0.4 + Math.random() * 0.8);
      Object.assign(this.drops[k]!, {
        x: b.x + (Math.random() - 0.5) * 0.15,
        z: b.z + (Math.random() - 0.5) * 0.15,
        vx: Math.cos(a) * v,
        vz: Math.sin(a) * v,
        size: b.size * (0.5 + Math.random()),
        spin: Math.random() * Math.PI * 2,
        age: 0,
        life: (b.life ?? 0.6) * (0.7 + Math.random() * 0.6),
        alpha: b.alpha ?? 0.8,
        fadeFrom: b.stain ? 0.55 : 0.3,
        stain: !!b.stain,
      });
      this.mesh.setColorAt(k, this.color.setHex(b.colors[Math.floor(Math.random() * b.colors.length)]!));
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      const d = this.drops[i]!;
      d.age += dt;
      const t = d.age / d.life;
      if (t >= 1) {
        this.matrix.makeScale(0, 0, 0);
        this.alphas.setX(i, 0);
      } else {
        d.x += d.vx * dt;
        d.z += d.vz * dt;
        const drag = Math.exp(-dt * 7);
        d.vx *= drag;
        d.vz *= drag;
        // Lands and spreads; a drop then soaks in a little smaller.
        const spread = d.stain ? Math.min(1, 0.4 + t * 8) : t < 0.15 ? 0.5 + (t / 0.15) * 0.5 : 1;
        const soak = d.stain ? 1 : 1 - 0.35 * Math.max(0, (t - 0.3) / 0.7);
        const s = d.size * spread * soak;
        this.quat.setFromAxisAngle(this.up, d.spin);
        // Stains sit under the drops.
        this.matrix.compose(this.pos.set(d.x, d.stain ? 0.022 : 0.03, d.z), this.quat, this.scale.set(s, 1, s));
        this.alphas.setX(i, d.alpha * (t < d.fadeFrom ? 1 : 1 - (t - d.fadeFrom) / (1 - d.fadeFrom)));
      }
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphas.needsUpdate = true;
  }

  clear() {
    for (const d of this.drops) d.age = d.life;
  }
}
