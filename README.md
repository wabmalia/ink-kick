# Ink Kick

Watercolour arcade football, solo or with friends. Three.js + TypeScript + Vite.

## Play

```sh
npm install
npm run dev
```

- **WASD / arrows**: run
- **Shift**: sprint, until your stamina runs dry and you tire
- **Space / X with the ball**: hold to power a kick, release to strike it
- **Space / X without the ball**: tap to poke the ball loose, hold to slide

While charging within 20 m of the opposing goal's centre, you turn at 30°/s
towards it if it is ahead but more than 20° off your facing. The turn stops
when the goal enters that cone. Direction keys after the kick still add curl.
The range, cone and speed are `goalAssistRange`, `goalAssistCone` and
`goalAssistTurnRate` in `CONFIG.kick` (`src/config.ts`); the speed is stored
in radians per second. Set the range to 0 to disable the assist.

The ring under your player marks who you control. The half ring in front of it shows
stamina (left) when it isn't full and kick power (right) while charging.

## How it's built

- `src/engine/sim.ts`: the match as plain 2D discs on a rectangle, no rendering.
  Fixed 60 Hz steps, deterministic, so a host can run it for online play later.
- `src/engine/ai.ts`: a simple opponent that plays through the same input as a person.
- `src/config.ts`: every tuning knob (speeds, stamina, kick power, tackles).
- `src/scene/`: the Three.js side. Stadium, floodlights, stickman footballers
  animated in code, the gauges, and `watercolor.ts`, the post-processing pass that
  paints the scene.

Rendering load, the MacBook fan-noise report, and proposed profiling steps
are recorded in [render performance notes](docs/render-performance.md).

## Icons

`public/favicon.png` and `public/apple-touch-icon.png` are painted by
`iconDataUrl()` in `src/ui/wash.ts`, the title's splash in a square. To
redraw them, run the dev server and call it from the browser console:
`(await import('/src/ui/wash.ts')).iconDataUrl(32)` gives a data URL to save.

## Scripts

- `npm test`: sim tests (Vitest)
- `npm run check`: type check
- `npm run build`: production build into `dist/`
