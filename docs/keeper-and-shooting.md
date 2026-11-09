# Keeper and shooting: tuning notes

What the keeper does, the numbers behind it, and what we tried on the way
there (November 2026). Read this before tweaking `CONFIG.keeper`,
`CONFIG.kick` or the carry: most knobs have been swept, and several that
look like the obvious fix did nothing.

All numbers are **goals out of 9**: the same setup shot 9 times with 9
seeds (the keeper's reaction time is the only thing that varies between
them). "Sure goal" means 9/9. Unless a table says otherwise the shooter is
all 5s.

## How it works now

### Passing on the run (`CONFIG.kick`)

- A pass carries `carry` (60%) of the kicker's forward speed, times
  `sprintCarry` (1.5) when sprinting at the kick, fading to none at full
  power. Backing off never weakens a pass.
- A tap on the sprint goes off at about 14 m/s against about 10 standing.
  The ball's drag (`ball.damping`) still lets a sprinter who keeps going
  catch it after about 1.4 s: a knock-on into space. Running, they never
  catch it.

### The keeper (`CONFIG.keeper`, `src/engine/keeper.ts`)

- **Position:** on the line that splits the angle the goal makes from the
  ball (`onAngle`), so from out wide it's nearer the near post. Off its
  line by `standOff` (further the closer the ball).
- **Narrowing:** while a shooter winds up, it walks out on the angle by up
  to `narrowBy` (1.2 m) more, never within `narrowGap` (4.5 m) of the ball.
  It always stays goal-side of the ball and never stands in its own net.
- **Closing down:** an attacker dribbling within `closeDown` (1.8 m) of it
  in its big box it always goes for, whatever it rolled about rushing
  (`rushChance`, from `rushFrom`). One winding up a shot it sets itself
  for instead. Once within `pokeAt` it goes straight at the ball and pokes
  only when facing it (a poke goes the way it faces).
- **Reacting:** it meets a shot where it stands (`k.at`), never backing
  off towards its line. It reads where the ball will cross exactly, but
  only `curlRead` (60%) of the curl, re-reading every `reread` (0.2 s).
- **Reaction time** varies shot to shot: `reaction` (0.275 s) plus up to
  `reactionSpread` (0.2 s) from `farFrom` (10 m) or more; `reactionClose`
  (0.05 s) plus up to `spreadClose` (0.1 s) within `closeFrom` (4 m),
  eased between. The decision is always the same (run if it can get there
  on foot, otherwise dive the right way); only how late it comes varies.
- **Diving:** for a ball outside `diveFrom` (0.4 m, its body) that it
  can't reach on foot (`footReach`), at `diveSpeed` (6 m/s), reaching
  `diveReach` (0.7 m) round its hands.

### The lab

- Shooting tab: a Run up option (standing, running or sprinting in from
  6 m back), plays on after the result, and a fresh seed every run (so the
  keeper's reaction differs run to run; shooters A and B share it).
- Pass tab: tap or half-power passes from standing, running or sprinting.

## Results with the current settings

Power 5, the full grid (below), against today's keeper:

| | Avg goals | Sure-goal setups | Setups at 7+ |
|---|---|---|---|
| Full power, no curl | 1.53 | 0 | 0 |
| Half power, no curl | 0.08 | 0 | 0 |
| Full power, curled | 0.78 | 13 | 19 |
| Half power, curled | 0.04 | 0 | 0 |
| Best option per spot, curled | 3.46 | 10 spots | 14 spots |
| Best option per spot, no curl | 2.56 | 0 spots | 0 spots |

"Best option per spot" is what a player who picks the right shot gets
from each spot. Curl stays the better choice (3.46 against 2.56) without
being a free goal.

## What we tried, and what we learned

### Random misreads felt wrong

The keeper first misjudged where a shot would cross, randomly, by up to
about 2.5 m either side. It dived the wrong way at balls to the middle
(23 of 30 full-power shots from 10 m), and in the lab it looked like a
side bias because every run used the same seed (`src/lab/lab.ts` now uses
a fresh one each run). Replaced by a correct read with a varying reaction
time: consistent behaviour, varying quality.

### Hot spots were positioning, not reactions

- **Narrowing too far:** it came 4 m off its line, within 2.5 m of a
  shooter winding up, and a full-power shot from about 9 m was past it in
  under 0.1 s: sure goals. Fixed by `narrowGap` 4.5 and `narrowBy` 1.2.
- **Narrowing along the line to the middle of the goal** took it off its
  near post against wide shooters. Fixed by standing on the angle.
- **Backing off to its line** when reacting: it ran diagonally back while
  the ball passed where it stood. Fixed by meeting the shot where it is.
- **The 0.4 to 0.7 m gap:** it wouldn't dive for a ball 0.4 to 0.7 m
  away and couldn't step there in time. `diveFrom` is now its body reach.
- **Distance matters:** a keeper is quicker to a shot from close.
  `reactionClose` and `spreadClose` brought point-blank hot spots down
  to about 7/9.

### Close range: confused, then fixed

Dribbled at in its box, the keeper backed off, poked sideways (it pokes the
way it faces, which lagged), and once the ball was nearer the line than its
usual depth its spot on the angle came out upfield of the ball, leaving the
goal open: it ended up in its own net while the ball was walked in. That
bug was also why straight shots from 2 to 5 m scored 1.6 out of 9 (half
and full, Power 5); with it fixed, 0.85.

Now it stays goal-side, goes straight at the ball in poking range, pokes
only facing it, and always closes down a dribbler within 1.8 m. Walking the
ball in from four angles (straight, at an angle, along the byline, across
the six-yard box), 9 seeds each: never walked in; it won or knocked the
ball away 34 times of 36. Straight shots from 2 to 5 m now score about
0.6 out of 9: point-blank is the keeper's.

| Close-down range / poke chance a tick | Straight shots from 2 to 5 m |
|---|---|
| Off | 0.85 |
| 1.8 m / 0.12 (chosen) | 0.62 |
| 2.5 m / 0.12 | 0.54 |
| 1.8 m / 0.04 | 0.66 |

### Varying the reaction makes it better, not worse

A fixed reaction at the middle of the range (Power 5, earlier settings):

| | Varies | Fixed |
|---|---|---|
| Avg goals | 0.71 | 0.94 |
| Full no-curl setups that always score | 0% | 35% |
| Setups at 7+ | 159 | 660 |

Each shot has a cut-off reaction time: quicker saves it, slower doesn't.
A fixed keeper is all or nothing per spot, so every shot needing a bit
quicker than its value is a sure goal. Variation saves some of those.
Narrowing the spread from 0.3 to 0.2 s kept sure goals at zero and made
fewer shots a toss-up; down to 0.1 s it became close to a wall (81% of
full no-curl setups never scored).

### Curl: reach, not reading

The curled sure goals were full-power shots from 8 to 11 m aimed outside a
post: the ball passes the keeper about 1.5 m away 0.2 s after the kick, and
curl just makes the corner safe to aim at.

| Tried | Curled full: sure-goal setups (was 124) | Verdict |
|---|---|---|
| Read 80% or 100% of the curl, or re-read every 0.1 s | 124 to 152 | No effect |
| Hard kicks curl less (`hardCurl`, full power keeps 45 to 75%) | 103 to 114 | Barely helps, removed |
| Dive speed 8 m/s | 22 | Helps a little |
| Dive reach 0.8 m | 0 | Fixes it, but keeper far stronger |

Then reach balanced against a slower reaction (Power 5, full grid):

| Reach / reaction | Curled full avg / sure | No curl full avg | Best per spot, curled against straight | Curl sure-goal spots |
|---|---|---|---|---|
| 0.4 / 0.2 (before) | 1.12 / 124 | 2.09 | 5.15 against 3.38 | 42 |
| 0.6 / 0.25 | 0.87 / 41 | 1.86 | 3.95 against 3.13 | 21 |
| **0.7 / 0.275 (chosen)** | **0.77 / 13** | **1.84** | **3.36 against 3.09** | **10** |
| 0.7 / 0.25 | 0.66 / 9 | 1.64 | 3.15 against 2.95 | 8 |
| 0.8 / 0.3 | 0.71 / 2 | 1.85 | 2.85 against 3.17 | 2 |

Past 0.7 curl stops being worth it (best curled scores less than best
straight); below it the corner curler is a free goal again.

### Power 1 to 9

Earlier keeper settings (reach 0.4, reaction 0.2 plus up to 0.3), so the
levels are higher than now, but the shape is what matters. Average goals
across every setup:

| | P1 | P3 | P5 | P7 | P9 |
|---|---|---|---|---|---|
| All shots | 0.58 | 0.66 | 0.71 | 0.87 | 1.03 |
| Full, no curl | 2.37 | 2.45 | 2.59 | 3.13 | 3.47 |
| Full, curled | 1.09 | 1.31 | 1.40 | 1.59 | 1.75 |

Power 9 scores most and every step up helps, more above 5 (it scales 2%
a point below 5, 4% above). One dip: taking each spot's best option, P4
was a little under P3. In 7% of single setups P9 scored less than P1,
mostly curled ones (Power adds curl, and a full curl can bend too far to
reach the line). Rerun this after keeper changes.

## Measuring it again

The numbers come from throwaway vitest files driving the lab's Shooting
scenario headless (`range.start` then `step` until `done`). The grid:

- spots: 1 to 13 m into the attacking half (`x`), 0 to 8 m wide (`y`),
  one side (the other mirrors it)
- shots: just inside the near or far post with no curl (target y = ±2);
  1 m outside with light or full curl (±3.5); 2 m outside with full curl
  (±4.5)
- run-up: standing, running, sprinting; kick: tap, half, full
- 9 seeds each: 8,424 setups, about 76,000 shots, about 75 s per run

```ts
// src/lab/zz-sweep.test.ts: delete when done.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { CONFIG } from '../config';
import { evenAttributes } from '../game/attributes';
import { range, defaultAttrs } from './scenarios';

it('sweep', () => {
  // Try values without editing config.ts, e.g. K='{"diveReach":0.8}'.
  Object.assign(CONFIG.keeper as Record<string, number>, JSON.parse(process.env.K ?? '{}'));
  const attrs = { ...defaultAttrs(range), a: { ...evenAttributes(), power: Number(process.env.POWER ?? 5) } };
  const shots: [number, string][] = [[2, 'none'], [-2, 'none'], [3.5, 'left'], [3.5, 'left-full'], [4.5, 'left-full'], [-3.5, 'right'], [-3.5, 'right-full'], [-4.5, 'right-full']];
  const goals: number[] = [];
  for (const [ty, curl] of shots) for (const runUp of ['stand', 'run', 'sprint']) for (const charge of ['tap', 'half', 'full'])
    for (let y = 0; y <= 8; y++) for (let x = 1; x <= 13; x++) {
      let g = 0;
      for (let seed = 1; seed <= 9; seed++) {
        const r = range.start(attrs, { spot: `${x},${y}`, target: `15,${ty}`, charge, curl, keeper: 'on', runUp }, seed);
        for (let i = 0; i < 1500 && !r.done; i++) r.step();
        if (r.readout()[1]!.rows[0]!.value === 'Goal') g++;
      }
      goals.push(g);
    }
  writeFileSync(process.env.OUT!, goals.join(''));
}, 3_600_000);
```

Run with `K='{...}' OUT=/tmp/sweep.txt npx vitest run src/lab/zz-sweep.test.ts`.
Several in parallel (one per setting) take about the same time as one.
Index into the output with
`((((shot * 3 + runUp) * 3 + kick) * 9 + y) * 13 + (x - 1))`.

Spot checks are quicker in the lab (`#/lab`, Shooting): drag the shot,
pick the run-up and kick, and use Run 50 for a goal rate.
