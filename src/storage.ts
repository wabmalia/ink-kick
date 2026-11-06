// What the game remembers in the browser, and where. Storage can throw
// (private mode, blocked site data); none of it is essential, so a failed
// read is "nothing saved" and a failed write is simply not remembered.

export const KEYS = {
  // This tab's player id, and the room it's hosting or joined (per tab).
  id: 'inkkick.id',
  host: 'inkkick.host',
  joined: 'inkkick.joined',
  // Remembered across visits.
  name: 'inkkick.name',
  attributes: 'inkkick.attributes',
  rules: 'inkkick.rules',
  keepers: 'inkkick.keepers',
} as const;

export const store = {
  get(area: Storage, key: string): string | null {
    try {
      return area.getItem(key);
    } catch {
      return null;
    }
  },
  set(area: Storage, key: string, value: string | null) {
    try {
      if (value === null) area.removeItem(key);
      else area.setItem(key, value);
    } catch {
      /* not remembered, that's all */
    }
  },
  /** A saved value parsed, or null if there's none or it won't parse. */
  getJSON(area: Storage, key: string): unknown {
    try {
      return JSON.parse(area.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  },
  setJSON(area: Storage, key: string, value: unknown) {
    store.set(area, key, JSON.stringify(value));
  },
};
