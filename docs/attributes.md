# Player attributes

How each player's attributes change what they can do. Players set them in
the Locker room (home screen); `engine/stats.ts` turns them into each player's
own values when a match starts. The global `CONFIG` values are what a 5 gives.

## The rules

- Six attributes: **Pace, Stamina, Dribbling, Power, Tackling, Strength**.
- Each is a whole number from **1 to 10**. The default is **5**.
- They add up to **30** (6 × 5). In the Locker room you lower one to free a
  point, then spend it on another, so specialising means giving something
  up. Freed points not yet spent are kept as spare; the attributes plus the
  spare always make 30. Spare points do nothing in a match: they're simply
  not spent.
- Each point moves an attribute's values by **4%**: a multiplier of
  `m = 1 + 0.04 × (value − 5)`, so a 1 is `0.84×` and a 10 is `1.20×`.
  That's noticeable without breaking the game, and it keeps every build
  playable.
- Where a smaller number is better (times, drain), the value is divided by
  `m` instead. Where the value is a fraction that can't pass 100% (speed kept
  on a turn, dribbling speed), it's the *loss* that's divided by `m`, so the
  fraction approaches 100% without reaching it.

## What each one does

| Attribute | In short | `CONFIG` values it scales |
|---|---|---|
| Pace | Top speed and take-off, at the cost of a heavier touch with the ball and a faster stamina drain | `player.runSpeed`, `player.sprintSpeed`, `dribble.sprintTouch`, `stamina.drain` (6% a point above 5) |
| Stamina | Sprint longer, recover sooner | `stamina.drain`, `stamina.regen`, `stamina.tiredTime` |
| Dribbling | Close control: faster with the ball, ride tackles (like Strength), tighter turns with it, and quicker changes of direction and stops with or without it | `dribble.speedFactor` (1.4 points of a percent a point), the hold chance, `player.turnRateWithBall`, `dribble.turnSlowdown`, `player.response` on a turn or stop (8% a point) |
| Power | Harder shots, charged sooner, more curl | `kick.shotSpeed`, `kick.chargeTime`, `kick.curl` (8% a point) |
| Tackling | Pokes and slides that reach and keep the ball, for less stamina | `tackle.pokeRange`, `tackle.slideReach`, `tackle.slideControlCos`, `tackle.pokeCost`, `tackle.slideCost` |
| Strength | Ride tackles, hold off bumps, get up sooner after being slid into or sliding (10% a point), shove harder and get shoved less, lose less stamina when robbed (6% a point) | the hold chance, `dribble.loseDistance`, `tackle.stumbleTime`, `tackle.recoverTime`, `tackle.slideShove`, `tackle.robbedCost` |

Each touches two or three values, so it stays easy to explain on a stats
screen and to tune one at a time.

## At 1, 5 and 10

| Attribute | Value | At 1 | At 5 (today) | At 10 |
|---|---|---|---|---|
| Pace | Run speed | 4.28 m/s | 5.10 m/s | 6.12 m/s |
| Pace | Sprint speed | 6.30 m/s | 7.50 m/s | 9.00 m/s |
| Pace | Ball further ahead when sprinting with it | 0 m | 0 m | 0.35 m |
| Pace | Sprint before tiring, from full (Stamina 5) | 3.00 s | 3.00 s | 2.31 s |
| Stamina | Sprint before tiring, from full | 2.52 s | 3.00 s | 3.60 s |
| Stamina | Refill, empty to full | 5.95 s | 5.00 s | 4.17 s |
| Stamina | Tired spell | 2.98 s | 2.50 s | 2.08 s |
| Dribbling | Turn rate with the ball | 2.69 rad/s | 3.20 rad/s | 3.84 rad/s |
| Dribbling | Speed kept on a sharp turn | 50% | 58% | 65% |
| Dribbling | Speed with the ball, vs without | 86% | 92% | 99% |
| Dribbling | Tackles ridden from a Tackling 5 | 0% | 15% | 51% |
| Power | Full-power shot (2% a point below 5, 4% above) | 30.4 m/s | 33.0 m/s | 39.6 m/s |
| Power | Time to full power | 0.83 s | 0.70 s | 0.58 s |
| Power | Most curl, how fast the path turns (any kick bends 75° at most) | 4.6° a metre | 6.7° a metre | 9.4° a metre |
| Tackling | Poke range, edge to edge (8% a point) | 0.41 m | 0.60 m | 0.84 m |
| Tackling | Slide reach | 0.63 m | 0.75 m | 0.90 m |
| Tackling | Controlled-slide angle (8% a point below 5) | 24° | 35° | 42° |
| Tackling | Stamina a slide costs (a poke costs a third) | 14% | 12% | 10% |
| Strength | Tackles ridden from a Tackling 5 (6% a point) | 0% | 15% | 61% |
| Strength | Knock before losing the ball | 0.38 m | 0.50 m | 0.65 m |
| Strength | Off balance after being slid into | 0.83 s | 0.50 s | 0.33 s |
| Strength | Getting up after your own slide | 1.17 s | 0.70 s | 0.47 s |
| Strength | Shove on others in a slide (divided by theirs) | 2.28 m/s | 3.00 m/s | 3.90 m/s |
| Strength | Stamina lost when robbed of the ball | 13% | 10% | 8% |

## Things to watch when this goes in

- **Pace 10 sprint (9 m/s)** is faster than the ball's slower passes (8.5 m/s).
  A sprinter could outrun their own short pass; that may be fine, or Pace may
  need a smaller step.
- **Power 10 shots (39.6 m/s)** cross the 30 m pitch in under a second. Worth
  pairing with kick inaccuracy at full power if shots get too strong.
- **Tackling and Strength meet in a duel.** A poke or slide that reaches a
  dribbler wins it with chance `0.85 × (tackling m / (strength m × dribbling m))³`, capped
  at 1 (`tackle.holdBase`, `tackle.holdPower`). Level players win 85%;
  Strength 10 rides about 60% of the tackles from a Tackling 5; Strength 4 or
  less against a Tackling 5 rides none, and Tackling 7 or more against a
  Strength 5 always wins. Dribbling counts the same as Strength, so the
  two stack: a Pace build that gave up both loses every tackle that reaches it. It works both ways: low Strength loses the ball
  more, not just high Strength keeping it. (Shrinking the tackler's reach
  instead was tried first and did nothing: pokes connect well inside their
  reach.) A ridden slide is hopped: the dribbler keeps the ball and passes over the slider at `tackle.hurdleKeep` (70%) of their speed. Rear slides aren't contested: they always win the ball, but the slider takes `tackle.rearRecover` (1.5×) as long to get up, and "Penalized" splashes over their head. There are no fouls.
- Attributes are chosen before a match and sent once with the room, so they
  add nothing to the per-tick network traffic.
- Not included yet: **passing accuracy** (kicks go exactly where you face, so
  there's nothing to improve) and **heading** (no vertical play).
