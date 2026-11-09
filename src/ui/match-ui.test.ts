import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { MatchSync } from '../net/protocol';

const dom = vi.hoisted(() => {
  class Element {
    textContent = '';
    className = '';
    hidden = true;
    children: Element[] = [];
    dataset: Record<string, unknown> = {};
    style = { setProperty: () => {} };
    classList = { add: (name: string) => { this.className += ` ${name}`; } };
    offsetWidth = 100;
    setAttribute() {}
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
  }
  const elements = new Map<string, Element>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  return { Element, get };
});
vi.mock('./dom', () => ({ $: dom.get }));
vi.mock('./wash', () => ({ paintNow: () => {} }));

let ui: typeof import('./match-ui');
beforeEach(async () => {
  vi.stubGlobal('document', { createElement: () => new dom.Element() });
  ui = await import('./match-ui');
  ui.resetMatchUi();
});
afterEach(() => { ui.resetMatchUi(); vi.unstubAllGlobals(); });

const baseline = (): MatchSync => ({
  snap: { matchId: 'match', tick: 500, ball: [0,0], owner: null, score: [3,1], clock: 100, players: [] },
  goals: [{ team: 'gold', scorer: 'host', own: false, at: 90 }],
  over: { winner: 'gold' }, restartIn: 0, holdFor: 0, kickoffTeam: 'red',
});

it('shows a missed final scoreboard immediately from the reconnect baseline', () => {
  ui.restoreMatchUi(baseline(), () => 'Ana');
  expect(dom.get('scoreboard').hidden).toBe(false);
  expect(dom.get('scoreboard-title').textContent).toContain('wins');
  expect(dom.get('scoreboard-final').textContent).toBe('3 - 1');
  expect(dom.get('scoreboard-waiting').hidden).toBe(false);
  expect(dom.get('scoreboard-lobby').hidden).toBe(true);
  expect(dom.get('goal-list').children).toHaveLength(2);
});

it('restores a goal pause, then clears it when the baseline is back in play', () => {
  const sync = { ...baseline(), over: null, restartIn: 2 };
  ui.restoreMatchUi(sync, () => 'Ana');
  expect(dom.get('banner').className).toContain('show');
  expect(dom.get('goal-by').textContent).toBe('Ana');
  expect(dom.get('scoreboard').hidden).toBe(true);
  ui.restoreMatchUi({ ...sync, restartIn: 0 }, () => 'Ana');
  expect(dom.get('banner').className).toBe('banner');
});
