import { afterEach, expect, it, vi } from 'vitest';
import { HostClock } from './host-clock';
import { LocalMatch } from '../game/state';
import { HostRoom } from './room';

let clock: HostClock;
afterEach(() => { clock?.stop(); vi.useRealTimers(); });

it('advances the host and delivers snapshots without any animation frames', () => {
  vi.useFakeTimers();
  const room = new HostRoom('ABCDE', 'host', 'Host', { change: () => {} });
  const snapshots: unknown[] = [];
  room.join('guest', 'Guest', { send: () => {}, sendState: m => snapshots.push(m) });
  room.start();
  const local = new LocalMatch(room.match!, () => room.step({ x: 0, y: 0, kick: false, sprint: false }));
  clock = new HostClock(dt => local.advance(dt));
  clock.start();
  clock.start();
  vi.advanceTimersByTime(1000);
  expect(room.tick).toBeGreaterThanOrEqual(58);
  expect(room.tick).toBeLessThanOrEqual(60);
  expect(snapshots.length).toBeGreaterThanOrEqual(29);
  const tick = room.tick;
  clock.stop();
  vi.advanceTimersByTime(2000);
  expect(room.tick).toBe(tick);
});

it('bounds catch-up work after a stalled scheduler', () => {
  vi.useFakeTimers();
  const advance = vi.fn();
  clock = new HostClock(advance);
  clock.start();
  const now = vi.spyOn(performance, 'now').mockReturnValue(60_000);
  vi.advanceTimersByTime(20);
  expect(advance).toHaveBeenCalledWith(0.1);
  now.mockRestore();
});
