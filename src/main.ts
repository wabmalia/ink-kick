// First, so the old saved settings are in place before anything reads them.
import './rename';
import { CONFIG } from './config';
import { Bot } from './engine/ai';
import { createMatch, createPlayer, KEEPER_IDS, step } from './engine/sim';
import { loadAttributes } from './game/attributes';
import { enableKeys, keyboardInput } from './game/input';
import { LocalMatch, RemoteMatch, type ViewState } from './game/state';
import { GameView } from './game/view';
import { session } from './net/session';
import { iceServers } from './net/relay';
import { helpOpen, onHelp } from './ui/help';

// The help, or what the attributes do: either one pauses a game played alone
// and takes the keys.
const attrInfo = document.getElementById('attr-info') as HTMLDialogElement;
const dialogOpen = () => helpOpen() || attrInfo.open;
import { inMatch, offerInvite, render, settingUp } from './ui/menu';
import { paintMenu } from './ui/wash';
import { currentAttributes, mountLocker, onAttributes } from './ui/locker';
import { Training } from './game/training';
import { showTimes } from './ui/training-hud';
import { matchEvents, resetMatchUi, type NameOf, type Role } from './ui/match-ui';
import { rulesLine, rulesName } from './game/rules';
import type { SimEvent } from './engine/sim';
import './style.css';

// Picks what's on the pitch from the session: bots playing behind the menu,
// a solo game, a hosted match, or a guest's view of one.

const view = new GameView(document.getElementById('game')!);

type Mode =
  | { kind: 'attract'; local: LocalMatch }
  | { kind: 'solo'; local: LocalMatch; round: number }
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
  const match = createMatch([createPlayer(session.me, 'gold', loadAttributes()), createPlayer('bot', 'red')], {
    kickoff, coin: true, rules: session.soloRules, keepers: session.soloKeepers,
  });
  const bot = new Bot('bot');
  return {
    kind: 'solo', round: session.soloRound,
    local: new LocalMatch(match, () => step(match, { [session.me]: keyboardInput(), bot: bot.think(match) })),
  };
}

function training(): Mode {
  const t = new Training(session.me, currentAttributes());
  return { kind: 'training', training: t, local: new LocalMatch(t.match, () => t.step(keyboardInput())) };
}
onAttributes(attrs => {
  if (mode.kind === 'training') mode.training.setAttributes(attrs);
  session.setAttributes(attrs);
});

let mode: Mode = attract();

function pickMode() {
  const before = mode;
  const host = session.host;
  if (session.status === 'solo') {
    if (mode.kind !== 'solo' || mode.round !== session.soloRound) mode = solo();
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
  if (mode !== before) {
    view.clearBanner();
    resetMatchUi();
  }
  const trainingOn = mode.kind === 'training';
  view.setTraining(trainingOn);
  document.getElementById('train-panel')!.hidden = !trainingOn && !settingUp();
  document.getElementById('train-hud')!.hidden = !trainingOn;
  // Keys steer only in a match, and not while the help is up.
  enableKeys(inMatch() && !dialogOpen());
}
onHelp(pickMode);
attrInfo.addEventListener('close', pickMode);

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

// Who scored, by name: the bot, you, or whoever's in the room.
const nameOf: NameOf = id => {
  if (id === KEEPER_IDS.gold) return 'Gold keeper';
  if (id === KEEPER_IDS.red) return 'Red keeper';
  if (mode.kind === 'solo') return id === 'bot' ? 'The bot' : session.name || 'You';
  return session.room?.members.find(m => m.id === id)?.name ?? null;
};

const EMPTY: ViewState = { players: [], ballX: 0, ballY: 0, score: { gold: 0, red: 0 } };
let last = performance.now();
let inputClock = 0;
// Frames drawn less often when nobody needs 60 a second: the menu, with the
// bots playing on behind it, at 30; and anything at 5 while the window isn't
// focused (in another app, say). The game itself still runs every frame, so
// a host keeps the match going. A hidden tab draws nothing at all: the
// browser stops animation frames.
const MENU_FRAME = 1 / 30;
const UNFOCUSED_FRAME = 1 / 5;
let undrawn = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let state: ViewState;
  let me: string | null = null;
  let played: SimEvent[] = [];
  let names: Map<string, string> | undefined;

  if (mode.kind === 'guest') {
    // Guests send their input at the sim's rate; the host steps with it.
    inputClock += dt;
    while (inputClock >= CONFIG.tick) {
      session.sendInput(keyboardInput());
      inputClock -= CONFIG.tick;
    }
    played = mode.remote.advance(dt);
    state = mode.remote.state() ?? EMPTY;
  } else {
    // A solo game waits while the help is open; anything with others can't.
    if (!((mode.kind === 'solo' || mode.kind === 'training') && dialogOpen())) played = mode.local.advance(dt);
    state = mode.local.state();
    if (mode.kind === 'training') {
      state.props = mode.training.drawnProps();
      state.reach = mode.training.pokeReach();
      showTimes(mode.training.stats());
    }
  }
  view.play(played);
  if (mode.kind === 'solo' || mode.kind === 'host' || mode.kind === 'guest') {
    matchEvents(played, nameOf, mode.kind);
    const rules = mode.kind === 'guest' ? session.room?.rules : mode.local.match.rules;
    if (rules && rules.kind !== 'endless') state.info = [rulesName(rules), rulesLine(rules, state.clock ?? 0, state.score)];
  }
  if (mode.kind !== 'attract') me = session.me;
  if (session.room && mode.kind !== 'solo' && mode.kind !== 'attract') {
    names = new Map(session.room.members.map(m => [m.id, m.name]));
  }

  undrawn += dt;
  const every = !document.hasFocus() ? UNFOCUSED_FRAME : mode.kind === 'attract' ? MENU_FRAME : 0;
  // A little slack, so 30 a second on a 60 Hz screen is every other frame.
  if (undrawn >= every - 0.004) {
    view.render(state, Math.min(0.25, undrawn), now, me, names);
    undrawn = 0;
  }
  requestAnimationFrame(frame);
}

// Let go of the GPU when the page goes: leaving, closing, or reloading after
// a change while developing.
window.addEventListener('pagehide', () => view.dispose());
// Back from the browser's back-forward cache, the GPU's already gone: start
// afresh.
window.addEventListener('pageshow', e => {
  if (e.persisted) location.reload();
});

// Get relay credentials ready in the background (only on the live site).
void iceServers();
session.restore();
const invite = session.invitedTo();
if (session.status === 'home' && invite) offerInvite(invite);
// A join link opened in a tab that already has the game: the browser only
// changes the hash, without reloading, so offer the room now. From solo or
// training, back to the menu first; never out of a room or a match with
// others, which a click on a link shouldn't end.
window.addEventListener('hashchange', () => {
  const code = session.invitedTo();
  if (!code) return;
  if (session.status === 'solo' || session.status === 'training' || session.status === 'error') {
    session.leave();
    location.hash = `#/join/${code}`;
    return;
  }
  if (session.status === 'home') offerInvite(code);
});
render();
pickMode();
mountLocker();
// After the locker's own handler has opened it.
for (const b of document.querySelectorAll('[data-attr-info]')) b.addEventListener('click', pickMode);
paintMenu();
requestAnimationFrame(frame);
