# Score

Floodlit arcade football, drawn in ink and watercolour. Three.js + TypeScript + Vite.

## Play

```sh
npm install
npm run dev
```

- **WASD / arrows**: run
- **Shift**: sprint, until your stamina runs dry and you tire
- **Space / X with the ball**: hold to power a kick, release to strike it
- **Space / X without the ball**: tap to poke the ball loose, hold to slide

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

## Scripts

- `npm test`: sim tests (Vitest)
- `npm run check`: type check
- `npm run build`: production build into `dist/`
