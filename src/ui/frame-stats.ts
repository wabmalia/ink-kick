// Frame intervals summed up for the ?perf overlay (ui/perf.ts).

/** Frame intervals in ms, summed up the way the overlay shows them. */
export function summarize(intervals: number[]) {
  if (!intervals.length) return { fps: 0, avg: 0, p95: 0, worst: 0, drops: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((a, b) => a + b, 0);
  return {
    fps: (intervals.length * 1000) / total,
    avg: total / intervals.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
    worst: sorted[sorted.length - 1]!,
    // A frame that took over one and a half 60 Hz frames: a visible hitch.
    drops: intervals.filter(ms => ms > 25).length,
  };
}
