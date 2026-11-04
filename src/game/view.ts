import * as THREE from 'three';
import { CONFIG } from '../config';
import type { SimEvent, Team } from '../engine/sim';
import { createBall, rollBall } from '../scene/ball';
import { Footballer } from '../scene/footballer';
import { PlayerGauges } from '../scene/gauges';
import { buildStadium } from '../scene/stadium';
import { Watercolor } from '../scene/watercolor';
import type { ViewState } from './state';

// The painted stadium and everyone in it. Draws a ViewState each frame,
// whoever is running the match, and plays the events that come with it.

const KIT: Record<Team, number> = { gold: 0xf2b134, red: 0xe2553f };

// The coin toss, in seconds from the coin going up: the camera holds on the
// centre circle, then pulls back to the broadcast view while the captains
// jog to their places and the referee heads off.
const TOSS_OUT_START = 1.9;
const TOSS_OUT_END = CONFIG.coinTime - 0.1;
// Where the captains face the referee, who stands behind the ball.
const TOSS_SPOT: Record<Team, { x: number; y: number }> = { gold: { x: -1.5, y: 0.3 }, red: { x: 1.5, y: 0.3 } };
const REF_SPOT = { x: 0, y: -1.1 };
const REF_EXIT = { x: 0, y: -(CONFIG.pitch.height / 2 + 2) };

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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
  private scoreEl: Record<Team, HTMLElement>;
  private banner: HTMLElement;
  private labelLayer: HTMLElement;
  private coinTimer: ReturnType<typeof setTimeout> | undefined;
  // The broadcast camera, and the close-up on the centre circle for the toss.
  private broadcast = { pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0, 0.6) };
  private closeUp = { pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0.6, 0) };
  private referee = new Footballer({ color: 0x2b2f3a });
  // While the toss plays: seconds since it began, and each team's captain
  // (picked on the first frame drawn).
  private toss: { t: number; captains: Map<string, Team> | null } | null = null;
  private last = new Map<string, { x: number; y: number }>();

  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    // Tone mapping and the painted look both happen in this pass.
    this.watercolor = new Watercolor(this.renderer);
    buildStadium(this.scene);
    this.scene.add(this.ball, this.gauges.group);
    this.referee.group.scale.setScalar(0.975);
    this.referee.group.visible = false;
    this.scene.add(this.referee.group);
    this.scoreEl = { gold: document.getElementById('score-gold')!, red: document.getElementById('score-red')! };
    this.banner = document.getElementById('banner')!;
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
    // Keep clear of the scoreboard at the top.
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
      this.scene.remove(entry.f.group);
      entry = undefined;
    }
    if (!entry) {
      const f = new Footballer({ color: KIT[team] });
      f.group.scale.setScalar(0.975);
      this.scene.add(f.group);
      entry = { team, f };
      this.footballers.set(id, entry);
    }
    return entry.f;
  }

  play(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === 'kick') {
        this.footballers.get(e.player)?.f.kick(e.power);
      } else if (e.type === 'goal') {
        this.banner.textContent = 'GOAL!';
        this.banner.className = `banner show ${e.team}`;
      } else if (e.type === 'kickoff') {
        this.banner.className = 'banner';
      } else if (e.type === 'coin') {
        this.tossCoin(e.team);
      }
    }
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
      this.last.set(p.id, { x, y });
      f.group.position.set(x, 0, y);
      f.update(dt, {
        speed,
        heading,
        action: p.action,
        actionT: p.actionT,
        charge: p.charge,
        tired: p.tired > 0,
      });
    }
    this.drawReferee(dt, out);
    for (const [id, { f }] of this.footballers) {
      if (seen.has(id)) continue;
      this.scene.remove(f.group);
      this.footballers.delete(id);
    }

    rollBall(this.ball, state.ballX - this.ball.position.x, state.ballY - this.ball.position.z);
    this.ball.position.set(state.ballX, CONFIG.ball.radius, state.ballY);

    const mine = state.players.find(p => p.id === me);
    this.gauges.group.visible = !!mine;
    if (mine) {
      // Where it's drawn, which during the toss isn't where the sim has it.
      const at = this.last.get(mine.id) ?? mine;
      this.gauges.group.position.set(at.x, this.gauges.group.position.y, at.y);
      this.gauges.update(dt, now / 1000, mine.stamina, mine.tired, mine.action === 'charge', mine.charge);
    }

    this.scoreEl.gold.textContent = String(state.score.gold);
    this.scoreEl.red.textContent = String(state.score.red);
    this.drawLabels(state, names);
    this.watercolor.render(this.scene, this.camera, now / 1000);
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
        el.textContent = name;
        el.dataset.team = p.team;
        const at = this.last.get(p.id) ?? p;
        this.projected.set(at.x, 2.1, at.y).project(this.camera);
        el.style.transform = `translate(${(this.projected.x + 1) * 50}vw, ${(1 - this.projected.y) * 50}vh) translate(-50%, -100%)`;
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
    text.textContent = `${team === 'gold' ? 'Gold' : 'Red'} kicks off!`;
    text.className = `coin-text ${team}`;
    toss.hidden = true;
    void toss.offsetWidth;
    toss.hidden = false;
    this.toss = { t: 0, captains: null };
    clearTimeout(this.coinTimer);
    this.coinTimer = setTimeout(() => (toss.hidden = true), CONFIG.coinTime * 1000);
  }

  clearBanner() {
    this.banner.className = 'banner';
    clearTimeout(this.coinTimer);
    document.getElementById('coin-toss')!.hidden = true;
    this.toss = null;
  }
}
