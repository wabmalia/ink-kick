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
| Pace | Top speed without the ball | `player.runSpeed`, `player.sprintSpeed` |
| Stamina | Sprint longer, recover sooner | `stamina.drain`, `stamina.regen`, `stamina.tiredTime` |
| Dribbling | Tighter, faster turns with the ball | `player.turnRateWithBall`, `dribble.turnSlowdown`, `dribble.speedFactor` |
| Power | Harder shots, charged sooner, more curl | `kick.shotSpeed`, `kick.chargeTime`, `kick.curl` (8% a point) |
| Tackling | Pokes and slides that reach and keep the ball | `tackle.pokeRange`, `tackle.slideReach`, `tackle.slideControlCos` |
| Strength | Ride tackles, hold off bumps, get up sooner, shove harder | the hold chance, `dribble.loseDistance`, `tackle.stumbleTime`, `tackle.slideShove` |

Each touches two or three values, so it stays easy to explain on a stats
screen and to tune one at a time.

## At 1, 5 and 10

| Attribute | Value | At 1 | At 5 (today) | At 10 |
|---|---|---|---|---|
| Pace | Run speed | 4.28 m/s | 5.10 m/s | 6.12 m/s |
| Pace | Sprint speed | 6.30 m/s | 7.50 m/s | 9.00 m/s |
| Stamina | Sprint before tiring, from full | 2.52 s | 3.00 s | 3.60 s |
| Stamina | Refill, empty to full | 5.95 s | 5.00 s | 4.17 s |
| Stamina | Tired spell | 2.98 s | 2.50 s | 2.08 s |
| Dribbling | Turn rate with the ball | 2.69 rad/s | 3.20 rad/s | 3.84 rad/s |
| Dribbling | Speed kept on a sharp turn | 58% | 65% | 71% |
| Dribbling | Speed with the ball, vs without | 90% | 92% | 93% |
| Power | Full-power shot | 27.7 m/s | 33.0 m/s | 39.6 m/s |
| Power | Time to full power | 0.83 s | 0.70 s | 0.58 s |
| Power | Most curl on a full-power shot, sideways over 15 m | 1.9 m | 2.6 m | 3.4 m |
| Tackling | Poke range, edge to edge (8% a point) | 0.41 m | 0.60 m | 0.84 m |
| Tackling | Slide reach | 0.63 m | 0.75 m | 0.90 m |
| Tackling | Controlled-slide angle | 29° | 35° | 42° |
| Strength | Tackles ridden from a Tackling 5 | 0% | 15% | 51% |
| Strength | Knock before losing the ball | 0.42 m | 0.50 m | 0.60 m |
| Strength | Off balance after being slid into | 0.60 s | 0.50 s | 0.42 s |
| Strength | Shove on others in a slide | 2.52 m/s | 3.00 m/s | 3.60 m/s |

## Things to watch when this goes in

- **Pace 10 sprint (9 m/s)** is faster than the ball's slower passes (8.5 m/s).
  A sprinter could outrun their own short pass; that may be fine, or Pace may
  need a smaller step.
- **Power 10 shots (39.6 m/s)** cross the 30 m pitch in under a second. Worth
  pairing with kick inaccuracy at full power if shots get too strong.
- **Tackling and Strength meet in a duel.** A poke or slide that reaches a
  dribbler wins it with chance `0.85 × (tackling m / strength m)³`, capped
  at 1 (`tackle.holdBase`, `tackle.holdPower`). Level players win 85%;
  Strength 10 rides about half the tackles from a Tackling 5; Strength 3 or
  less against a Tackling 5 rides none, and Tackling 7 or more against a
  Strength 5 always wins. It works both ways: low Strength loses the ball
  more, not just high Strength keeping it. (Shrinking the tackler's reach
  instead was tried first and did nothing: pokes connect well inside their
  reach.) Rear slides aren't contested; they're a scramble until fouls.
- Attributes are chosen before a match and sent once with the room, so they
  add nothing to the per-tick network traffic.
- Not included yet: **passing accuracy** (kicks go exactly where you face, so
  there's nothing to improve) and **heading** (no vertical play).
