// What's new, a day at a time, newest first: shown from the Release notes
// button on the menu. One short line a change a player would notice; nothing
// hidden (the lab) and nothing under the hood. See
// .claude/skills/release-notes/SKILL.md.

export interface ReleaseDay {
  // YYYY-MM-DD.
  date: string;
  notes: string[];
}

export const RELEASE_NOTES: ReleaseDay[] = [
  {
    date: '2026-11-09',
    notes: [
      'Passes hit on the run go faster, and further still on the sprint.',
      'Keepers stand better, cover their near post and dive further: a corner curler is no longer a sure goal.',
      'Keepers dive with their hands out instead of sliding.',
      'Keepers close down anyone dribbling at them up close.',
      'Keepers have to get closer to win the ball from you, and can\'t grab it outside their box.',
      'A keeper holding the ball can\'t be barged out of the way.',
      'Players keep striding while winding up a shot on the run.',
      'Shots near goal that even a curl couldn\'t save turn slowly until one could.',
      'Online matches reconnect without a page refresh and restore the score and final result.',
      'Matches can keep running while the host\'s tab is in the background.',
    ],
  },
  {
    date: '2026-11-07',
    notes: [
      'Defensive stance: face up to the player on the ball to keep them in front of you. Sprint to drop it.',
      'Players backpedal and side-step instead of running backwards.',
      'Dribbling keeps the ball better in tackles and wins tight turns; Pace wins the straights.',
      'Strength counts for more in tackles.',
      'Sharp changes of direction cost more speed.',
      'A slide from behind wins the ball, but you\'re penalized: slower to get up.',
      'A slide that\'s ridden out gets hopped over.',
      'Pace tires you in proportion: low Pace lasts longer.',
    ],
  },
  {
    date: '2026-11-06',
    notes: [
      'Footsteps splash paint.',
      'Matches are first to 3, 5 or 7.',
      'The final board lists each scorer once, with their goal times.',
      'Hard turns: spin round and slide on, leaving the ball behind.',
      'Tackles cost stamina, and Strength keeps you on your feet.',
      'Pace has a heavier touch and tires quicker.',
      'Keepers kick out to the most open teammate and read curl.',
      'Your attributes sit beside every match setup.',
      'Join links open in a tab that already has the game.',
    ],
  },
  {
    date: '2026-11-05',
    notes: [
      'The game is now Ink Kick, with a new logo.',
      'Goalkeepers, and a keeper drill in training.',
      'Curl shots: hold a direction just after kicking.',
      'Match modes, scorers and a final scoreboard.',
      'Harder shots and stronger curl.',
    ],
  },
  {
    date: '2026-11-04',
    notes: [
      'Locker room: set your attributes.',
      'Training ground.',
      'Play online with friends in rooms.',
      'Kickoffs, a coin toss, fakes and a How to play.',
      'A painted pitch and menu, a crowd and a scoreboard.',
    ],
  },
  {
    date: '2026-11-03',
    notes: ['First kick: floodlit arcade football.'],
  },
];
