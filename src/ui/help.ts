// The How to play dialog: the H key or the button opens it, H, Esc, the
// button inside or a click outside closes it.

const dialog = document.getElementById('help') as HTMLDialogElement;
const listeners = new Set<() => void>();

export function helpOpen() {
  return dialog.open;
}

/** Called when the dialog opens or closes. */
export function onHelp(fn: () => void) {
  listeners.add(fn);
}

function toggle(open: boolean) {
  if (open === dialog.open) return;
  if (open) dialog.showModal();
  else dialog.close();
}

dialog.addEventListener('close', () => listeners.forEach(fn => fn()));
document.getElementById('help-open')!.addEventListener('click', () => {
  toggle(true);
  listeners.forEach(fn => fn());
});
document.getElementById('help-close')!.addEventListener('click', () => toggle(false));
// A click on the backdrop lands on the dialog itself, outside its content.
dialog.addEventListener('click', e => {
  const r = dialog.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) toggle(false);
});

window.addEventListener('keydown', e => {
  if (e.code !== 'KeyH' || e.repeat) return;
  // Not while typing a nickname or room code.
  if (e.target instanceof HTMLInputElement) return;
  const opening = !dialog.open;
  toggle(opening);
  if (opening) listeners.forEach(fn => fn());
});
