// ZOMBIE HIGH RISE - Phase 1 tuning sheet (from the game-design pass).
// All distances in metres, times in seconds, damage in "damage points"
// (walker = 3 hp baseline). The rationale comments and sanity checks come
// from a spawn-vs-kill-throughput simulation; change numbers deliberately.
export const TUNING = {
  // ---- 1. Waves / spawn budgets ----------------------------------------
  // Budget is "threat points", not raw counts, so mix shifts don't silently
  // change difficulty. 1.25x per night; a level (2 nights) is ~56% harder
  // than the previous. Above the alive-cap the budget queues: late nights
  // get LONGER, not laggier. Solo pistol-only pressure: night 1 ~1.0
  // (winnable kiting), night 4 ~1.9, night 6 ~2.2 = shop matters.
  waves: {
    budgetPoints: (night) => Math.round(9 * Math.pow(1.30, night - 1)),
    threatCost: { walker: 1, runner: 1.5, brute: 4, spitter: 2, crawler: 1.5, screamer: 3 },
    mixWeights: (night) => {
      const runner = Math.min(0.38, Math.max(0, 0.18 * (night - 1)));   // from night 2
      const brute = Math.min(0.22, Math.max(0, 0.10 * (night - 2)));    // from night 3
      const spitter = Math.min(0.16, Math.max(0, 0.07 * (night - 3)));  // from night 4
      const crawler = Math.min(0.16, Math.max(0, 0.07 * (night - 4)));  // from night 5
      const screamer = Math.min(0.10, Math.max(0, 0.05 * (night - 5))); // from night 6
      const walker = 1 - runner - brute - spitter - crawler - screamer;
      return { walker, runner, brute, spitter, crawler, screamer };
    },
    // Peaks and breathers: every 3rd night surges; the day after a surge
    // is longer and richer (see state.js).
    surgeEvery: 3,
    surgeBudgetMult: 1.35,
    maxAlive: 24,           // Quest 2 cap; instanced horde has headroom
    levelTypeModifier: { holdout: 1.15, traverse: 0.85, ground: 1.15, basement: 0.90, upper: 1.00, trench: 0.95, wagon: 0.85, boss: 1.0 },
  },

  // FLOOR HOOKS (playtest: "give each floor a distinct hook so floor 7
  // does not feel like floor 2"). One sentence of identity per floor,
  // announced on arrival, plus the mechanical twist that backs it up.
  floorHooks: {
    1: { name: 'THE FIELD', note: 'Nowhere to run. Hold the base and watch the haze.' },
    2: { name: 'THE UNDERWORKS', note: 'Get to the far corner.', mod: 'blackout' },
    3: { name: 'THE SECOND FIELD', note: 'Same drill. Worse odds.' },
    4: { name: 'THE YARD AGAIN', note: 'Same ground, worse odds.', mod: 'fog' },
    5: { name: 'THE TRENCH', note: 'Nowhere to run. Use the firing steps.' },
    6: { name: 'THE WAGON', note: 'Rolling. They board from both ends.' },
    7: { name: 'UPPER YARD', note: 'Spitters hold the high ground.', mod: 'frenzy' },
    8: { name: 'FLOODED BOILERS', note: 'Crawlers under the pipes.', mod: 'swarm' },
    9: { name: 'BROKEN OFFICES', note: 'Screamers call the building down.' },
    10: { name: 'LAST YARD', note: 'Everything at once.', mod: 'loot' },
    11: { name: 'DEEP TRENCH', note: 'The long walk to the lift.', mod: 'blackout' },
    12: { name: "THE BUTCHER'S ROOF", note: 'Kill it and you go home.' },
  },

  // Drone-dropped field traps. Each one answers a different problem:
  // TAR buys time, SPIKES grind a lane down, LURE decides WHERE the fight
  // happens, which is the whole point of a level you cannot walk out into.
  traps: {
    tar:   { radius: 3.4, duration: 100, slow: 0.38 },
    spike: { radius: 2.7, duration: 130, dps: 9 },
    lure:  { radius: 24, duration: 26 },
  },

  // THE BASE (holdout levels). The wall is the level's real health bar:
  // players are safe behind it until the horde chews a hole, and losing
  // it entirely ends the run.
  base: {
    zombieWallMult: 1.6,     // a bite does more to concrete than to a person
    repairCost: 5,           // scrap per repair action: cheap, do it every day
    // Long enough that the ring is worth watching and short enough that
    // patching four segments is not a chore. A hold you cannot see the
    // end of stops feeling like progress.
    repairHoldTime: 0.8,
    repairAmount: 60,        // half a segment, so a ruined one takes two goes
    loseAt: 0.12,            // average integrity at which the base is overrun
    warnAt: 0.45,            // HUD starts shouting about it here
  },

  // Night modifiers: rolled per night, announced at the countdown. They
  // make later floors structurally different, not numerically bigger.
  modifiers: {
    chanceNone: 0.4,
    list: ['fog', 'frenzy', 'blackout', 'swarm', 'loot'],
    fromNight: 3,
    fog: { fogFarMult: 0.35 },
    frenzy: { runnerSpeedMult: 1.3, runnerWeightAdd: 0.2 },
    blackout: { hemiMult: 0.45 },        // night vision's moment
    swarm: { budgetMult: 1.6, hpMult: 0.4 },
    loot: { dropMult: 3, scrapMult: 1.25 },
  },

  // ---- 2. Enemies -------------------------------------------------------
  // Walker (1.3 m/s) fully kitable at 4 m/s. Runner (3.4) JUST slower than
  // the player. Brute (0.85) is an hp wall that sells the shop. Bite model
  // (damage + interval) reads better than contact dps and syncs to anim.
  // Aggro: nearest STANDING player, re-evaluate every 2 s; never attack
  // downed players (L4D rule).
  // `mass` decides who gives ground when two bodies overlap: a brute
  // wades through a crowd of walkers rather than being jostled by them.
  enemies: {
    walker: { hp: 3, speed: 1.4, biteDamage: 14, biteInterval: 0.9, scrap: 10, radius: 0.55, mass: 1 },
    runner: { hp: 2, speed: 3.6, biteDamage: 9, biteInterval: 0.65, scrap: 15, radius: 0.45, mass: 0.8 },
    brute: { hp: 18, speed: 0.95, biteDamage: 30, biteInterval: 1.4, scrap: 40, radius: 0.75, mass: 4 },
    // Phase 3.5 depth roster. Each changes HOW you play, not just numbers:
    // spitter forces repositioning, crawler punishes tunnel vision under
    // sightlines, screamer is a priority-target puzzle, butcher is the
    // boss-floor peak.
    spitter: { hp: 2, speed: 1.0, biteDamage: 8, biteInterval: 1.2, scrap: 25, radius: 0.5, mass: 1, spitRange: 12, spitKeep: 7, spitInterval: 3.0, spitDamage: 8 },
    crawler: { hp: 2, speed: 2.6, lungeSpeed: 5.0, lungeRange: 4, biteDamage: 8, biteInterval: 0.8, scrap: 20, radius: 0.35, mass: 0.6 },
    screamer: { hp: 4, speed: 1.6, keepRange: 10, screamInterval: 6.0, screamSpawns: 3, biteDamage: 5, biteInterval: 1.2, scrap: 50, radius: 0.5, mass: 1 },
    butcher: { hp: 60, speed: 0.9, chargeSpeed: 6.5, chargeRange: 9, chargeTelegraph: 1.0, chargeRecover: 2.0, chargeDamage: 35, biteDamage: 20, biteInterval: 1.4, scrap: 400, radius: 0.95, mass: 12, backstabMult: 2.0 },
  },

  // ---- 3. Weapons -------------------------------------------------------
  // Pistol has INFINITE reserve (starter safety net; the pain is the 8-mag
  // + 1.4 s reload). Shotgun one-shots walker/runner point-blank, 3-shots a
  // brute. SMG carries a solo player to ~night 9-10. Machete one-swings
  // walker/runner = a REAL ammo saver. Grenade centre 15 = exactly one
  // brute; edge 3 still one-shots walkers in the 4 m radius.
  weapons: {
    // FIRE RATE IS YOUR TRIGGER FINGER, NOT A TIMER (Ola, 2026-08-23:
    // "you CAN shoot super quick but you will probably miss, as the recoil
    // will offset your aim"). fireCooldown is now only the mechanical
    // floor of the action: how fast the slide can cycle or the pump can be
    // worked. Everything above that is the player's click speed, and the
    // price of spamming is recoil that walks the muzzle off target.
    //
    // Sustained damage stays honest because the magazine does the
    // balancing: a pistol emptied in 0.8 s then costs a 1.4 s reload.
    pistol: { damage: 1, pellets: 1, magazine: 8, reserveMax: Infinity, fireCooldown: 0.10, reloadTime: 1.7, auto: false, spreadDeg: 0.7, name: 'PISTOL' },
    shotgun: { damage: 1, pellets: 6, magazine: 5, reserveMax: 40, fireCooldown: 0.42, reloadTime: 2.2, auto: false, spreadDeg: 8, name: 'SHOTGUN' },
    smg: { damage: 1, pellets: 1, magazine: 30, reserveMax: 240, fireCooldown: 0.09, reloadTime: 2.0, auto: true, spreadDeg: 2.5, name: 'SMG' },
    machete: { damage: 3, range: 1.75, arcDegrees: 100, swingCooldown: 0.8, name: 'MACHETE' },
    fragGrenade: { fuseTime: 3.0, damageCenter: 15, falloffRadius: 4.0, damageAtEdge: 3, selfDamage: 25, throwSpeed: 12 },
    // ---- Weapon roster v2 (Phase 2) ------------------------------------
    // AK: heavier auto than the SMG (2-shots a walker, 10-shots a brute),
    // the late-run workhorse. Akimbo doubles the pistol's rate with a
    // bigger pooled mag, still infinite reserve: the broke player's DPS
    // upgrade. Smoke slows the horde (kiting/revive tool), molotov burns
    // an area over time (choke-point tool).
    ak: { damage: 1.5, pellets: 1, magazine: 30, reserveMax: 180, fireCooldown: 0.115, reloadTime: 2.4, auto: true, spreadDeg: 2.0, name: 'AK' },
    akimbo: { damage: 1, pellets: 1, magazine: 16, reserveMax: Infinity, fireCooldown: 0.09, reloadTime: 2.0, auto: false, spreadDeg: 1.4, name: 'DUAL PISTOLS' },
    smokeGrenade: { fuseTime: 1.5, cloudRadius: 3.0, cloudDuration: 8, slowFactor: 0.4, throwSpeed: 11 },
    // airburstFuse is the safety timer for a molotov thrown into open
    // air. Impact detonation is separate and immediate; this is only what
    // happens when it never hits anything.
    molotov: { airburstFuse: 3.0, burnRadius: 2.2, burnDuration: 5, dps: 3, throwSpeed: 11 },
    nightVision: { batterySeconds: 30, rechargePerDaySecond: 1.0 },
    // RECOIL. Each shot kicks the aim upward and heats the weapon; heat
    // makes the NEXT kick bigger and the shot wider, and it bleeds off
    // when you stop. So a controlled pair lands and a panicked mag dump
    // climbs off the target, which is the whole point: the fire rate is
    // yours, the accuracy is what you pay with.
    //
    // `recover` is the fraction of each kick that eases back down. It is
    // deliberately below 1: the muzzle creeps up under sustained fire and
    // you have to pull back down yourself, the way a real burst behaves.
    // THE PATTERN IS LEARNABLE, NOT RANDOM (Ola: "a predictable rise with
    // a small random horizontal component means a good player can
    // compensate and feel skilled; pure random spread just feels
    // unfair"). Each weapon has a fixed drift sequence indexed by the shot
    // number in the burst. Vertical climb is always up and always the
    // same; only a small jitter is random. Learn the pattern, pull against
    // it, and you keep your group tight at ten shots a second.
    //
    // `heat` per shot vs `decayPerSecond` sets where control ends. Tap at
    // a controlled rate and heat never accumulates; spam and it saturates
    // in about half a second. That crossover IS the skill.
    recoil: {
      // pattern: horizontal drift per shot, in units of the vertical kick.
      // It repeats once exhausted, so a long burst is still predictable.
      pistol: {
        kick: 0.021, heat: 0.26, spreadHeat: 3.2,
        pattern: [0, 0.18, -0.26, 0.34, -0.30, 0.42, -0.46, 0.38],
      },
      akimbo: {
        kick: 0.017, heat: 0.16, spreadHeat: 3.2,
        pattern: [0, 0.3, -0.34, 0.42, -0.46, 0.5, -0.54, 0.46],
      },
      shotgun: {
        // One big straight kick. A pump gun has nothing to drift with.
        kick: 0.062, heat: 0.30, spreadHeat: 1.4,
        pattern: [0, 0.06, -0.08, 0.05],
      },
      smg: {
        // Classic: climbs first, then pulls right, then sweeps back left.
        kick: 0.010, heat: 0.19, spreadHeat: 3.8,
        pattern: [0, 0, 0.1, 0.22, 0.34, 0.42, 0.34, 0.12, -0.16, -0.38, -0.5, -0.42, -0.2, 0.08, 0.28],
      },
      ak: {
        kick: 0.017, heat: 0.22, spreadHeat: 3.0,
        pattern: [0, 0, 0.08, 0.18, 0.3, 0.36, 0.26, 0.02, -0.24, -0.4, -0.34, -0.12, 0.14, 0.3],
      },
      maxHeat: 1.0,
      decayPerSecond: 1.6,     // a beat off the trigger settles it
      growth: 1.0,             // how much hot kicks exceed cold ones
      // How much of the horizontal pattern is honest and how much is
      // noise. 0.18 is enough to stop a burst being a stencil, small
      // enough that the pattern is still the thing you are learning.
      jitter: 0.18,
      // Recovery is COMPLETE. The sight returns exactly to where you were
      // pointing once the trigger is still. Leaving a permanent residue
      // per shot sounds realistic but compounds: a hundred rounds would
      // drift your aim fourteen degrees up over the course of a fight and
      // never give it back. The skill is holding the group together
      // DURING the burst, not undoing damage afterwards.
      recover: 1.0,
      recoverRate: 9.0,
      // Recovery does NOT start until the trigger has been still for this
      // long. Without the delay the sight snaps back between shots and
      // spamming costs nothing, which is exactly what the probe measured:
      // eight rapid shots climbed LESS than five paced ones. With it,
      // climb accumulates through a burst and settles the moment you
      // stop, so restraint is the mechanic and not just a suggestion.
      recoverDelay: 0.16,
      // The burst resets when the weapon has cooled: the pattern always
      // starts from the top for a player who paces their shots.
      resetHeat: 0.02,
      // Aiming down sights steadies the weapon: less climb, less heat.
      adsKickMult: 0.55,
      adsHeatMult: 0.6,
    },

    // Aiming down sights: tighter spread, slower turn, narrower FOV.
    ads: { spreadMult: 0.25, fovMult: 0.72, sensMult: 0.55, enterTime: 0.14 },
    headshotMult: 2.5,   // headshots are worth going for
  },

  // ---- 4. Economy -------------------------------------------------------
  // Cumulative solo scrap by night end: n2 ~185, n4 ~505, n6 ~930. Shotgun
  // 250 affordable at elevator 1, SMG 400 at elevator 2-3. Melee bonus +5
  // pays the machete risk premium. Ammo is profitable per kill but refills
  // + packs + mines drain 50-60% of late income (no runaway snowball).
  economy: {
    startingScrap: 25,             // one day-1 mine = teaches the map view
    scrapPerKill: { walker: 10, runner: 15, brute: 40 },
    meleeKillBonus: 5,
    shopPrices: {
      shotgun: 250,                // includes a full 25-shell load
      smg: 400,                    // includes a full 120-round load
      ammoRefillShotgun: 75,       // +25 shells (caps at reserveMax)
      ammoRefillSmg: 90,           // +120 rounds
      healthPack: 75,
      mine: 18,                    // cheap on purpose: traps are a tactic, not a luxury
      grenadePack: 60,             // 2 frags
      // v2 gear: AK lands at elevator 3-4 for a solo buyer, akimbo is the
      // cheap slot-1 upgrade, utility throwables stay impulse-priced.
      ak: 650,                     // comes with a full 90-round load
      ammoRefillAk: 110,           // +90 rounds
      akimbo: 300,                 // permanent slot-1 upgrade
      smokePack: 50,               // 2 smoke grenades
      molotovPack: 70,             // 2 molotovs
      nightVision: 500,            // permanent device, battery per night
    },
    // THE DRONE is a delivery vehicle, not a weapon. On holdout levels the
    // squad cannot leave the base, so the drone is the ONLY way to touch
    // the field. It is therefore free to launch: you pay for the payload
    // it drops, and every payload is priced as a staple.
    droneDeploy: 0,
    dronePayload: { mine: 10, tar: 8, spike: 12, lure: 14 },
    // Loot that lands outside the base becomes a field crate. Fetching it
    // is free (the flight time is the price) and is the drone's second
    // job. A kill just outside the wall drops inside instead, so the
    // field does not fill with crates for every stray body.
    // Generous on purpose: walking over a med kit and not getting it is
    // far worse than getting one you did not quite step on.
    pickupRadius: 1.25,
    lootFallsInsideWithin: 7,
    droneFetchRadius: 6,
    mine: { triggerRadius: 0.6, blastRadius: 2.5, damage: 12 },
    // Explosive barrels: level furniture, free damage if you aim well and
    // a liability if the horde reaches you while standing next to one.
    barrel: { blastRadius: 4.0, damage: 18 },
  },

  // ---- 5. Pacing --------------------------------------------------------
  // Trickle 2.8 -> 0.9 s; bursts from night 3 break the metronome and
  // create grenade/mine moments. Nights land at 45-90 s. Day 45 s,
  // skippable when everyone readies up.
  pacing: {
    // Nothing may be born closer than this to a living player. Ola died at
    // his own arrival point to something he never saw.
    spawnSafeRadius: 6.0,

    // ROUTE LEVELS (traverse). No clock: pressure is a function of how
    // far the squad has pushed. Standing still is uncomfortable, not
    // fatal; advancing is what opens the holes.
    route: {
      pushEvery: 0.22,      // a push per quarter of the route crossed
      perPush: 3,           // enemies per push, per player, growing as you go
      trickle: 5.5,         // seconds between background arrivals
      maxAlive: 14,         // tight spaces: fewer bodies than a holdout
      boardSeconds: 1.4,    // stand on the exit plate this long to leave
      doorHoldTime: 1.6,    // longer than a repair: this is the beat you defend
    },

    // THE STUCK WATCHDOG. No round may ever be unwinnable because one
    // enemy cannot reach anybody. Patience is deliberately generous: a
    // zombie walking the long way around a ridge makes no DIRECT progress
    // for several seconds and must not be teleported for it.
    watchdog: {
      patience: 5.0,          // seconds of no progress before each stage
      progressEpsilon: 0.6,   // metres closer that counts as real progress
    },

    // PLAYTEST FIX (Ola): the day used to be 45 s of nothing before the
    // game started. Now the day is a SHORT working phase with a daylight
    // trickle of zombies, and the first one lands almost immediately.
    dayPhaseDuration: 22,
    firstDayDuration: 8,          // the run starts fighting within seconds
    nightIntroCountdown: 3,
    // Daylight raid: fewer, slower, steady. The art direction is "zombies
    // in daylight"; the game must not be night-only.
    dayRaid: {
      budgetFrac: 0.30,           // of the coming night's threat budget
      interval: 3.2,              // seconds between daylight arrivals
      speedMult: 0.8,             // sun-drunk and slow
      maxAlive: 6,
    },
    spawnInterval: (night) => Math.max(0.6, 2.3 - 0.16 * night),
    burst: {
      startNight: 2,
      everyNthSpawn: 5,
      size: (night) => Math.min(7, 2 + Math.floor(night / 2)),
    },
    nightsPerLevel: 2,
    // No dead air: if nothing is alive and nothing is scheduled for this
    // long, the director pushes the next beat forward.
    maxIdleSeconds: 6,
    finaleDuration: 14,   // roof extraction beat before the victory screen
  },

  // ---- 6. Player --------------------------------------------------------
  // Revive 4 s (cover the reviver), revived at 30 hp (mistake still felt).
  // No bleed-out in v1: downed players wait for a revive or the night end;
  // zombies ignore them. Solo: going down = night failed, restart level.
  player: {
    maxHp: 100,
    walkSpeed: 4.0,
    reviveTime: 4.0,
    revivedAtHp: 30,
    healthPackHeal: 50,
    bleedOut: null,
  },

  // ---- 7. Co-op scaling -------------------------------------------------
  // Sublinear budget (co-op adds focus fire + revives) but above L4D 0.5.
  // Pressure arrives as SIMULTANEITY via the interval divisor, not longer
  // conga lines. NEVER scale enemy hp with player count (readability).
  // PLAYTEST FLAG: 4p nights 6-8 least certain; raise 0.8 -> 1.0 first.
  coopScaling: {
    budgetMultiplier: (players) => 1 + 0.8 * (players - 1),
    spawnIntervalDivisor: (players) => 1 + 0.35 * (players - 1),
  },
};
