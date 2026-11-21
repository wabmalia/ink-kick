// Small DOM helpers the menus and dialogs share.

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Opens a dialog, focused on itself rather than its first button, so Got it
 *  doesn't open wearing the keyboard focus ring. */
export function openDialog(dialog: HTMLDialogElement) {
  dialog.showModal();
  dialog.focus();
}

/** Closes a dialog on a click on its backdrop, which lands on the dialog
 *  itself, outside its content. */
export function closeOnBackdrop(dialog: HTMLDialogElement) {
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
}

/** Whether a dialog (the help, or what the attributes do) is up. */
export const dialogOpen = () => document.querySelector('dialog[open]') !== null;

/** Tabs inside a container: each [role="tab"] shows the panel its
 *  aria-controls names and hides the others. Arrow keys, Home and End move
 *  between them, as tabs do. */
export function tabs(container: HTMLElement) {
  const list = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (tab: HTMLButtonElement, focus = false) => {
    for (const t of list) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')!)!.hidden = !on;
    }
    if (focus) tab.focus();
  };
  list.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', e => {
      const to = e.key === 'ArrowRight' ? (i + 1) % list.length
        : e.key === 'ArrowLeft' ? (i - 1 + list.length) % list.length
        : e.key === 'Home' ? 0
        : e.key === 'End' ? list.length - 1
        : null;
      if (to === null) return;
      e.preventDefault();
      select(list[to]!, true);
    });
  });
}
