import type { Team } from '../engine/sim';
import { normalizeCode, type MemberView } from '../net/protocol';
import { session } from '../net/session';
import { helpOpen } from './help';

// The screens over the stadium: home, connecting, error and the lobby, and
// the buttons shown during a match. Everything is drawn from the session.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const screens = {
  home: $('home'),
  connecting: $('connecting'),
  error: $('error'),
  lobby: $('lobby'),
};
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
  return session.status === 'solo' || (session.status === 'room' && session.room?.phase === 'match');
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
  $('scoreboard').hidden = !playing;
  $('ingame').hidden = !playing;

  if (playing) {
    show(null);
    const solo = session.status === 'solo';
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

$('play-solo').addEventListener('click', () => session.playSolo());
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

// Esc leaves a solo game (when it isn't closing the help dialog).
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && session.status === 'solo' && !helpOpen()) session.leave();
});
