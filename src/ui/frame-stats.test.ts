import { describe, expect, it } from 'vitest';
import { summarize } from './frame-stats';

describe('summarize', () => {
  it('reads a steady 60 Hz as 60 fps with no drops', () => {
    const s = summarize(Array(120).fill(1000 / 60));
    expect(s.fps).toBeCloseTo(60);
    expect(s.drops).toBe(0);
  });

  it('counts hitches and keeps the worst', () => {
    const s = summarize([...Array(97).fill(16.7), 34, 50, 120]);
    expect(s.drops).toBe(3);
    expect(s.worst).toBe(120);
    expect(s.p95).toBeLessThan(34);
  });

  it('is empty with nothing drawn', () => {
    expect(summarize([]).fps).toBe(0);
  });
});
