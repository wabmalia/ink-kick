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
  },

  tackle: {
    // Released before this it's a poke; held past it, a slide.
    tapTime: 0.18,
    holdMoveFactor: 0.85,
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
    // A player taken out by a slide loses control this long.
    stumbleTime: 0.5,
    // A player robbed of the ball can't trap it for this long.
    stealCooldown: 0.6,
  },

  // Pause after a goal before the kickoff.
  restartDelay: 1.8,
} as const;
