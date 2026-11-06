// Every tuning knob in one place. Distances are metres, times seconds,
// speeds metres per second. Damping is the factor kept per tick.
export const CONFIG = {
  tick: 1 / 60,

  pitch: {
    width: 30,
    height: 18,
    goalWidth: 5,
    goalDepth: 1.5,
    // How far past the lines players may roam.
    margin: 2.5,
    // Radius of the centre circle, which the defending team keeps out of at
    // a kickoff.
    centreCircle: 2.8,
  },

  player: {
    radius: 0.45,
    invMass: 0.5,
    bounce: 0.5,
    runSpeed: 5.1,
    sprintSpeed: 7.5,
    tiredSpeed: 3.6,
    // How quickly velocity closes on the target velocity, per second.
    response: 10,
    // Radians per second; slower with the ball so it swings round.
    turnRate: 8,
    turnRateWithBall: 3.2,
  },

  stamina: {
    // Fractions of a full bar per second.
    drain: 1 / 3,
    regen: 0.2,
    // Running dry leaves you tired this long, at tiredSpeed, unable to sprint.
    tiredTime: 2.5,
  },

  ball: {
    radius: 0.24,
    damping: 0.982,
    // An eighth of a player's mass, so shots stop on bodies rather than
    // shoving them.
    invMass: 4,
    bounce: 0.6,
    // Off a player's body: low, so a shot into someone drops near them.
    playerBounce: 0.08,
    // Off the lines and the net while someone has it.
    heldBounce: 0.1,
  },

  post: {
    radius: 0.12,
    bounce: 0.5,
  },

  dribble: {
    // Gap between player and ball edges that still traps a loose ball.
    reach: 0.25,
    // Ball centre ahead of the player's centre while dribbling.
    distance: 0.6,
    // How hard the ball is pulled back to that spot, per second.
    spring: 22,
    // Knocked further than this from that spot, the ball is loose.
    loseDistance: 0.5,
    speedFactor: 0.92,
    // Speed kept while turning 90 degrees with the ball; less sharp turns
    // lose less, and sharper ones more, down to reverseKeep for an about
    // turn: you stop, turn with the ball and go.
    turnSlowdown: 0.65,
    reverseKeep: 0.08,
    // Turning with the ball is this many times quicker standing still than
    // at a run, so a reversal is a pivot rather than a loop.
    pivotBoost: 2.2,
    // Slower than this with the ball, you turn on the spot and move along
    // the way you're pressing, rather than curving.
    pivotSpeed: 1,
    // Only a ball within this of where you face (cos of 60 degrees) is
    // picked up; one further round hits you and drops, and you turn to it.
    trapCos: 0.5,
    // No trapping for this long after losing the ball.
    lostCooldown: 0.25,
  },

  kick: {
    // Holding this long gives full power.
    chargeTime: 0.7,
    passSpeed: 8.5,
    shotSpeed: 33,
    // Movement while charging.
    moveFactor: 0.3,
    // The kicker can't trap their own kick for this long.
    cooldown: 0.3,
    // Aftertouch: for this long after a kick, holding a direction across
    // its path curls it that way, up to curl (radians its path turns a
    // metre, so a hard shot bends as much over the same ground as a soft
    // one), reached after curlBuild seconds of holding. The spin fades by
    // spinFade a second.
    aftertouch: 0.5,
    curl: 0.117,
    curlBuild: 0.25,
    // The most a kick's path can turn, radians (75 degrees), easing off over
    // the last turnEase of it.
    maxTurn: 1.31,
    turnEase: 0.3,
    spinFade: 0.8,
  },

  tackle: {
    // A tackle is a poke with the ball this close, edge to edge (or the
    // dribbler within pokeBodyReach); any further, it's a slide.
    pokeRange: 0.6,
    pokeTime: 0.25,
    // Radius around the poking foot that reaches the ball.
    pokeReach: 0.7,
    // How close a poke has to get to a dribbler's body when the ball is out
    // of reach behind them, edge to edge.
    pokeBodyReach: 0.5,
    // Pokes only work from within this cosine of the dribbler's facing;
    // -0.35 leaves a shielded arc of about 140 degrees behind them.
    shieldCos: -0.35,
    // Speed the ball is knocked loose at, back towards the poker.
    pokeKnock: 3.5,
    pokeLunge: 2.2,
    slideSpeed: 9.4,
    slideTime: 0.45,
    slideDamping: 0.965,
    slideKnock: 7.7,
    // A slide that meets the ball within this cosine of its line (about 35
    // degrees) keeps it; met off to one side, it's knocked on at slideKnock.
    slideControlCos: 0.82,
    // Time to pull a ball won by a controlled slide in to the feet.
    pullInTime: 0.15,
    // Radius around the sliding foot that reaches the ball.
    slideReach: 0.75,
    // Getting up after a slide, at a fraction of normal speed.
    recoverTime: 0.7,
    recoverFactor: 0.4,
    // A player taken out by a slide loses control this long, shoved aside at
    // this speed.
    stumbleTime: 0.5,
    slideShove: 3,
    // A tackle that reaches a dribbler wins with chance holdBase times
    // (tackling / strength) to the holdPower, as attribute multipliers,
    // capped at 1: level players win holdBase of them.
    holdBase: 0.85,
    holdPower: 3,
    // A player robbed of the ball can't trap it for this long.
    stealCooldown: 0.6,
    // A slide through a dribbler's back knocks the ball on ahead of them at
    // this speed, and the slider can't trap it for this long.
    rearKnock: 2.5,
    rearSlideCooldown: 0.9,
  },

  // The goalkeepers, when a match has them (engine/keeper.ts).
  keeper: {
    // The small box it keeps to, and the big box it may come out into to
    // claim a ball or close an attacker down: this deep from the goal line,
    // this far either side of the middle.
    boxDepth: 1.8,
    boxHalf: 3.6,
    areaDepth: 5,
    areaHalf: 5,
    // Coming out: for a loose ball it'll reach this much sooner than any
    // opponent; at an attacker on the ball this close, rushChance of the
    // time (decided once an attack), poking at it at rushPoke a tick.
    claimMargin: 0.85,
    rushFrom: 6,
    rushChance: 0.6,
    rushPoke: 0.12,
    // How far off its line it stands at the least.
    lineOff: 0.55,
    // A ball heading for goal faster than this is a shot. The keeper moves
    // for it reaction seconds after a ball that fast comes into its half,
    // to where it guessed it would cross, off by up to error metres (more
    // for harder shots). It reads curlRead of the curl and looks again
    // every reread seconds.
    shotSpeed: 6,
    reaction: 0.22,
    error: 1.8,
    curlRead: 0.6,
    reread: 0.2,
    // A loose ball in its box slower than this, it goes and gets.
    collectSpeed: 7,
    // Holding the ball this long before kicking it out.
    holdTime: 0.9,
    // An attacker on the ball this close, it pokes at now and then (the
    // chance a tick).
    pokeAt: 1.3,
    pokeChance: 0.04,
    // Diving: for a shot crossing further than diveFrom from it that it
    // can't reach on foot, arriving within diveWithin seconds.
    diveFrom: 0.7,
    diveWithin: 0.45,
    diveSpeed: 6,
    diveReach: 0.4,
    // Faster than this, a shot comes off the keeper (bouncing back this
    // much) rather than being caught; slower than gatherSpeed it picks the
    // ball up from a little way off, like anyone.
    catchSpeed: 13,
    parryBounce: 0.45,
    parryCooldown: 0.4,
    gatherSpeed: 5,
    // After its kick out, the other team can't touch the ball for this long.
    kickGuard: 0.4,
    // Kicking out: a teammate needs this much room either side of the
    // ball's path from any opponent to be passed to.
    clearPass: 1.4,
    // Coming out to narrow the angle while a shot's wound up: the ball within
    // narrowFrom of the goal, up to narrowBy further out than usual, keeping
    // narrowGap from the ball.
    narrowFrom: 16,
    narrowBy: 2.2,
    narrowGap: 2.5,
  },

  // Pause after a goal before the kickoff.
  restartDelay: 1.8,
  // At a kickoff, the ball counts as played once it's this far off the spot.
  kickoffPlayed: 0.1,
  // How long everyone waits for the coin toss at the start of a match:
  // the toss up close, then the camera pulling back as the captains take
  // their places.
  coinTime: 3.6,

  net: {
    // The host sends a snapshot every this many ticks (2 is 30 a second).
    snapshotEvery: 2,
    // Guests draw this many ticks behind the newest snapshot, so there's
    // usually a pair to blend between even when one goes missing.
    delayTicks: 6,
    // Further off than this, a guest jumps straight to the right time.
    resyncTicks: 30,
  },
} as const;
