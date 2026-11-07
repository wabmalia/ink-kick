---
name: release-notes
description: Add a line to Ink Kick's in-game release notes (src/ui/release-notes.ts) for any player-facing change. Use whenever committing, or about to commit, a change a player would notice: gameplay, balance, controls, menus, visuals, modes, multiplayer.
---

# Release notes

Ink Kick shows what's new from the **Release notes** button on the menu
(next to How to play). The notes live in `src/ui/release-notes.ts` as
`RELEASE_NOTES`: one entry a day, newest first, each a list of short lines.

## When

Before committing a change a player would notice, add a line for it under
today's date, in the same commit. If today has no entry yet, add one at the
top of the array (`date: 'YYYY-MM-DD'`, the local date).

## What to write

- One line a change, a single short sentence. Say what a player gets, not how
  it works: "Players backpedal and side-step instead of running backwards",
  not the speeds, angles or config names.
- Plain words, no em-dashes, no attribute maths.
- Fold a change into an existing line for today when it's the same thing
  (a tweak to something already noted today usually needs no new line).
- Keep the day's list to the things worth telling; around eight lines at most.

## Leave out

- **Anything hidden.** The lab (`#/lab`, `lab.html`) and anything else not
  linked from the game never appears, nor hints at it.
- Under-the-hood work: refactors, tests, tooling, performance with no visible
  effect, docs, deploys, analytics.
- Fixes to something added the same day.

## Check

`npx tsc --noEmit -p .` and the menu's Release notes dialog still opens and
scrolls.
