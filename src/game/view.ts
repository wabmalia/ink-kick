import * as THREE from 'three';
import { CONFIG } from '../config';
import { KEEPER_IDS, TEAM_NAME, type SimEvent, type Team } from '../engine/sim';
import { createBall, rollBall } from '../scene/ball';
import { Footballer } from '../scene/footballer';
import { StickmanBatch } from '../scene/stickmen';
import { PlayerGauges } from '../scene/gauges';
import { BRIGHT, GRASS_DROPS, PAINTS, Splashes, TURF_DROPS } from '../scene/splashes';
import { Billboard } from '../scene/billboard';
import { InfoBoards } from '../scene/info-boards';
import { buildStadium } from '../scene/stadium';
import { buildReachRing, buildTraining } from '../scene/training';
import { Watercolor } from '../scene/watercolor';
import type { PlayerView, ViewState } from './state';
import { DUMMY_ID } from './training';
import { lerp, smooth } from '../math';

// The painted stadium and everyone in it. Draws a ViewState each frame,
// whoever is running the match, and plays the events that come with it.

const KIT: Record<Team, number> = { gold: 0xf2b134, red: 0xe2553f };
const DUMMY_KIT = 0xa7adc4;
// Keepers wear their own colours, as they do.
const KEEPER_KIT: Record<string, number> = { [KEEPER_IDS.gold]: 0x2ec4b6, [KEEPER_IDS.red]: 0x8a5cff };
// Paler versions, for the splatter a kick throws up.
const KIT_LIGHT: Record<Team, number> = { gold: 0xffe3a0, red: 0xffb4a6 };
// What a slide or a skid throws up: grass, and a little of the team's kit.
const SCUFF: Record<Team, number[]> = { gold: [...GRASS_DROPS, KIT_LIGHT.gold], red: [...GRASS_DROPS, KIT_LIGHT.red] };
// Each team's ink: its kit, lighter and deeper, flicked about by its kicks
// and tackles.
const INK: Record<Team, number[]> = { gold: [0xf2b134, 0xffe3a0, 0xd99a1a, 0xffc94d], red: [0xe2553f, 0xffb4a6, 0xb83a26, 0xff7a5c] };
// Kicks harder than this leave an ink trail, a spot every TRAIL_GAP metres.
const TRAIL_FROM = 0.3;
const TRAIL_GAP = 0.4;
// Ground covered per footstep splash, in metres, running and sprinting.
const STEP = 0.85;
const SPRINT_STEP = 0.6;

// The coin toss, in seconds from the coin going up: the camera holds on the
// centre circle, then pulls back to the broadcast view while the captains
// jog to their places and the referee heads off.
const TOSS_OUT_START = 1.9;
const TOSS_OUT_END = CONFIG.coinTime - 0.1;
// Where the captains face the referee, who stands behind the ball.
const TOSS_SPOT: Record<Team, { x: number; y: number }> = { gold: { x: -1.5, y: 0.3 }, red: { x: 1.5, y: 0.3 } };
const REF_SPOT = { x: 0, y: -1.1 };
const REF_EXIT = { x: 0, y: -(CONFIG.pitch.height / 2 + 2) };


export class GameView {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private watercolor: Watercolor;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 1, 300);
  private ball = createBall();
  private gauges = new PlayerGauges();
  private footballers = new Map<string, { team: Team; f: Footballer }>();
  private labels = new Map<string, HTMLElement>();
  private projected = new THREE.Vector3();
  private billboard = new Billboard();
  private infoBoards = new InfoBoards();
  private labelLayer: HTMLElement;
  private coinTimer: ReturnType<typeof setTimeout> | undefined;
  // The broadcast camera, and the close-up on the centre circle for the toss.
  private broadcast = { pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0, 0.6) };
  private closeUp = { pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0.6, 0) };
  private referee = new Footballer({ color: 0x2b2f3a });
  private stickmen: StickmanBatch;
  // While the toss plays: seconds since it began, and each team's captain
  // (picked on the first frame drawn).
  private toss: { t: number; captains: Map<string, Team> | null } | null = null;
  private last = new Map<string, { x: number; y: number }>();
  private splashes = new Splashes();
  // Per player: ground covered since the last footstep, which foot is next,
  // and time since the last spray of a slide.
  private strides = new Map<string, { dist: number; foot: number; spray: number }>();
  private kicks = new Map<string, number>();
  // Tackles won this frame, by who won them.
  private steals = new Set<string>();
  // A hard kick's ink trail behind the ball: whose, for how much longer, and
  // the distance since the last spot.
  private trail: { team: Team; left: number; dist: number; power: number } | null = null;
  // The ball as drawn last frame and its velocity then, to spot it rolling
  // and bouncing off walls; and ground covered since it last kicked up turf.
  private lastBall = { x: 0, y: 0, vx: 0, vy: 0, roll: 0 };
  // The training ground's markings, built the first time it's shown, and
  // the spare balls drawn there.
  private training: THREE.Group | null = null;
  private props: THREE.Mesh[] = [];
  private reachRing: { ring: THREE.Mesh; label: THREE.Mesh } | null = null;

  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    // Tone mapping and the painted look both happen in this pass.
    this.watercolor = new Watercolor(this.renderer);
    buildStadium(this.scene);
    this.scene.add(this.ball, this.gauges.group, this.splashes.mesh);
    this.stickmen = new StickmanBatch(this.scene);
    this.referee.group.scale.setScalar(0.975);
    this.referee.group.visible = false;
    this.stickmen.add(this.referee);
    this.scene.add(this.billboard.group, this.infoBoards.group);
    this.labelLayer = document.getElementById('labels')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // A fixed broadcast camera on the near side, pulled back just far enough
  // that the four corners and both goals stay in view at any window shape.
  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { camera } = this;
    this.renderer.setSize(w, h);
    this.watercolor.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const { width: W, height: H, goalDepth } = CONFIG.pitch;
    const look = new THREE.Vector3(0, 0, 0.6);
    const view = new THREE.Vector3(0, 19.5, 21.5).normalize();
    const mustSee = [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [
      new THREE.Vector3(sx * (W / 2 + goalDepth + 0.6), 0, sz * (H / 2 + 0.8)),
      // Heads of players standing on the far and near lines.
      new THREE.Vector3(sx * (W / 2 + 0.5), 2.4, sz * (H / 2 + 0.8)),
    ]));
    const place = (d: number) => {
      camera.position.copy(look).addScaledVector(view, d);
      camera.lookAt(look);
      camera.updateMatrixWorld();
    };
    // Keep clear of the buttons at the top.
    const fits = () => mustSee.every(p => {
      this.projected.copy(p).project(camera);
      return Math.abs(this.projected.x) <= 0.96 && this.projected.y <= 0.8 && this.projected.y >= -0.96;
    });
    let near = 5;
    let far = 250;
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      place(mid);
      if (fits()) far = mid;
      else near = mid;
    }
    place(far);
    this.broadcast.pos.copy(camera.position);
    this.billboard.place(camera);
    this.broadcast.look.copy(look);
    // Lower and close, the centre circle filling the screen.
    const closeView = new THREE.Vector3(0, 0.55, 1).normalize();
    this.closeUp.pos.copy(this.closeUp.look).addScaledVector(closeView, 9 * Math.max(1, 1.5 / camera.aspect));
    this.frame(this.toss ? this.zoom() : 1);
  }

  // How far the camera has pulled back from the close-up, 0 to 1.
  private zoom() {
    return this.toss ? smooth((this.toss.t - TOSS_OUT_START) / (TOSS_OUT_END - TOSS_OUT_START)) : 1;
  }

  private frame(out: number) {
    this.camera.position.lerpVectors(this.closeUp.pos, this.broadcast.pos, out);
    this.camera.lookAt(this.projected.lerpVectors(this.closeUp.look, this.broadcast.look, out));
    this.camera.updateMatrixWorld();
  }

  private footballer(id: string, team: Team) {
    let entry = this.footballers.get(id);
    if (entry && entry.team !== team) {
      this.stickmen.remove(entry.f);
      entry = undefined;
    }
    if (!entry) {
      // The training ground's tackle dummy is grey, and keepers wear their own.
      const f = new Footballer({ color: id === DUMMY_ID ? DUMMY_KIT : KEEPER_KIT[id] ?? KIT[team] });
      f.group.scale.setScalar(0.975);
      this.stickmen.add(f);
      entry = { team, f };
      this.footballers.set(id, entry);
    }
    return entry.f;
  }

  play(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === 'kick') {
        this.footballers.get(e.player)?.f.kick(e.power);
        this.kicks.set(e.player, e.power);
        const team = this.footballers.get(e.player)?.team;
        this.trail = team && e.power > TRAIL_FROM ? { team, left: 0.5 + e.power * 0.7, dist: 0, power: e.power } : null;
      } else if (e.type === 'steal') {
        this.steals.add(e.player);
      } else if (e.type === 'goal') {
        // The banner itself is ui/match-ui.ts's.
        this.goalSplash();
      } else if (e.type === 'coin') {
        this.tossCoin(e.team);
      }
    }
  }

  /** Lets go of the GPU now, rather than whenever the browser gets round
   *  to it: on leaving the page, and on every reload while developing. */
  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** Shows or hides the training ground's markings. */
  setTraining(on: boolean) {
    if (on && !this.training) {
      this.training = buildTraining();
      this.scene.add(this.training);
    }
    if (this.training) this.training.visible = on;
    // No score to keep.
    this.billboard.group.visible = !on;
  }

  private drawReach(reach?: { x: number; y: number; r: number }) {
    if (reach && !this.reachRing) {
      this.reachRing = buildReachRing();
      this.scene.add(this.reachRing.ring, this.reachRing.label);
    }
    if (!this.reachRing) return;
    const { ring, label } = this.reachRing;
    ring.visible = label.visible = !!reach;
    if (reach) {
      ring.position.set(reach.x, ring.position.y, reach.y);
      ring.scale.set(reach.r, reach.r, 1);
      // Just below the ring, on the near side.
      label.position.set(reach.x, label.position.y, reach.y + reach.r + 0.5);
    }
  }

  private drawProps(props: { x: number; y: number }[] = []) {
    while (this.props.length < props.length) {
      const ball = createBall();
      this.scene.add(ball);
      this.props.push(ball);
    }
    this.props.forEach((ball, i) => {
      const p = props[i];
      ball.visible = !!p;
      if (p) ball.position.set(p.x, CONFIG.ball.radius, p.y);
    });
  }

  // me: whose ring and gauges to show, if anyone's. names: shown over heads.
  render(state: ViewState, dt: number, now: number, me: string | null, names?: Map<string, string>) {
    const toss = this.toss;
    if (toss) {
      toss.t += dt;
      // One captain a side: whoever stands nearest the spot.
      toss.captains ??= new Map(
        (['gold', 'red'] as const).flatMap(team => {
          const mine = state.players.filter(p => p.team === team);
          mine.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
          return mine[0] ? [[mine[0].id, team] as const] : [];
        }),
      );
      if (toss.t > CONFIG.coinTime) this.toss = null;
    }
    const out = this.zoom();
    this.frame(out);

    const seen = new Set<string>();
    for (const p of state.players) {
      seen.add(p.id);
      const f = this.footballer(p.id, p.team);
      let { x, y } = p;
      let heading = Math.atan2(p.fx, p.fy);
      let speed = Math.hypot(p.vx, p.vy);
      const captain = toss?.captains?.get(p.id);
      if (captain) {
        // From facing the referee to their kickoff place, jogging there.
        const spot = TOSS_SPOT[captain];
        x = lerp(spot.x, p.x, out);
        y = lerp(spot.y, p.y, out);
        const was = this.last.get(p.id) ?? { x, y };
        const dx = x - was.x;
        const dy = y - was.y;
        speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
        heading = speed > 0.3 ? Math.atan2(dx, dy) : Math.atan2(REF_SPOT.x - x, REF_SPOT.y - y);
        if (out >= 1) heading = Math.atan2(p.fx, p.fy);
      }
      const drawnAt = this.last.get(p.id);
      if (drawnAt) Object.assign(drawnAt, { x, y });
      else this.last.set(p.id, { x, y });
      this.kickUp(p, x, y, speed, heading, dt, state, f.skid);
      f.group.position.set(x, 0, y);
      f.update(dt, {
        speed,
        heading,
        ...(captain ? {} : { vx: p.vx, vz: p.vy }),
        action: p.action,
        actionT: p.actionT,
        charge: p.charge,
        tired: p.tired > 0,
        stumble: p.stumble,
      });
    }
    this.drawReferee(dt, out);
    this.stickmen.flush();
    this.ballSplashes(state, dt);
    this.splashes.update(dt);
    for (const [id, { f }] of this.footballers) {
      if (seen.has(id)) continue;
      this.stickmen.remove(f);
      this.footballers.delete(id);
    }

    rollBall(this.ball, state.ballX - this.ball.position.x, state.ballY - this.ball.position.z);
    this.ball.position.set(state.ballX, CONFIG.ball.radius, state.ballY);
    this.drawProps(state.props);
    this.drawReach(state.reach);

    const mine = state.players.find(p => p.id === me);
    this.gauges.group.visible = !!mine;
    if (mine) {
      // Where it's drawn, which during the toss isn't where the sim has it.
      const at = this.last.get(mine.id) ?? mine;
      this.gauges.group.position.set(at.x, this.gauges.group.position.y, at.y);
      this.gauges.update(dt, now / 1000, mine.stamina, mine.tired, mine.action === 'charge', mine.charge);
    }

    this.billboard.setScore(state.score);
    this.infoBoards.set(state.info);
    this.drawLabels(state, names);
    this.watercolor.render(this.scene, this.camera, now / 1000);
  }

  // Droplets thrown up by one player this frame: a few at each footstep
  // (more when sprinting), a spray while sliding, a burst when they kick.
  private kickUp(p: PlayerView, x: number, y: number, speed: number, heading: number, dt: number, state: ViewState, skid: number) {
    let st = this.strides.get(p.id);
    if (!st) {
      st = { dist: 0, foot: 1, spray: 0 };
      this.strides.set(p.id, st);
    }
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    // Footsteps: a small splash of paint at each, like a kick's in
    // miniature: a blot soaking into the grass under the foot and a few
    // drops flicked back off it, all colours. Closer together, bigger and
    // livelier the faster the run.
    const step = p.sprinting ? SPRINT_STEP : STEP;
    st.dist = Math.min(step * 2, st.dist + speed * dt);
    if (speed > 1.2 && st.dist >= step) {
      st.dist -= step;
      st.foot = -st.foot;
      const pace = Math.min(1, speed / CONFIG.player.sprintSpeed);
      // Beside the planted foot, a little behind.
      const sx = x + fz * 0.12 * st.foot - fx * 0.1;
      const sz = y - fx * 0.12 * st.foot - fz * 0.1;
      this.splashes.burst({
        x: sx, z: sz, dx: -fx, dz: -fz, count: 1, speed: 0, size: 0.14 + pace * 0.08,
        colors: BRIGHT, spread: 0, life: 1 + pace * 0.6, alpha: 0.5, stain: true,
      });
      this.splashes.burst({
        x: sx, z: sz, dx: -fx, dz: -fz,
        count: Math.round(3 + pace * 3), speed: 1.4 + pace * 1.8, size: 0.06 + pace * 0.04,
        colors: BRIGHT, spread: 1.8, life: 0.5, alpha: 0.9,
      });
    }
    if (p.action === 'slide') {
      st.spray += dt;
      while (st.spray > 0.04) {
        st.spray -= 0.04;
        this.splashes.burst({
          x: x + fx * 0.5, z: y + fz * 0.5, dx: fx, dz: fz,
          count: 4, speed: 3.4, size: 0.12, colors: SCUFF[p.team], spread: 2.6, life: 0.7,
        });
      }
    } else if (skid > 0.3 && speed > 1) {
      // A skid scuffs up grass and a little ink, thrown on the way it's going.
      st.spray += dt;
      while (st.spray > 0.035) {
        st.spray -= 0.035;
        this.splashes.burst({
          x, z: y, dx: p.vx, dz: p.vy,
          count: 3, speed: 1 + speed * 0.35, size: 0.1, colors: SCUFF[p.team], spread: 1.8, life: 0.6,
        });
      }
    } else {
      st.spray = 0;
    }
    const power = this.kicks.get(p.id);
    if (power !== undefined) {
      this.kicks.delete(p.id);
      const ink = INK[p.team];
      // A fan of ink thrown ahead with the ball, more and further the
      // harder the kick...
      this.splashes.burst({
        x: state.ballX, z: state.ballY, dx: fx, dz: fz,
        count: Math.round(14 + power * 30), speed: 3 + power * 7, size: 0.11 + power * 0.1,
        colors: [...ink, 0xffffff], spread: 1.1 + power * 0.5, life: 0.8, alpha: 0.9,
      });
      // ...a few drops flicked back off the boot...
      this.splashes.burst({
        x: state.ballX, z: state.ballY, dx: -fx, dz: -fz,
        count: Math.round(4 + power * 6), speed: 2 + power * 2, size: 0.09, colors: ink, spread: 2.2, life: 0.6,
      });
      // ...and where the boot met the ball, a blot that soaks into the grass.
      const blot = 0.35 + power * 0.55;
      const stain = (x: number, z: number, size: number) =>
        this.splashes.burst({ x, z, dx: fx, dz: fz, count: 1, speed: 0, size, colors: ink, spread: 0, life: 2.5 + power * 2, alpha: 0.6, stain: true });
      stain(state.ballX, state.ballY, blot);
      if (power > 0.3) {
        stain(state.ballX + fx * blot * 0.9, state.ballY + fz * blot * 0.9, blot * 0.6);
        this.splashes.burst({
          x: state.ballX, z: state.ballY, dx: fx, dz: fz, count: Math.round(power * 8), speed: 4 + power * 4, size: 0.14,
          colors: ink, spread: 1.4, life: 2.5 + power * 2, alpha: 0.5, stain: true,
        });
      }
    }
    // A tackle won: a flick of the winner's ink off the ball, a splash of
    // it after a slide.
    if (this.steals.delete(p.id)) {
      const slide = p.action === 'slide';
      this.splashes.burst({
        x: state.ballX, z: state.ballY, dx: fx, dz: fz, count: slide ? 22 : 10, speed: slide ? 5 : 3, size: slide ? 0.14 : 0.1,
        colors: [...INK[p.team], 0xffffff], spread: 2.6, life: 0.8, alpha: 0.9,
      });
      this.splashes.burst({
        x: state.ballX, z: state.ballY, dx: fx, dz: fz, count: 1, speed: 0, size: slide ? 0.7 : 0.4,
        colors: INK[p.team], spread: 0, life: 3, alpha: 0.55, stain: true,
      });
    }
  }

  // A goal throws every bright paint at once out of the goal mouth: big
  // overlapping blots in the net and across the box, a spray of smaller
  // ones over the pitch, and droplets in the air. It lingers a while.
  private goalSplash() {
    const side = Math.sign(this.lastBall.x) || 1;
    const x = side * (CONFIG.pitch.width / 2 - 0.3);
    const z = Math.max(-2, Math.min(2, this.lastBall.y));
    const pick = () => BRIGHT[Math.floor(Math.random() * BRIGHT.length)]!;
    const stain = (sx: number, sz: number, size: number, life: number) =>
      this.splashes.burst({ x: sx, z: sz, dx: -side, dz: 0, count: 1, speed: 0, size, colors: [pick()], spread: 0, life, alpha: 0.6, stain: true });
    for (let i = 0; i < 14; i++) {
      // Fanned out from the mouth towards the pitch.
      const a = (Math.random() - 0.5) * 2.6;
      const d = Math.sqrt(Math.random()) * 5;
      stain(x - side * Math.cos(a) * d, z + Math.sin(a) * d * 1.3, 1 + Math.random() * 1.3, 7);
    }
    // And the inside of the goal, back to the net.
    const { goalWidth, goalDepth } = CONFIG.pitch;
    for (let i = 0; i < 7; i++) {
      const depth = 0.2 + Math.random() * (goalDepth - 0.4);
      const across = (Math.random() - 0.5) * (goalWidth - 0.6);
      stain(side * (CONFIG.pitch.width / 2 + depth), across, 0.7 + Math.random() * 0.6, 7);
    }
    this.splashes.burst({
      x, z, dx: side, dz: 0, count: 12, speed: 9, size: 0.2,
      colors: BRIGHT, spread: 2.2, life: 6, alpha: 0.55, stain: true,
    });
    for (const colours of [BRIGHT, BRIGHT, [0xffffff, ...BRIGHT]]) {
      this.splashes.burst({
        x, z, dx: -side, dz: 0, count: 22, speed: 20, size: 0.26,
        colors: colours, spread: 3.2, life: 6, alpha: 0.55, stain: true,
      });
    }
    this.splashes.burst({
      x, z, dx: -side, dz: 0, count: 60, speed: 14, size: 0.16,
      colors: [...BRIGHT, 0xffffff], spread: 3.6, life: 1.8, alpha: 0.9,
    });
  }

  // A ball going quickly cuts green spray off the turf either side; one
  // bouncing off a wall or post throws a random paint, which stains the
  // grass for a few seconds.
  private ballSplashes(state: ViewState, dt: number) {
    const b = this.lastBall;
    if (dt <= 0) return;
    const vx = (state.ballX - b.x) / dt;
    const vy = (state.ballY - b.y) / dt;
    const speed = Math.hypot(vx, vy);
    // A jump that size is a kickoff reset, not movement.
    if (speed > 60) {
      Object.assign(b, { x: state.ballX, y: state.ballY, vx: 0, vy: 0, roll: 0 });
      return;
    }
    if (speed > 7) {
      b.roll += speed * dt;
      if (b.roll > 0.6) {
        b.roll = 0;
        for (const side of [-1, 1]) {
          this.splashes.burst({
            x: state.ballX, z: state.ballY, dx: (-vy / speed) * side - (vx / speed) * 0.4, dz: (vx / speed) * side - (vy / speed) * 0.4,
            count: 2, speed: 1.6, size: 0.09, colors: TURF_DROPS, spread: 0.9, life: 0.6,
          });
        }
      }
    }
    // A hard kick's ink trail: spots left behind the ball for a moment,
    // bending with any curl, smaller as it goes.
    const tr = this.trail;
    if (tr) {
      tr.left -= dt;
      tr.dist += speed * dt;
      if (tr.left <= 0 || speed < 5) {
        this.trail = null;
      } else if (tr.dist >= TRAIL_GAP) {
        tr.dist = 0;
        const size = (0.16 + tr.power * 0.22) * Math.min(1, tr.left * 1.6);
        this.splashes.burst({
          x: state.ballX, z: state.ballY, dx: -vx, dz: -vy, count: 1, speed: 0, size,
          colors: INK[tr.team], spread: 0, life: 1.6 + tr.power, alpha: 0.6, stain: true,
        });
        // A droplet or two either side.
        this.splashes.burst({
          x: state.ballX, z: state.ballY, dx: -vx, dz: -vy, count: 2, speed: 1.5, size: size * 0.4,
          colors: INK[tr.team], spread: 3, life: 1.2 + tr.power, alpha: 0.5, stain: true,
        });
      }
    }
    // Off a wall: the ball's run along one axis flips, near the pitch edge.
    const { width, height } = CONFIG.pitch;
    const flippedX = b.vx * vx < 0 && Math.abs(b.vx) > 3 && Math.abs(state.ballX) > width / 2 - 1;
    const flippedY = b.vy * vy < 0 && Math.abs(b.vy) > 3 && Math.abs(state.ballY) > height / 2 - 1;
    if (flippedX || flippedY) {
      const paint = PAINTS[Math.floor(Math.random() * PAINTS.length)]!;
      const hit = Math.hypot(b.vx, b.vy);
      // Out from the wall it hit (both, in a corner).
      let nx = flippedX ? Math.sign(state.ballX) : 0;
      let nz = flippedY ? Math.sign(state.ballY) : 0;
      const nl = Math.hypot(nx, nz);
      nx /= nl;
      nz /= nl;
      // Centred just over the line, so the splash spreads out past it and a
      // little way back in.
      const reach = CONFIG.ball.radius + 0.2;
      const cx = state.ballX + nx * reach;
      const cz = state.ballY + nz * reach;
      // Bigger the harder it hits: a tap leaves a dab, a shot a pool.
      const big = Math.min(1.5, Math.max(0, hit - 3) * 0.07);
      const stain = (x: number, z: number, size: number, life: number) =>
        this.splashes.burst({ x, z, dx: nx, dz: nz, count: 1, speed: 0, size, colors: [paint], spread: 0, life, alpha: 0.55, stain: true });
      // The main splash: two overlapping blots, the larger pushed outwards.
      stain(cx, cz, 0.9 + big, 5);
      stain(cx + nx * 0.45, cz + nz * 0.45, 0.6 + big * 0.6, 5);
      // Secondary splashes, most thrown outwards, a few back onto the pitch.
      this.splashes.burst({
        x: cx, z: cz, dx: nx, dz: nz, count: Math.round(8 + big * 10), speed: 6 + big * 4, size: 0.15 + big * 0.06,
        colors: [paint], spread: 2.8, life: 4.5, alpha: 0.5, stain: true,
      });
      this.splashes.burst({
        x: cx, z: cz, dx: -nx, dz: -nz, count: 4, speed: 4, size: 0.13,
        colors: [paint], spread: 2.2, life: 4, alpha: 0.45, stain: true,
      });
      // Droplets in the air, settling as they go.
      this.splashes.burst({
        x: cx, z: cz, dx: nx, dz: nz, count: Math.round(14 + big * 16), speed: 5 + big * 3, size: 0.12,
        colors: [paint, 0xffffff], spread: 3, life: 1.4, alpha: 0.85,
      });
    }
    Object.assign(b, { x: state.ballX, y: state.ballY, vx, vy });
  }

  // Facing the camera behind the ball for the toss, arm up as the coin
  // goes, then jogging off over the far touchline.
  private drawReferee(dt: number, out: number) {
    const ref = this.referee;
    ref.group.visible = !!this.toss;
    if (!this.toss) return;
    const t = this.toss.t;
    const leaving = out > 0;
    const x = lerp(REF_SPOT.x, REF_EXIT.x, out);
    const y = lerp(REF_SPOT.y, REF_EXIT.y, out);
    const was = ref.group.position;
    const speed = dt > 0 ? Math.hypot(x - was.x, y - was.z) / dt : 0;
    ref.group.position.set(x, 0, y);
    ref.update(dt, {
      speed: leaving ? speed : 0,
      heading: leaving ? Math.PI : 0,
      action: 'none',
      actionT: 0,
      charge: 0,
      tired: false,
      armUp: smooth(t / 0.15) * (1 - smooth((t - 0.5) / 0.3)),
    });
  }

  private drawLabels(state: ViewState, names?: Map<string, string>) {
    const shown = new Set<string>();
    if (names) {
      for (const p of state.players) {
        const name = names.get(p.id);
        if (!name) continue;
        shown.add(p.id);
        let el = this.labels.get(p.id);
        if (!el) {
          el = document.createElement('span');
          el.className = 'label';
          this.labelLayer.append(el);
          this.labels.set(p.id, el);
        }
        // Only what's changed touches the page.
        if (el.textContent !== name) el.textContent = name;
        if (el.dataset.team !== p.team) el.dataset.team = p.team;
        const at = this.last.get(p.id) ?? p;
        this.projected.set(at.x, 2.1, at.y).project(this.camera);
        const x = Math.round((this.projected.x + 1) * 5000) / 100;
        const y = Math.round((1 - this.projected.y) * 5000) / 100;
        const key = `${x},${y}`;
        if (el.dataset.at !== key) {
          el.dataset.at = key;
          el.style.transform = `translate(${x}vw, ${y}vh) translate(-50%, -100%)`;
        }
      }
    }
    for (const [id, el] of this.labels) {
      if (shown.has(id)) continue;
      el.remove();
      this.labels.delete(id);
    }
  }

  // Spins the coin and lands it on the team that kicks off. Restarting the
  // element restarts its animations.
  private tossCoin(team: Team) {
    const toss = document.getElementById('coin-toss')!;
    const coin = document.getElementById('coin')!;
    const text = document.getElementById('coin-text')!;
    coin.style.setProperty('--end', `${team === 'gold' ? 1800 : 1980}deg`);
    text.textContent = `${TEAM_NAME[team]} kicks off!`;
    text.className = `coin-text ${team}`;
    toss.hidden = true;
    void toss.offsetWidth;
    toss.hidden = false;
    this.toss = { t: 0, captains: null };
    clearTimeout(this.coinTimer);
    this.coinTimer = setTimeout(() => (toss.hidden = true), CONFIG.coinTime * 1000);
  }

  /** A new match or mode: the coin toss, splashes, kick trail and the rest
   *  of the last one's effects cleared away. */
  clearEffects() {
    clearTimeout(this.coinTimer);
    document.getElementById('coin-toss')!.hidden = true;
    this.toss = null;
    this.splashes.clear();
    this.kicks.clear();
    this.steals.clear();
    this.trail = null;
  }
}
