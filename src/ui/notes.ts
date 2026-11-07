// The Release notes dialog: one day at a time, opening on the latest, with
// Older and Newer to step through. The button on the menu opens it; the
// button inside, Esc or a click outside closes it.

import { $, closeOnBackdrop, openDialog } from './dom';
import { RELEASE_NOTES } from './release-notes';

const dialog = $<HTMLDialogElement>('notes');
const dayTitle = $('notes-day');
const list = $('notes-list');
const scroller = $('notes-scroll');
const older = $<HTMLButtonElement>('notes-older');
const newer = $<HTMLButtonElement>('notes-newer');
// Which day is showing: 0 the latest.
let at = 0;

const day = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });

function show(i: number) {
  at = Math.max(0, Math.min(RELEASE_NOTES.length - 1, i));
  const d = RELEASE_NOTES[at]!;
  dayTitle.textContent = day(d.date);
  list.replaceChildren(...d.notes.map(n => Object.assign(document.createElement('li'), { textContent: n })));
  list.scrollTop = 0;
  moreBelow();
  older.disabled = at === RELEASE_NOTES.length - 1;
  newer.disabled = at === 0;
}

// The fade and arrow at the bottom while there's more to scroll to.
function moreBelow() {
  scroller.classList.toggle('more', list.scrollHeight - list.scrollTop - list.clientHeight > 4);
}
list.addEventListener('scroll', moreBelow);

older.addEventListener('click', () => show(at + 1));
newer.addEventListener('click', () => show(at - 1));
dialog.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') show(at + 1);
  else if (e.key === 'ArrowRight') show(at - 1);
});
$('notes-open').addEventListener('click', () => {
  openDialog(dialog);
  // Shown first, so the list has a height to measure against.
  show(0);
});
$('notes-close').addEventListener('click', () => dialog.close());
closeOnBackdrop(dialog);
