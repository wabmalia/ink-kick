import * as THREE from 'three';
import { PART_GEOMETRY, type Footballer, type Part } from './footballer';

// Every stickman on the pitch drawn together: one instanced mesh per part
// (torso, head, upper arm...), so the draw calls don't grow with the number
// of players. Footballers keep their own joints and animation; flush() copies
// where each piece ended up into the instances.

const START_CAPACITY = 16;

export class StickmanBatch {
  private meshes = new Map<Part, THREE.InstancedMesh>();
  // How many pieces of each part one stickman has (two arms, two legs...).
  private perMan = new Map<Part, number>();
  private members: Footballer[] = [];
  private capacity = 0;
  private material = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  private geometry = new Map<Part, THREE.BufferGeometry>();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private color = new THREE.Color();

  constructor(private scene: THREE.Scene) {}

  add(f: Footballer) {
    if (!this.perMan.size) {
      for (const { part } of f.pieces) this.perMan.set(part, (this.perMan.get(part) ?? 0) + 1);
    }
    this.members.push(f);
    if (this.members.length > this.capacity) this.grow(Math.max(START_CAPACITY, this.capacity * 2));
    this.paint(this.members.length - 1);
  }

  remove(f: Footballer) {
    const i = this.members.indexOf(f);
    if (i < 0) return;
    // The last one moves into the gap, so the instances stay packed.
    const last = this.members.pop()!;
    if (last !== f) {
      this.members[i] = last;
      this.paint(i);
    }
  }

  private grow(capacity: number) {
    this.capacity = capacity;
    for (const [part, per] of this.perMan) {
      this.scene.remove(this.meshes.get(part) ?? new THREE.Object3D());
      this.meshes.get(part)?.dispose();
      let geo = this.geometry.get(part);
      if (!geo) {
        geo = PART_GEOMETRY[part]();
        this.geometry.set(part, geo);
      }
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity * per);
      mesh.castShadow = true;
      // The players move all over; bounds would need updating every frame.
      mesh.frustumCulled = false;
      this.meshes.set(part, mesh);
      this.scene.add(mesh);
    }
    for (let i = 0; i < this.members.length; i++) this.paint(i);
  }

  // Colours for the stickman at index i.
  private paint(i: number) {
    const seen = new Map<Part, number>();
    for (const { part, color } of this.members[i]!.pieces) {
      const j = seen.get(part) ?? 0;
      seen.set(part, j + 1);
      const mesh = this.meshes.get(part)!;
      mesh.setColorAt(i * this.perMan.get(part)! + j, this.color.setHex(color));
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  // Copies every piece's place into its instance. Call once a frame, after
  // the footballers have been posed.
  flush() {
    const n = this.members.length;
    for (const [part, mesh] of this.meshes) mesh.count = n * this.perMan.get(part)!;
    const seen = new Map<Part, number>();
    for (let i = 0; i < n; i++) {
      const f = this.members[i]!;
      f.group.updateMatrixWorld(true);
      seen.clear();
      for (const { part, slot } of f.pieces) {
        const j = seen.get(part) ?? 0;
        seen.set(part, j + 1);
        this.meshes.get(part)!.setMatrixAt(i * this.perMan.get(part)! + j, f.group.visible ? slot.matrixWorld : this.hidden);
      }
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }
}
