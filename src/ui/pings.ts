import { pingLevel } from '../net/protocol';
import { session } from '../net/session';
import { $ } from './dom';

// Everyone's connection to the host, as a round trip in ms: next to each
// name in the lobby, and in a small list under the room tag in a match.
// Updated in place every second, without redrawing the lobby around it.

const panel = $('net-pings');

/** What to show for a player: the host is the reference, so it has no number. */
export function pingText(id: string): { text: string; level: string } {
  const room = session.room;
  if (id === room?.hostId) return { text: 'host', level: 'host' };
  const ms = session.pings[id];
  if (ms === undefined) return { text: '… ms', level: 'unknown' };
  return { text: `${ms} ms`, level: pingLevel(ms) };
}

/** A span for a lobby row; renderPings keeps it current. */
export function pingTag(id: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ping';
  el.dataset.pingId = id;
  fill(el, id);
  return el;
}

function fill(el: HTMLElement, id: string) {
  const { text, level } = pingText(id);
  if (el.textContent !== text) el.textContent = text;
  if (el.dataset.level !== level) el.dataset.level = level;
  el.title = level === 'host' ? 'Everyone plays through the host' : 'Round trip to the host';
}

export function renderPings() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-ping-id]')) fill(el, el.dataset.pingId!);
  const room = session.room;
  const show = session.status === 'room' && room?.phase === 'match';
  panel.hidden = !show;
  if (!show) return;
  const rows = room.members.filter(m => m.connected);
  // Rebuild only when who's in changes; otherwise just refresh the numbers.
  const key = rows.map(m => `${m.id}:${m.team}:${m.name}`).join('|');
  if (panel.dataset.key !== key) {
    panel.dataset.key = key;
    panel.replaceChildren(...rows.map(m => {
      const li = document.createElement('li');
      li.dataset.team = m.team;
      li.classList.toggle('me', m.id === session.me);
      const name = document.createElement('span');
      name.className = 'ping-name';
      name.textContent = m.name;
      li.append(name, pingTag(m.id));
      return li;
    }));
  }
}
