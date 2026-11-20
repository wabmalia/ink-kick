# Plan: guest prediction

Status: planned, not started (2026-11-20). Follows the adaptive draw delay
and input delivery work in `netcode.md`.

## Why

A guest's own player answers a key press only after the input reaches the
host, the host steps it, the snapshot comes back and the guest draws it a
few ticks behind. At 150 ms ping that is roughly 150 + 33 (snapshot gap) +
50..100 (draw delay) ≈ 250 ms. The host feels none of it. Prediction makes
a guest's own movement, dribbling and kick wind-up answer at once, as the
host's do.

## Approach: re-simulate from the host's state

The sim (`src/engine/sim.ts`) is pure TS with a fixed 60 Hz step and a
seeded RNG in the match, so a guest can run it too. On every snapshot:

1. Take the host's state at tick T as the truth.
2. Replay the guest's own inputs the host hasn't played yet (sequence
   numbers above the host's acknowledgement for this guest), one per tick,
   up to now. Everyone else repeats their last known input.
3. Draw that predicted world, easing away the visual jump when it differs
   from what was drawn last frame.

Between snapshots the guest steps the predicted world each tick with its
live input. Replaying ~10 ticks 30 times a second for one small match is
cheap.

Exact determinism across browsers is **not** needed: `Math.exp`, `hypot`
and friends may differ in the last bits between engines, but every snapshot
resets the guest to the host's numbers, so drift lives for a few ticks only.
This is not lockstep.

### What gets predicted

The open design question, to settle by playtest behind a flag:

- **Whole world predicted** (Rocket League style). Own player, ball and
  everyone else extrapolated from their last input. Own dribbling and kicks
  feel instant and the ball reacts to you at once; other players
  occasionally correct (they changed direction during the round trip).
  Likely the better feel for a ball game.
- **Own player only.** Own player predicted, ball and others interpolated in
  the past as now. Simpler, but you live in a different time from the ball:
  dribbling and tackles look off by the round trip. Probably wrong for
  football; keep as a fallback.

## Phases

0. **Lag you can test locally.** A dev-only option (`?lag=150&jitter=30`,
   not linked anywhere) that holds each outgoing guest/host message for a
   random delay before sending. Needed to judge everything below, and
   useful right away to check the draw delay and input changes at real
   pings. Small.
1. **Full state on the wire.** Today's snapshot is draw-only; prediction
   needs everything `step` reads: per player `drift`, `kickDown`,
   `sprintDown`, `cooldown`, `turnBack`, `hurdling`, `downBy`, `tired`,
   stats/attributes (guests don't know others' attributes today), plus match
   `seed`, `spin`, `curled`, `aftertouch`, `guard`, `pullingIn`,
   `kickoffHeld`, `restartIn`, `holdFor`. Add `serializeMatch` /
   `restoreMatch` with a round-trip test (restore then step equals step).
   Attributes go once in `sync`/room, not 30 times a second. Watch snapshot
   size (state-channel queue guard is 16 KiB).
2. **Acknowledgements and others' inputs.** Each snapshot carries, per
   guest, the sequence of the input it last played (the host's
   `member.input.seq`), and each player's current input so the guest can
   extrapolate them. The input queue from `netcode.md` already plays one
   input per tick in order, which is what replay assumes.
3. **Predictor.** `PredictedMatch` alongside `RemoteMatch`: input history
   by sequence, restore + replay on snapshot, step per tick, `state()` for
   the view. Unit tests: no drift with zero latency, own input visible next
   tick, correction after a host-side tackle.
4. **Smoothing corrections.** Draw = predicted position + an error offset
   that decays over ~100 ms, so a correction slides rather than snaps; snap
   when it's large (a kickoff, a big collision).
5. **Events.** Own kicks, pokes and slides make their effects locally at
   once and skip the host's copy of the same event; goals, steals, the
   scoreboard and anything about others stay host-only.
6. **Flag, playtest, tune.** `CONFIG.net.predict` (off / own / world),
   compared at 50, 150 and 250 ms with the phase 0 lag. Ship on once it
   feels right; keep the interpolated path for spectating and as fallback.

## Risks

- **Ball contests.** Two players reaching a loose ball: the guest predicts
  it wins, the host says otherwise, and the ball jumps. Smoothing hides
  some; a short delay before predicting someone else's touch may help.
- **Tackles on you.** You only learn of them a round trip later and get
  pulled back. Inherent; prediction makes it rarer to notice, not gone.
- **Keepers.** Their AI uses the match RNG; predicting them needs the seed
  in state, and they may jitter on correction. Could interpolate keepers
  instead.
- **Cost.** Phases 0 to 3 are the bulk, a few focused days. 4 to 6 are
  tuning by feel and take what they take.
