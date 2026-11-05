// The game was called Score until November 2026, and kept what it remembers
// under score.* keys. Carried over to the new inkkick.* keys once, before
// anything reads them, so nobody loses their attributes, name or settings.

const OLD = 'score.';
const NEW = 'inkkick.';

for (const area of [() => localStorage, () => sessionStorage]) {
  try {
    const store = area();
    for (const key of Object.keys(store)) {
      if (!key.startsWith(OLD)) continue;
      const moved = NEW + key.slice(OLD.length);
      if (store.getItem(moved) === null) store.setItem(moved, store.getItem(key)!);
      store.removeItem(key);
    }
  } catch {
    /* storage off: nothing to carry over */
  }
}
