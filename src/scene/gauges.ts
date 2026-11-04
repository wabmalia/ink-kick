import * as THREE from 'three';

// The marks on the grass round the player you control: a gold ring, and
// outside it a half ring on the near side split into two gauges that fill
// outwards from the bottom middle. Stamina on the left, shown only when it's
// not full, red and pulsing while tired; kick power on the right, shown only
// while charging, warming from gold to red.

const RING = [0.54, 0.66] as const;
const GAUGE = [0.74, 0.88] as const;
// Gap either side of the bottom middle, in radians.
const GAP = 0.05;
const QUARTER = Math.PI / 2 - GAP;
// Angle of the bottom middle once the ring lies flat (local -y is +z, the
// side nearest the camera).
const BOTTOM = Math.PI * 1.5;

const GOLD = new THREE.Color(0xf2b134);
const RED = new THREE.Color(0xe2553f);
const PAPER = new THREE.Color(0xeef0fa);

const flat = (color: THREE.ColorRepresentation, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

// One geometry per percent and side, built as needed.
const arcs = new Map<string, THREE.RingGeometry>();
function arc(side: -1 | 1, amount: number) {
  const pct = Math.round(Math.min(1, Math.max(0, amount)) * 100);
  const key = `${side}:${pct}`;
  let geo = arcs.get(key);
  if (!geo) {
    const length = Math.max(0.001, (pct / 100) * QUARTER);
    const start = side < 0 ? BOTTOM - GAP - length : BOTTOM + GAP;
    geo = new THREE.RingGeometry(GAUGE[0], GAUGE[1], Math.max(2, Math.ceil(pct / 4)), 1, start, length);
    arcs.set(key, geo);
  }
  return geo;
}

class Gauge {
  readonly track: THREE.Mesh;
  readonly fill: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private shown = 0;
  private amount = 0;

  constructor(readonly side: -1 | 1, parent: THREE.Object3D) {
    this.track = new THREE.Mesh(arc(side, 1), flat(PAPER, 0.18));
    this.fill = new THREE.Mesh(arc(side, 0), flat(PAPER, 0.9));
    parent.add(this.track, this.fill);
  }

  // Eases in and out rather than popping, holding its last amount as it
  // fades.
  set(visible: boolean, amount: number, color: THREE.Color, opacity: number, dt: number) {
    this.shown = Math.min(1, Math.max(0, this.shown + (visible ? dt : -dt) * 6));
    this.track.visible = this.fill.visible = this.shown > 0;
    if (visible) this.amount = amount;
    this.fill.geometry = arc(this.side, this.amount);
    this.fill.material.color.copy(color);
    this.fill.material.opacity = opacity * this.shown;
    (this.track.material as THREE.MeshBasicMaterial).opacity = 0.18 * this.shown;
  }
}

export class PlayerGauges {
  readonly group = new THREE.Group();
  private stamina: Gauge;
  private power: Gauge;
  private warm = new THREE.Color();

  constructor() {
    const flatGroup = new THREE.Group();
    flatGroup.rotation.x = -Math.PI / 2;
    this.group.add(flatGroup);
    this.group.position.y = 0.02;
    flatGroup.add(new THREE.Mesh(new THREE.RingGeometry(RING[0], RING[1], 48), flat(GOLD, 0.85)));
    this.stamina = new Gauge(-1, flatGroup);
    this.power = new Gauge(1, flatGroup);
    // After the grass, which is see-through too: sorted by distance alone,
    // the grass painted over these whenever you were on the far half.
    flatGroup.traverse(o => (o.renderOrder = 1));
  }

  // tired is the fraction of the tired spell left, 0 when not tired.
  update(dt: number, time: number, stamina: number, tired: number, charging: boolean, charge: number) {
    if (tired > 0) {
      // Refills as the tired spell wears off.
      this.stamina.set(true, 1 - tired, RED, 0.6 + 0.3 * Math.sin(time * 12), dt);
    } else {
      this.stamina.set(stamina < 1, stamina, PAPER, 0.9, dt);
    }
    this.power.set(charging, charge, this.warm.copy(GOLD).lerp(RED, charge), 0.95, dt);
  }
}
