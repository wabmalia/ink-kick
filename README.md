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
- **Touch screens**: a stick at the bottom left to run (and curl), Kick and
  Sprint buttons at the bottom right
  stand in for Space and Shift; a quick flick from Kick onto Sprint mid-charge
  is the fake (a slow slide still kicks). How to play has "Move and resize
  the buttons": drag the stick anywhere in the left half, Kick and Sprint
  anywhere in the right, and drag a control's dot to resize it

Shooting within 20 m of goal, a wind-up that couldn't go in even with a
full curl turns slowly towards goal, just until a curl could bring it in.
It never steers a tap, and a shot you can already curl in is left alone.
A pass (a tap, or up to 30% charge) to a teammate under 15 m away and
within 15° of your facing leaves your foot straight, then curls onto their
feet, a step ahead if they're running; how hard to hit it is still up to
you. Hold a direction after any other kick to curl the ball. Tuning and how both work:
[docs/keeper-and-shooting.md](docs/keeper-and-shooting.md#goal-assist).

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
