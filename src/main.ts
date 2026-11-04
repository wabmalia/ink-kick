import { CONFIG } from './config';
import { Bot } from './engine/ai';
import { createMatch, createPlayer, step } from './engine/sim';
import { loadAttributes } from './game/attributes';
import { enableKeys, keyboardInput } from './game/input';
import { LocalMatch, RemoteMatch, type ViewState } from './game/state';
import { GameView } from './game/view';
import { session } from './net/session';
import { iceServers } from './net/relay';
import { helpOpen, onHelp } from './ui/help';
import { inMatch, offerInvite, render } from './ui/menu';
import { paintMenu } from './ui/wash';
import { currentAttributes, mountLocker, onAttributes } from './ui/locker';
import { Training } from './game/training';
import { showTimes } from './ui/training-hud';
import './style.css';

// Picks what's on the pitch from the session: bots playing behind the menu,
// a solo game, a hosted match, or a guest's view of one.

const view = new GameView(document.getElementById('game')!);

type Mode =
  | { kind: 'attract'; local: LocalMatch }
  | { kind: 'solo'; local: LocalMatch }
  | { kind: 'training'; local: LocalMatch; training: Training }
  | { kind: 'host'; local: LocalMatch }
  | { kind: 'guest'; remote: RemoteMatch };

// Two bots a side, playing on behind the menu.
function attract(): Mode {
  const ids = ['g1', 'g2', 'r1', 'r2'];
  const match = createMatch(ids.map(id => createPlayer(id, id[0] === 'g' ? 'gold' : 'red')));
  const bots = ids.map(id => new Bot(id));
  return { kind: 'attract', local: new LocalMatch(match, () => step(match, Object.fromEntries(bots.map(b => [b.id, b.think(match)])))) };
}

function solo(): Mode {
  const kickoff = Math.random() < 0.5 ? 'gold' : 'red';
  const match = createMatch([createPlayer(session.me, 'gold', loadAttributes()), createPlayer('bot', 'red')], { kickoff, coin: true });
  const bot = new Bot('bot');
  return { kind: 'solo', local: new LocalMatch(match, () => step(match, { [session.me]: keyboardInput(), bot: bot.think(match) })) };
}

function training(): Mode {
  const t = new Training(session.me, currentAttributes());
  return { kind: 'training', training: t, local: new LocalMatch(t.match, () => t.step(keyboardInput())) };
}
onAttributes(attrs => {
  if (mode.kind === 'training') mode.training.setAttributes(attrs);
});

let mode: Mode = attract();

function pickMode() {
  const before = mode;
  const host = session.host;
  if (session.status === 'solo') {
    if (mode.kind !== 'solo') mode = solo();
  } else if (session.status === 'training') {
    if (mode.kind !== 'training') mode = training();
  } else if (inMatch() && host?.match) {
    if (mode.kind !== 'host' || mode.local.match !== host.match) {
      const match = host.match;
      mode = { kind: 'host', local: new LocalMatch(match, () => host.step(keyboardInput())) };
    }
  } else if (inMatch()) {
    if (mode.kind !== 'guest') mode = { kind: 'guest', remote: new RemoteMatch() };
  } else if (mode.kind !== 'attract') {
    mode = attract();
  }
  if (mode !== before) view.clearBanner();
  const trainingOn = mode.kind === 'training';
  view.setTraining(trainingOn);
  document.getElementById('train-panel')!.hidden = !trainingOn;
  document.getElementById('train-hud')!.hidden = !trainingOn;
  // Keys steer only in a match, and not while the help is up.
  enableKeys(inMatch() && !helpOpen());
}
onHelp(pickMode);

session.listen({
  change() {
    render();
    pickMode();
  },
  snap(snap) {
    if (mode.kind === 'guest') mode.remote.push(snap);
  },
  events(tick, events) {
    if (mode.kind === 'guest') mode.remote.pushEvents(tick, events);
  },
});

const EMPTY: ViewState = { players: [], ballX: 0, ballY: 0, score: { gold: 0, red: 0 } };
let last = performance.now();
let inputClock = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let state: ViewState;
  let me: string | null = null;
  let names: Map<string, string> | undefined;

  if (mode.kind === 'guest') {
    // Guests send their input at the sim's rate; the host steps with it.
    inputClock += dt;
    while (inputClock >= CONFIG.tick) {
      session.sendInput(keyboardInput());
      inputClock -= CONFIG.tick;
    }
    view.play(mode.remote.advance(dt));
    state = mode.remote.state() ?? EMPTY;
  } else {
    // A solo game waits while the help is open; anything with others can't.
    if (!((mode.kind === 'solo' || mode.kind === 'training') && helpOpen())) view.play(mode.local.advance(dt));
    state = mode.local.state();
    if (mode.kind === 'training') {
      state.props = mode.training.drawnProps();
      state.reach = mode.training.pokeReach();
      showTimes(mode.training.stats());
    }
  }
  if (mode.kind !== 'attract') me = session.me;
  if (session.room && mode.kind !== 'solo' && mode.kind !== 'attract') {
    names = new Map(session.room.members.map(m => [m.id, m.name]));
  }

  view.render(state, dt, now, me, names);
  requestAnimationFrame(frame);
}

// Get relay credentials ready in the background (only on the live site).
void iceServers();
session.restore();
const invite = session.invitedTo();
if (session.status === 'home' && invite) offerInvite(invite);
render();
pickMode();
mountLocker();
paintMenu();
requestAnimationFrame(frame);
