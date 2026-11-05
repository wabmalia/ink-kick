import type { Rules, Team } from '../engine/sim';
import { RULE_OPTIONS, ruleId } from '../game/rules';
import { normalizeCode, type MemberView } from '../net/protocol';
import { session } from '../net/session';
import { helpOpen } from './help';

// The screens over the stadium: home, solo setup, connecting, error and the
// lobby, and the buttons shown during a match. Everything is drawn from the
// session, except whether solo setup is open.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const screens = {
  home: $('home'),
  connecting: $('connecting'),
  error: $('error'),
  lobby: $('lobby'),
  soloSetup: $('solo-setup'),
};
// On the home screen: whether Play solo has been pressed, showing the match
// lengths and Kick off.
let soloSetup = false;

// A row of match lengths to pick from. disabled: a guest, who sees the host's
// choice but can't change it.
function rulesPicker(host: HTMLElement, pick: (rules: Rules) => void) {
  const buttons = RULE_OPTIONS.map(o => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rule';
    b.textContent = o.label;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => pick(o.rules));
    host.append(b);
    return { b, id: o.id };
  });
  return (rules: Rules, disabled = false) => {
    const chosen = ruleId(rules);
    for (const { b, id } of buttons) {
      b.setAttribute('aria-checked', String(id === chosen));
      b.disabled = disabled;
    }
  };
}
const showSoloRules = rulesPicker($('solo-rules'), rules => {
  session.soloRules = rules;
  showSoloRules(rules);
});
const showLobbyRules = rulesPicker($('lobby-rules'), rules => session.setRules(rules));
const nameInput = $<HTMLInputElement>('name');
const codeInput = $<HTMLInputElement>('code');
const toastEl = $('toast');

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
}

/** True while a match is on screen: no menu, keys steer the player. */
export function inMatch() {
  return session.status === 'solo' || session.status === 'training' || (session.status === 'room' && session.room?.phase === 'match');
}

function show(screen: keyof typeof screens | null) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== screen;
  $('menu').hidden = screen === null;
}

function renderLobby() {
  const room = session.room!;
  $('lobby-code').textContent = room.code;
  const mine = room.members.find(m => m.id === session.me);
  for (const team of ['gold', 'red'] as const) {
    const list = $(`team-${team}`);
    list.replaceChildren(...room.members.filter(m => m.team === team).map(memberItem));
    const button = document.querySelector<HTMLButtonElement>(`[data-team="${team}"]`)!;
    button.disabled = mine?.team === team;
    button.textContent = mine?.team === team ? `You're on ${team === 'gold' ? 'Gold' : 'Red'}` : `Play for ${team === 'gold' ? 'Gold' : 'Red'}`;
  }
  $('kickoff').hidden = !session.isHost;
  $('waiting').hidden = session.isHost;
  showLobbyRules(room.rules, !session.isHost);
  $('rules-note').textContent = session.isHost ? 'How the match is won.' : 'How the match is won. The host picks.';
}

function memberItem(m: MemberView) {
  const li = document.createElement('li');
  li.textContent = m.name;
  li.classList.toggle('me', m.id === session.me);
  li.classList.toggle('away', !m.connected);
  const tags = [m.id === session.room!.hostId ? 'host' : '', m.id === session.me ? 'you' : '', m.connected ? '' : 'away']
    .filter(Boolean);
  if (tags.length) {
    const small = document.createElement('small');
    small.textContent = `(${tags.join(', ')})`;
    li.append(small);
  }
  return li;
}

export function render() {
  const playing = inMatch();
  $('ingame').hidden = !playing;

  if (playing) {
    show(null);
    const solo = session.status === 'solo' || session.status === 'training';
    $('leave-match').textContent = solo ? 'Menu' : session.isHost ? 'Close room' : 'Leave';
    $('end-match').hidden = !session.isHost;
    $('room-tag').textContent = solo ? '' : `Room ${session.code}${session.linked ? '' : ' · reconnecting…'}`;
    return;
  }
  switch (session.status) {
    case 'connecting':
      $('connecting-msg').textContent = session.message;
      return show('connecting');
    case 'error':
      $('error-msg').textContent = session.message;
      return show('error');
    case 'room':
      renderLobby();
      return show('lobby');
    default:
      nameInput.value = session.name;
      if (soloSetup) {
        showSoloRules(session.soloRules);
        return show('soloSetup');
      }
      return show('home');
  }
}

// A join link opened fresh offers only that room.
export function offerInvite(code: string) {
  codeInput.value = code;
  $('solo-card').hidden = true;
  $('create-block').hidden = true;
  $('multi-title').textContent = `Join room ${code}`;
  $('multi-note').textContent = `You've been invited. Pick a nickname, then join.`;
  nameInput.focus();
}

function leaveInvite() {
  $('solo-card').hidden = false;
  $('create-block').hidden = false;
  $('multi-title').textContent = 'Multiplayer';
  $('multi-note').textContent = `Join a friend's room by its code, or host your own.`;
}

nameInput.addEventListener('change', () => session.setName(nameInput.value));
codeInput.addEventListener('input', () => (codeInput.value = normalizeCode(codeInput.value)));

$('play-solo').addEventListener('click', () => {
  session.setName(nameInput.value);
  soloSetup = true;
  render();
});
$('solo-back').addEventListener('click', () => {
  soloSetup = false;
  render();
});
$('solo-kickoff').addEventListener('click', () => {
  soloSetup = false;
  session.playSolo(session.soloRules);
});
$('train').addEventListener('click', () => {
  session.setName(nameInput.value);
  session.train();
});
$('create').addEventListener('click', () => {
  session.setName(nameInput.value);
  session.hostRoom();
});
$('join-form').addEventListener('submit', e => {
  e.preventDefault();
  const code = normalizeCode(codeInput.value);
  if (code.length !== 5) return toast('Room codes are 5 letters');
  session.setName(nameInput.value);
  leaveInvite();
  session.joinRoom(code);
});

for (const id of ['cancel', 'error-back', 'lobby-leave', 'leave-match']) {
  $(id).addEventListener('click', () => {
    leaveInvite();
    session.leave();
  });
}
$('end-match').addEventListener('click', () => session.end());
// The scoreboard at the end of a match.
$('play-again').addEventListener('click', () => session.playSolo());
$('scoreboard-menu').addEventListener('click', () => session.leave());
$('scoreboard-lobby').addEventListener('click', () => session.end());
$('kickoff').addEventListener('click', () => session.start());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-team]')) {
  button.addEventListener('click', () => session.setTeam(button.dataset.team as Team));
}
$('copy-link').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}#/join/${session.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch {
    toast(link);
  }
});

// Esc leaves a solo game or the training ground (when it isn't closing a
// dialog: the help, or what the attributes do).
window.addEventListener('keydown', e => {
  const dialogOpen = helpOpen() || !!document.querySelector('dialog[open]');
  if (e.key === 'Escape' && (session.status === 'solo' || session.status === 'training') && !dialogOpen) session.leave();
});
