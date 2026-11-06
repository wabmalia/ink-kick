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
