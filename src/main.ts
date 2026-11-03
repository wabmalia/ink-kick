import * as THREE from 'three';
import { CONFIG } from './config';
import { Bot } from './engine/ai';
import { createMatch, createPlayer, step, type Input } from './engine/sim';
import { createBall, rollBall } from './scene/ball';
import { Footballer } from './scene/footballer';
import { PlayerGauges } from './scene/gauges';
import { buildStadium } from './scene/stadium';
import { Watercolor } from './scene/watercolor';
import './style.css';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game')!.appendChild(renderer.domElement);
// Tone mapping and the painted look both happen in this pass.
const watercolor = new Watercolor(renderer);

const scene = new THREE.Scene();
buildStadium(scene);

// A fixed broadcast camera on the near side, pulled back just far enough
// that the four corners and both goals stay in view at any window shape.
const camera = new THREE.PerspectiveCamera(38, 1, 1, 300);
const LOOK = new THREE.Vector3(0, 0, 0.6);
const VIEW = new THREE.Vector3(0, 19.5, 21.5).normalize();
const { width: W, height: H, goalDepth } = CONFIG.pitch;
const MUST_SEE = [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [
  new THREE.Vector3(sx * (W / 2 + goalDepth + 0.6), 0, sz * (H / 2 + 0.8)),
  // Heads of players standing on the far and near lines.
  new THREE.Vector3(sx * (W / 2 + 0.5), 2.4, sz * (H / 2 + 0.8)),
]));
const projected = new THREE.Vector3();

function fits() {
  camera.updateMatrixWorld();
  // Keep clear of the scoreboard at the top.
  return MUST_SEE.every(p => {
    projected.copy(p).project(camera);
    return Math.abs(projected.x) <= 0.96 && projected.y <= 0.8 && projected.y >= -0.96;
  });
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  watercolor.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  let near = 5;
  let far = 250;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    camera.position.copy(LOOK).addScaledVector(VIEW, mid);
    camera.lookAt(LOOK);
    if (fits()) far = mid;
    else near = mid;
  }
  camera.position.copy(LOOK).addScaledVector(VIEW, far);
  camera.lookAt(LOOK);
}
window.addEventListener('resize', resize);
resize();

const match = createMatch([createPlayer('me', 'gold'), createPlayer('rival', 'red')]);
const bot = new Bot('rival');
const looks = {
  me: new Footballer({ color: 0xf2b134 }),
  rival: new Footballer({ color: 0xe2553f }),
} as Record<string, Footballer>;
for (const f of Object.values(looks)) {
  f.group.scale.setScalar(0.975);
  scene.add(f.group);
}
const ball = createBall();
scene.add(ball);

const gauges = new PlayerGauges();
scene.add(gauges.group);

// Keyboard: arrows or WASD to run, Shift to sprint, Space or X to kick.
const held = new Set<string>();
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyX', 'ShiftLeft', 'ShiftRight'];
window.addEventListener('keydown', e => {
  if (!KEYS.includes(e.code)) return;
  e.preventDefault();
  held.add(e.code);
});
window.addEventListener('keyup', e => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function myInput(): Input {
  const on = (...codes: string[]) => codes.some(c => held.has(c));
  return {
    x: (on('ArrowRight', 'KeyD') ? 1 : 0) - (on('ArrowLeft', 'KeyA') ? 1 : 0),
    // Up on screen is towards the far side, which is -y in the sim.
    y: (on('ArrowDown', 'KeyS') ? 1 : 0) - (on('ArrowUp', 'KeyW') ? 1 : 0),
    kick: on('Space', 'KeyX'),
    sprint: on('ShiftLeft', 'ShiftRight'),
  };
}

const scoreEl = { gold: document.getElementById('score-gold')!, red: document.getElementById('score-red')! };
const banner = document.getElementById('banner')!;

// Fixed-step sim; the scene draws between the last two steps.
let prev = snapshot();
let acc = 0;
let last = performance.now();

function snapshot() {
  return [...match.players.map(p => ({ x: p.x, y: p.y })), { x: match.ball.x, y: match.ball.y }];
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let kickedOff = false;
  while (acc >= CONFIG.tick) {
    prev = snapshot();
    for (const e of step(match, { me: myInput(), rival: bot.think(match) })) {
      if (e.type === 'kick') {
        looks[e.player]!.kick(e.power);
      } else if (e.type === 'goal') {
        scoreEl[e.team].textContent = String(match.score[e.team]);
        banner.textContent = 'GOAL!';
        banner.className = `banner show ${e.team}`;
      } else if (e.type === 'kickoff') {
        banner.className = 'banner';
        kickedOff = true;
      }
    }
    acc -= CONFIG.tick;
  }
  if (kickedOff) prev = snapshot();

  const t = acc / CONFIG.tick;
  const lerp = (i: number, axis: 'x' | 'y', now: number) => prev[i]![axis] + (now - prev[i]![axis]) * t;
  match.players.forEach((p, i) => {
    const f = looks[p.id]!;
    f.group.position.set(lerp(i, 'x', p.x), 0, lerp(i, 'y', p.y));
    f.update(dt, {
      speed: Math.hypot(p.vx, p.vy),
      heading: Math.atan2(p.fx, p.fy),
      action: p.action,
      actionT: p.actionT,
      charge: p.charge,
      tired: p.tired > 0,
    });
  });
  const bi = match.players.length;
  const bx = lerp(bi, 'x', match.ball.x);
  const bz = lerp(bi, 'y', match.ball.y);
  rollBall(ball, bx - ball.position.x, bz - ball.position.z);
  ball.position.set(bx, CONFIG.ball.radius, bz);

  // The ring and gauges follow the player you control.
  const me = match.players[0]!;
  const mine = looks.me!.group.position;
  gauges.group.position.x = mine.x;
  gauges.group.position.z = mine.z;
  gauges.update(dt, now / 1000, me.stamina, me.tired / CONFIG.stamina.tiredTime, me.action === 'charge', me.charge);

  watercolor.render(scene, camera, now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
