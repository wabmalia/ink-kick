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

  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    // Tone mapping and the painted look both happen in this pass.
    this.watercolor = new Watercolor(this.renderer);
    buildStadium(this.scene);
    this.scene.add(this.ball, this.gauges.group);
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
      }
    }
  }

  // me: whose ring and gauges to show, if anyone's. names: shown over heads.
  render(state: ViewState, dt: number, now: number, me: string | null, names?: Map<string, string>) {
    const seen = new Set<string>();
    for (const p of state.players) {
      seen.add(p.id);
      const f = this.footballer(p.id, p.team);
      f.group.position.set(p.x, 0, p.y);
      f.update(dt, {
        speed: Math.hypot(p.vx, p.vy),
        heading: Math.atan2(p.fx, p.fy),
        action: p.action,
        actionT: p.actionT,
        charge: p.charge,
        tired: p.tired > 0,
      });
    }
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
      this.gauges.group.position.set(mine.x, this.gauges.group.position.y, mine.y);
      this.gauges.update(dt, now / 1000, mine.stamina, mine.tired, mine.action === 'charge', mine.charge);
    }

    this.scoreEl.gold.textContent = String(state.score.gold);
    this.scoreEl.red.textContent = String(state.score.red);
    this.drawLabels(state, names);
    this.watercolor.render(this.scene, this.camera, now / 1000);
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
        this.projected.set(p.x, 2.1, p.y).project(this.camera);
        el.style.transform = `translate(${(this.projected.x + 1) * 50}vw, ${(1 - this.projected.y) * 50}vh) translate(-50%, -100%)`;
      }
    }
    for (const [id, el] of this.labels) {
      if (shown.has(id)) continue;
      el.remove();
      this.labels.delete(id);
    }
  }

  clearBanner() {
    this.banner.className = 'banner';
  }
}
