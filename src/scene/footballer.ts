import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Action } from '../engine/sim';
import { smooth } from '../math';

// A stickman footballer: team-coloured sticks and a round head, with a joint hierarchy
// (hips, knees, shoulders, elbows) animated in code: run cycle from the
// ground speed, idle sway, and a kick on the right leg. Local forward is +z.

export interface Kit {
  color: number;
}

// The shapes a stickman is made of, shared by every one of them.
export type Part = 'torso' | 'head' | 'upperArm' | 'forearm' | 'thigh' | 'shin' | 'foot';
// A stick hanging from its joint, length to the next joint.
const stick = (length: number, radius: number) => () => new THREE.CapsuleGeometry(radius, length - radius, 4, 10);
export const PART_GEOMETRY: Record<Part, () => THREE.BufferGeometry> = {
  torso: () => new THREE.CapsuleGeometry(0.1, 0.46, 4, 10),
  head: () => new THREE.SphereGeometry(0.19, 20, 14),
  upperArm: stick(0.28, 0.07),
  forearm: stick(0.27, 0.065),
  thigh: stick(0.43, 0.08),
  shin: stick(0.43, 0.072),
  foot: () => new THREE.SphereGeometry(0.07, 10, 8),
};
const HEAD = 0xf4efe4;
const INK = 0x1d2140;

// Metres of ground per full stride (two steps).
const STRIDE = 1.7;
const RUN_SPEED = 7;
const KICK_TIME = 0.34;
// A charged kick skips the wind-up the charge pose already did.
const KICK_FROM_WINDUP = 0.35;

// What the sim says this player is doing, for the frame being drawn.
export interface Pose {
  speed: number;
  // Radians about the vertical, atan2(dx, dz).
  heading: number;
  action: Action;
  actionT: number;
  charge: number;
  tired: boolean;
  // 0..1: right arm raised overhead, as a referee tossing the coin.
  armUp?: number;
  // How long a stumble lasts, seconds (it varies with Strength).
  stumble?: number;
  // Ground velocity, world x and z, for skids and leaning into turns.
  vx?: number;
  vz?: number;
}

// Braking harder than this (m/s²) starts a skid pose, full at SKID_FULL more;
// it eases in over SKID_IN seconds and is held, then eases out over SKID_OUT.
const SKID_FROM = 8;
const SKID_FULL = 10;
const SKID_IN = 0.05;
const SKID_OUT = 0.28;
const SKID_TOO_SUDDEN = 220;
// Only a skid from a run shows: none from below SKID_SPEED_FROM (m/s),
// full from SKID_SPEED_FULL.
const SKID_SPEED_FROM = 3;
const SKID_SPEED_FULL = 4.5;
// How quickly (per second) the planted leg swaps from in front to behind as
// you turn round.
const SKID_SWAP = 12;
// How quickly (per second) the gait eases between running, backpedalling
// and shuffling.
const GAIT_EASE = 10;


// Piecewise keyframes: [time 0..1, value], eased between each pair.
function keys(frames: [number, number][], t: number) {
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i]!;
    const [t0, v0] = frames[i - 1]!;
    if (t <= t1) return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
  }
  return frames[frames.length - 1]![1];
}

export class Footballer {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private shoulderL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private torso = new THREE.Group();

  private phase = 0;
  private time = Math.random() * 10;
  private kickT = -1;
  private kickPower = 1;
  // Blend weights that ease the slide pose in and out.
  private slideW = 0;
  // The skid: its weight, and the side the slide is carrying you, 1
  // forward, -1 back (relative to facing), eased as you turn round; and
  // last frame's velocity to measure braking by.
  private skidW = 0;
  private skidDir = 1;
  private tiltS = 0;
  // Eased weights for backing off and moving across, 0..1.
  private backW = 0;
  private sideW = 0;
  private lastV: { x: number; z: number } | null = null;

  /** 0..1, how hard this player is skidding, for the scuff marks. */
  get skid() {
    return this.skidW;
  }

  // Each drawn piece: which shared part it is, the joint-space slot that
  // places it, and its colour. StickmanBatch draws them all, instanced.
  readonly pieces: { part: Part; slot: THREE.Object3D; color: number }[] = [];

  constructor(kit: Kit) {
    const add = (parent: THREE.Object3D, part: Part, color: number, y: number, x = 0, z = 0) => {
      const slot = new THREE.Object3D();
      slot.position.set(x, y, z);
      parent.add(slot);
      this.pieces.push({ part, slot, color });
      return slot;
    };

    this.group.add(this.body);

    const pelvis = new THREE.Group();
    pelvis.position.y = 0.92;
    this.body.add(pelvis);

    pelvis.add(this.torso);
    add(this.torso, 'torso', kit.color, 0.3);
    add(this.torso, 'head', HEAD, 0.8);

    for (const [shoulder, elbow, side] of [[this.shoulderL, this.elbowL, 1], [this.shoulderR, this.elbowR, -1]] as const) {
      shoulder.position.set(side * 0.06, 0.52, 0);
      shoulder.rotation.z = side * 0.12;
      this.torso.add(shoulder);
      add(shoulder, 'upperArm', kit.color, -0.14);
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      add(elbow, 'forearm', kit.color, -0.135);
    }

    for (const [hip, knee, side] of [[this.hipL, this.kneeL, 1], [this.hipR, this.kneeR, -1]] as const) {
      hip.position.set(side * 0.06, 0.0, 0);
      pelvis.add(hip);
      add(hip, 'thigh', kit.color, -0.215);
      knee.position.y = -0.43;
      hip.add(knee);
      add(knee, 'shin', kit.color, -0.215);
      // A small dab of a foot, pointing forward.
      add(knee, 'foot', INK, -0.45, 0, 0.05).scale.set(0.9, 0.7, 1.5);
    }
  }

  // Strikes with the right foot, harder for a fuller charge.
  kick(power: number) {
    this.kickT = KICK_FROM_WINDUP * KICK_TIME;
    this.kickPower = power;
  }

  update(dt: number, pose: Pose) {
    this.time += dt;
    this.group.rotation.y = pose.heading;
    const { tackle } = CONFIG;

    const s = Math.min(1, pose.speed / RUN_SPEED);
    const moving = Math.min(1, s * 3);
    const vx = pose.vx ?? 0;
    const vz = pose.vz ?? 0;
    const fx = Math.sin(pose.heading);
    const fz = Math.cos(pose.heading);
    // Which way they're going against the way they face, eased: backing
    // off (backpedalling, short quick steps, leaning back) and moving
    // across (a side shuffle, legs opening and closing) look different from
    // running.
    const v = Math.hypot(vx, vz);
    const gait = pose.action === 'none' || pose.action === 'poke' ? 1 : 0;
    const wantBack = v > 0.5 ? gait * Math.max(0, -(vx * fx + vz * fz) / v) : 0;
    const wantSide = v > 0.5 ? gait * Math.abs(vx * fz - vz * fx) / v : 0;
    const ease = Math.min(1, dt * GAIT_EASE);
    this.backW += (wantBack - this.backW) * ease;
    this.sideW += (wantSide - this.sideW) * ease;
    const bw = this.backW * moving;
    const sideW = this.sideW * moving;
    // Backwards the cycle runs the other way, in shorter, quicker steps.
    this.phase += ((pose.speed * dt * Math.PI * 2) / STRIDE) * (1 - 2 * this.backW) * (1 + 0.5 * this.backW + 0.4 * this.sideW);
    const swing = Math.sin(this.phase) * (0.25 + 0.65 * s) * moving * (1 - 0.45 * this.backW - 0.75 * this.sideW);

    // Run cycle. Negative x rotation swings a limb forward.
    let hipL = -swing;
    let hipR = swing;
    const lift = 1 - 0.55 * this.backW - 0.6 * this.sideW;
    let kneeL = moving * (0.2 + 1.1 * s * lift * Math.max(0, Math.cos(this.phase)));
    let kneeR = moving * (0.2 + 1.1 * s * lift * Math.max(0, -Math.cos(this.phase)));
    let shoulderL = swing * 0.9;
    let shoulderR = -swing * 0.9;
    let elbow = -(0.25 + 1.05 * s);
    // Leaning into a run; back on the heels backing off, and low, knees
    // bent, either way.
    let lean = 0.16 * s * (1 - this.backW - this.sideW * 0.8) - 0.2 * bw;
    let bob = 0.06 * s * Math.abs(Math.cos(this.phase));
    let drop = -0.07 * Math.max(bw, sideW);
    kneeL += 0.3 * Math.max(bw, sideW);
    kneeR += 0.3 * Math.max(bw, sideW);
    let back = 0;
    let spread = 0.12 + 0.25 * sideW;
    // The shuffle: legs open and close sideways.
    let open = sideW * (0.14 + 0.16 * Math.sin(this.phase));

    // Skid: braking hard, one leg planted towards the way you're still
    // sliding, the other bent under, leaning the way you want to go: the
    // front leg as the turn starts, the trailing one once round. And a lean
    // into a turn.
    if (this.lastV && dt > 0) {
      const v0 = Math.hypot(this.lastV.x, this.lastV.z);
      let brake = v0 > 1.5 ? -((vx - this.lastV.x) * this.lastV.x + (vz - this.lastV.z) * this.lastV.z) / v0 / dt : 0;
      // Faster than any skid: put back on a spot for a restart, not braking.
      if (brake > SKID_TOO_SUDDEN) brake = 0;
      const fast = Math.max(0, Math.min(1, (v0 - SKID_SPEED_FROM) / (SKID_SPEED_FULL - SKID_SPEED_FROM)));
      const want = fast * Math.max(0, Math.min(1, (brake - SKID_FROM) / SKID_FULL));
      if (want > this.skidW) {
        this.skidW = Math.min(want, this.skidW + dt / SKID_IN);
      } else {
        this.skidW = Math.max(want, this.skidW - dt / SKID_OUT);
      }
    }
    if (pose.vx === undefined) this.lastV = null;
    else if (this.lastV) Object.assign(this.lastV, { x: vx, z: vz });
    else this.lastV = { x: vx, z: vz };
    const along = vx * fx + vz * fz;
    const dir = Math.max(-1, Math.min(1, along / 1.5));
    this.skidDir += (dir - this.skidDir) * Math.min(1, dt * SKID_SWAP);
    // Sideways speed relative to facing: positive is to the player's left.
    const across = vx * fz - vz * fx;
    // Eased, so it doesn't twitch with every change of speed.
    const turnLean = Math.max(-0.22, Math.min(0.22, across * 0.05)) * (1 - 0.7 * this.sideW);
    this.tiltS += (turnLean - this.tiltS) * Math.min(1, dt * 8);
    let tilt = this.tiltS;

    // Idle: a little breathing and weight shift, quicker when tired.
    const idle = 1 - Math.min(1, s * 4);
    const breath = pose.tired ? 5 : 2.2;
    bob += idle * (pose.tired ? 0.025 : 0.012) * Math.sin(this.time * breath);
    shoulderL += idle * 0.05 * Math.sin(this.time * 1.3);
    shoulderR -= idle * 0.05 * Math.sin(this.time * 1.3);

    if (pose.tired) {
      // Slumped forward, arms hanging; hands on knees when standing still.
      lean += 0.18 + idle * 0.4;
      elbow *= 0.5;
      shoulderL += idle * -0.55;
      shoulderR += idle * -0.55;
      kneeL += idle * 0.35;
      kneeR += idle * 0.35;
      drop -= idle * 0.08;
    }

    const mix = (from: number, to: number, w: number) => from + (to - from) * w;

    const kw = pose.action === 'none' ? smooth(this.skidW) : 0;
    if (kw > 0) {
      const d = this.skidDir;
      // Planted leg (left) out towards the slide, the other bent under.
      hipL = mix(hipL, -0.65 * d, kw);
      kneeL = mix(kneeL, 0.1, kw);
      hipR = mix(hipR, 0.25 * d, kw);
      kneeR = mix(kneeR, 1.15, kw);
      shoulderL = mix(shoulderL, 0.55 * d, kw);
      shoulderR = mix(shoulderR, -0.75 * d, kw);
      spread = mix(spread, 0.5, kw);
      elbow = mix(elbow, -0.6, kw);
      // Leaning against the slide, the way you want to go.
      lean = mix(lean, -0.34 * d, kw);
      drop = mix(drop, -0.14, kw);
      back = mix(back, -0.14 * d, kw);
      tilt = mix(tilt, 0, kw);
      open = mix(open, 0, kw);
    }

    if (pose.action === 'charge') {
      // Right leg drawn back further the more power is stored.
      const w = Math.min(1, pose.actionT / 0.08);
      const c = 0.3 + 0.7 * pose.charge;
      hipR = mix(hipR, 0.85 * c, w);
      kneeR = mix(kneeR, 1.5 * c, w);
      shoulderL = mix(shoulderL, -0.6 * c, w);
      shoulderR = mix(shoulderR, 0.4 * c, w);
      spread = mix(spread, 0.65 * c, w);
      lean = mix(lean, -0.12 * c, w);
    }

    if (pose.action === 'poke') {
      // A quick jab of the right foot.
      const t = Math.min(1, pose.actionT / tackle.pokeTime);
      hipR = keys([[0, hipR], [0.35, -1.15], [1, 0]], t);
      kneeR = keys([[0, kneeR], [0.35, 0.05], [1, 0.3]], t);
      kneeL = keys([[0, kneeL], [0.35, 0.45], [1, 0.2]], t);
      lean = keys([[0, lean], [0.35, 0.3], [1, 0.1]], t);
      spread = keys([[0, spread], [0.35, 0.45], [1, 0.12]], t);
    }

    if (this.kickT >= 0) {
      const t = this.kickT / KICK_TIME;
      // Weight blends the kick over the run so it ends softly.
      const w = keys([[0, 1], [0.8, 1], [1, 0]], t);
      const p = 0.55 + 0.45 * this.kickPower;
      hipR = mix(hipR, keys([[0, 0.2], [0.35, 0.85], [0.58, -1.35 * p], [0.8, -0.9 * p], [1, -0.2]], t), w);
      kneeR = mix(kneeR, keys([[0, 0.3], [0.35, 1.5], [0.58, 0.05], [1, 0.25]], t), w);
      hipL = mix(hipL, 0.15, w);
      kneeL = mix(kneeL, 0.25, w);
      shoulderL = mix(shoulderL, keys([[0, 0], [0.4, -0.6], [0.7, 0.5 * p], [1, 0]], t), w);
      shoulderR = mix(shoulderR, keys([[0, 0], [0.4, 0.4], [0.7, -0.3 * p], [1, 0]], t), w);
      spread = mix(spread, 0.65, w);
      lean = mix(lean, keys([[0, 0.1], [0.4, -0.12], [0.62, 0.22 * p], [1, 0.1]], t), w);
      this.kickT += dt;
      if (this.kickT > KICK_TIME) this.kickT = -1;
    }

    // Slide: dropped onto the left hip, leaning back, right leg out in front.
    // It eases in fast, then out across the get-up.
    const sliding = pose.action === 'slide';
    const target = sliding ? 1 : pose.action === 'recover' ? Math.max(0, 1 - pose.actionT / (tackle.recoverTime * 0.7)) : 0;
    this.slideW = sliding ? Math.min(1, this.slideW + dt / 0.07) : Math.min(this.slideW, target);
    const sw = smooth(this.slideW);
    if (sw > 0) {
      hipR = mix(hipR, -0.85, sw);
      kneeR = mix(kneeR, 0.05, sw);
      hipL = mix(hipL, 0.1, sw);
      kneeL = mix(kneeL, 1.9, sw);
      shoulderL = mix(shoulderL, 0.7, sw);
      shoulderR = mix(shoulderR, -0.4, sw);
      spread = mix(spread, 0.9, sw);
      elbow = mix(elbow, -0.2, sw);
      lean = mix(lean, -0.7, sw);
      drop = mix(drop, -0.52, sw);
      // Leaning back swings the hips behind the feet; shift them forward.
      back = mix(back, 0.6, sw);
      open = mix(open, 0, sw);
    }

    if (pose.action === 'stumble') {
      // Knocked off balance: a wobble that settles.
      const t = Math.min(1, pose.actionT / (pose.stumble || tackle.stumbleTime));
      lean += Math.sin(pose.actionT * 22) * 0.35 * (1 - t);
      spread = mix(spread, 1.1, 1 - t);
      shoulderL = mix(shoulderL, -1.2, 1 - t);
      shoulderR = mix(shoulderR, -1.2, 1 - t);
    }

    this.hipL.rotation.x = hipL;
    this.hipL.rotation.z = open;
    this.hipR.rotation.z = -open;
    this.hipR.rotation.x = hipR;
    this.kneeL.rotation.x = kneeL;
    this.kneeR.rotation.x = kneeR;
    this.shoulderL.rotation.x = shoulderL;
    if (pose.armUp) shoulderR += (-2.7 - shoulderR) * pose.armUp;
    this.shoulderR.rotation.x = shoulderR;
    this.shoulderL.rotation.z = spread;
    this.shoulderR.rotation.z = -spread;
    this.elbowL.rotation.x = elbow;
    this.elbowR.rotation.x = elbow;
    this.body.rotation.x = lean;
    this.body.rotation.z = tilt;
    this.body.position.set(0, bob + drop, back);
    // Counter-twist the shoulders against the hips while running.
    this.torso.rotation.y = -swing * 0.25 * (1 - kw);
  }
}
