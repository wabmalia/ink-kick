# Ink Kick

3D arcade football in the browser: Three.js + TypeScript + Vite + Vitest.
Live at https://wabmalia.github.io/ink-kick/ (repo wabmalia/ink-kick).
Desktop first; mobile is deferred.

## Commands

- `npm run dev`: local dev server
- `npm test`: Vitest, once
- `npm run check`: type check (`tsc --noEmit`)
- `npm run build`: production build

Every push to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`
runs check, test and build first). Pushing is shipping: only push when asked.

## Layout

- `src/engine/`: the match simulation as pure TS, no rendering. A 2D disc
  sim (`sim.ts`, no height), keeper AI (`keeper.ts`), bot (`ai.ts`), curl,
  player attributes (`stats.ts`). Fixed 60 Hz tick.
- `src/config.ts`: all tuning lives in `CONFIG`.
- `src/game/`: match/training state, input, snapshot (de)serialisation, view.
- `src/net/`: PeerJS online play, host authoritative. TURN relay in
  `relay.ts` (only used on the deployed site).
- `src/scene/`: Three.js scene, procedural footballer, ball, stadium.
- `src/ui/`: menus, help, release notes.
- `src/lab/`: hidden tuning lab at `#/lab` (`lab.html`). Never link to it
  or mention it in player-facing text.
- `docs/`: design and tuning write-ups (attributes, keeper and shooting,
  netcode, render performance). Record measurement methods and results
  there when tuning.

## Rules

- **Release notes.** Any change a player would notice gets a line in
  `src/ui/release-notes.ts` in the same commit. Follow
  `.claude/skills/release-notes/SKILL.md` (one short line per change,
  today's date entry, nothing hidden or under the hood). Don't drop other
  lines already there for the day unless the change replaces them.
- **Controls in sync.** When controls change, update the README and the
  How to play list in `index.html` together.
- **Tuning stays scalable per player.** When touching movement, turning or
  kick code, keep values easy to turn into per-player attribute multipliers
  (see `src/engine/stats.ts` and `docs/attributes.md`).
- **No protocol versioning.** The room prefix is plain `inkkick-`. Don't add
  or bump version numbers when network messages change; backwards
  compatibility isn't wanted until the game is finished.
- **Tests.** Sim, keeper and netcode changes come with Vitest coverage. Run
  `npm run check` and `npm test` before committing.
- **Parked, don't start unless asked:** offline / PWA caching, an arcade
  tile for this game.
- **Local multiplayer testing:** Waterfox to Chromium rooms fail locally (a
  known, accepted limitation). Test with two Chromium browsers or two tabs
  in one browser instead of diagnosing it.

## Writing and commits

- Commit messages: a short imperative subject in plain words, then a body
  explaining what changed and why, as in the existing history.
- No em-dashes in commit messages or player-facing text. Use a period,
  comma or colon.
- No `Co-Authored-By` trailers or "Generated with" footers in commits or
  PR descriptions.
- Only commit when asked; only push when asked.
