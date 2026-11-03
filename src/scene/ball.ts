import * as THREE from 'three';
import { CONFIG } from '../config';

// A white ball with dark patches that rolls with its ground speed.

function ballTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f5fb';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#1d2140';
  // Patches at the icosahedron's vertices, on the equirectangular map.
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.attributes.position!;
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
    const key = v.toArray().map(n => n.toFixed(3)).join();
    if (seen.has(key)) continue;
    seen.add(key);
    const u = (Math.atan2(v.x, v.z) / (2 * Math.PI) + 0.5) * 512;
    const lat = Math.asin(v.y);
    const y = (0.5 - lat / Math.PI) * 256;
    // Widen near the poles to undo the projection's squash.
    const stretch = 1 / Math.max(0.35, Math.cos(lat));
    for (const wrap of [-512, 0, 512]) {
      ctx.beginPath();
      ctx.ellipse(u + wrap, y, 26 * stretch, 26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBall() {
  const r = CONFIG.ball.radius;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(r, 32, 16),
    new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }),
  );
  mesh.castShadow = true;
  mesh.position.y = r;
  return mesh;
}

const up = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3();
const spin = new THREE.Quaternion();

// Rolls the ball by the distance it moved this frame.
export function rollBall(mesh: THREE.Mesh, dx: number, dz: number) {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-5) return;
  axis.set(dx, 0, dz).cross(up).negate().normalize();
  spin.setFromAxisAngle(axis, dist / CONFIG.ball.radius);
  mesh.quaternion.premultiply(spin);
}
