# Rendering load and MacBook fan noise

## Report and confidence

On November 9, 2026, the developer reported that playing Ink Kick made
their MacBook Pro M5 hot enough for the fans to become loud, described as
the laptop "steaming".

The code review found several plausible sources of sustained rendering
load. **No CPU/GPU trace, power reading, temperature measurement or frame
rate was captured on that Mac.** The dominant cost has not been measured.
This is an investigation and optimization plan, not a hardware diagnosis
or a benchmark of the M5.

Fans speeding up during graphics-heavy tasks is normal cooling behavior
([Apple guidance](https://support.apple.com/en-ie/101576)). The game has
enough rendering work to plausibly explain that response despite its
simple-looking characters. GPU rendering is the leading hypothesis from
the code; CPU work and other running applications have not been ruled out.

## Findings in the current code

| Finding | Evidence | Likely implication |
|---|---|---|
| No gameplay frame cap below display refresh (**fixed**) | `frame()` in [main.ts](../src/main.ts) drew every animation frame during a focused match. The menu is limited to about 30 FPS and unfocused drawing to about 5 FPS. | Chrome on a 120 Hz MacBook Pro display draws at 120 FPS; Safari stays at 60. The actual rate on the reported Mac is unknown. |
| Render density up to 2 | `GameView` in [view.ts](../src/game/view.ts) calls `setPixelRatio(Math.min(window.devicePixelRatio, 2))`. | Density 2 has four times the pixels of density 1 at the same CSS window size. Fullscreen and large windows increase the workload further. |
| Expensive fullscreen watercolour pass (**mostly fixed**) | The fragment shader in [watercolor.ts](../src/scene/watercolor.ts) samples colour five times and depth about nine times, and called `fbm()` six times per pixel. Each `fbm()` is four noise octaves, each four `sin`-based hashes: about 100 hashes per pixel. | Five of the six `fbm()` calls (wobble, grain, paper) depend only on screen position. At density 2 on a full-screen MacBook Pro window that is roughly 7 to 8 million pixels; at 120 FPS, close to a billion shader runs a second. |
| Multisampled, half-float scene target; antialiased canvas (**canvas part fixed**) | `Watercolor` creates a `HalfFloatType` render target with `samples: 4`, plus a depth texture. The main renderer also requested antialiasing. | The canvas only ever receives the watercolour pass's single full-screen quad, so its multisampling bought nothing. The scene target's MSAA and format are still worth measuring. |
| Four live shadow maps | `floodlights()` in [stadium.ts](../src/scene/stadium.ts) creates four shadow-casting spotlights, each with a 1024 × 1024 map. | Each light adds a pass for shadow-casting objects, plus shadow sampling during scene rendering. |

There are already useful optimizations: instanced players and crowd,
merged static geometry, pooled paint particles, and scoreboard textures
that update when their contents change. Their presence is a reason to
profile before spending time on further geometry or allocation changes.

## Changes made

On November 9, 2026, three changes that do not alter the look:

- **Static noise precomputed.** The wash wobble, grain and paper tooth are
  drawn once per window size (and after a lost GPU context) into an 8-bit
  RGBA texture the size of the drawing buffer, read back with nearest
  filtering, one texel per pixel. The blotches stay live: their wet edge
  sits in a 0.03-wide band that 8-bit storage would visibly step. The ink
  noise also stays live, since it boils. The per-pixel noise work drops from
  six `fbm()` calls to one. Storing at 8 bits moves wobble by at most about
  0.01 pixel and grain/paper by about 0.001 in colour, under one step of
  the 8-bit output.
- **Canvas antialiasing off.** `GameView` creates its renderer with
  `antialias: false`.
- **Match drawing capped at 60 FPS.** The same mechanism as the menu's 30
  FPS cap. The match itself still steps on every animation frame (and, for
  a host with a hidden tab, from the worker timer in `host-clock.ts`), so
  simulation, snapshots and guest input are unaffected. On a 120 Hz screen
  it draws every other frame; on 144 Hz about 72 FPS; on 100 Hz about 50.

None of these has been measured on the reported Mac yet, and the shader
change still needs a visual check in a real browser: the automated tests
do not compile shaders.

## Suggested order of work

1. **Measure where it stands now.** Use the production build and record
   browser/version, window size, display refresh rate, device pixel ratio,
   match mode and player count. Capture actual FPS, a browser performance
   trace, and CPU/GPU activity. Compare menu, solo and hosted multiplayer.
2. **Test lower render density.** Compare density 1, 1.25 and the existing
   maximum of 2. Going from 2 to 1 cuts output pixel count by 75%; that is
   not a promise of a 75% reduction in power or temperature. Check text,
   outlines, pitch markings and the ball at normal viewing distance.
3. **Measure the scene target's options.** Compare fewer MSAA samples
   and a lower-cost colour format where the tone mapping still looks
   correct. Change one setting at a time.
4. **Reduce shadow work if it remains significant.** Compare fewer lights
   casting shadows or smaller shadow maps, while keeping the visible
   floodlights and checking player/ball grounding. Avoid freezing all
   shadow maps: players and the ball move.

An optional low-power quality preset could expose the successful tradeoffs
after they are measured. Avoid selecting quality solely from a device
name; window size, browser and display behavior also affect the cost.

## Validation still needed

- Repeat the same scene before and after each change, allowing sustained
  load to settle. Fan response alone is not a precise performance metric.
- Check visual quality, input responsiveness and frame pacing, not just
  average FPS.
- Confirm that reducing drawing does not reduce hosting simulation speed
  or snapshot delivery, or interfere with guest input sending.
- Test at different window sizes and on a high-density display. Compare
  foreground, unfocused and hidden-tab behavior separately.

Hardware profiling and live visual comparisons remain outstanding. There
is no confirmed memory leak or thermal defect from this investigation.

## References

- [Animation frames follow display refresh and may pause in hidden tabs](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- [Three.js rendering resolution and high-density displays](https://threejs.org/manual/pages/responsive.html).
- [Three.js shadow-map rendering costs](https://threejs.org/manual/pages/shadows.html).
