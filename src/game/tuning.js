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
    levelTypeModifier: { ground: 1.15, basement: 0.90, upper: 1.00, trench: 0.95, wagon: 0.85, boss: 1.0 },
  },

  // FLOOR HOOKS (playtest: "give each floor a distinct hook so floor 7
  // does not feel like floor 2"). One sentence of identity per floor,
  // announced on arrival, plus the mechanical twist that backs it up.
  floorHooks: {
    1: { name: 'THE YARD', note: 'Three gates. Hold the compound.' },
    2: { name: 'BOILER LEVEL', note: 'Tight corridors. They come up the stairwell.', mod: 'blackout' },
    3: { name: 'OFFICES', note: 'They climb the facade and ride the shaft.' },
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
  enemies: {
    walker: { hp: 3, speed: 1.4, biteDamage: 14, biteInterval: 0.9, scrap: 10, radius: 0.55 },
    runner: { hp: 2, speed: 3.6, biteDamage: 9, biteInterval: 0.65, scrap: 15, radius: 0.45 },
    brute: { hp: 18, speed: 0.95, biteDamage: 30, biteInterval: 1.4, scrap: 40, radius: 0.75 },
    // Phase 3.5 depth roster. Each changes HOW you play, not just numbers:
    // spitter forces repositioning, crawler punishes tunnel vision under
    // sightlines, screamer is a priority-target puzzle, butcher is the
    // boss-floor peak.
    spitter: { hp: 2, speed: 1.0, biteDamage: 8, biteInterval: 1.2, scrap: 25, radius: 0.5, spitRange: 12, spitKeep: 7, spitInterval: 3.0, spitDamage: 8 },
    crawler: { hp: 2, speed: 2.6, lungeSpeed: 5.0, lungeRange: 4, biteDamage: 8, biteInterval: 0.8, scrap: 20, radius: 0.35 },
    screamer: { hp: 4, speed: 1.6, keepRange: 10, screamInterval: 6.0, screamSpawns: 3, biteDamage: 5, biteInterval: 1.2, scrap: 50, radius: 0.5 },
    butcher: { hp: 60, speed: 0.9, chargeSpeed: 6.5, chargeRange: 9, chargeTelegraph: 1.0, chargeRecover: 2.0, chargeDamage: 35, biteDamage: 20, biteInterval: 1.4, scrap: 400, radius: 0.95, backstabMult: 2.0 },
  },

  // ---- 3. Weapons -------------------------------------------------------
  // Pistol has INFINITE reserve (starter safety net; the pain is the 8-mag
  // + 1.4 s reload). Shotgun one-shots walker/runner point-blank, 3-shots a
  // brute. SMG carries a solo player to ~night 9-10. Machete one-swings
  // walker/runner = a REAL ammo saver. Grenade centre 15 = exactly one
  // brute; edge 3 still one-shots walkers in the 4 m radius.
  weapons: {
    pistol: { damage: 1, pellets: 1, magazine: 8, reserveMax: Infinity, fireCooldown: 0.40, reloadTime: 1.4, auto: false, spreadDeg: 0.8, name: 'PISTOL' },
    shotgun: { damage: 1, pellets: 6, magazine: 5, reserveMax: 40, fireCooldown: 0.9, reloadTime: 2.2, auto: false, spreadDeg: 8, name: 'SHOTGUN' },
    smg: { damage: 1, pellets: 1, magazine: 30, reserveMax: 240, fireCooldown: 0.09, reloadTime: 2.0, auto: true, spreadDeg: 2.5, name: 'SMG' },
    machete: { damage: 3, range: 1.75, arcDegrees: 100, swingCooldown: 0.8, name: 'MACHETE' },
    fragGrenade: { fuseTime: 3.0, damageCenter: 15, falloffRadius: 4.0, damageAtEdge: 3, selfDamage: 25, friendlyFire: false, throwSpeed: 12 },
    // ---- Weapon roster v2 (Phase 2) ------------------------------------
    // AK: heavier auto than the SMG (2-shots a walker, 10-shots a brute),
    // the late-run workhorse. Akimbo doubles the pistol's rate with a
    // bigger pooled mag, still infinite reserve: the broke player's DPS
    // upgrade. Smoke slows the horde (kiting/revive tool), molotov burns
    // an area over time (choke-point tool).
    ak: { damage: 1.5, pellets: 1, magazine: 30, reserveMax: 180, fireCooldown: 0.115, reloadTime: 2.4, auto: true, spreadDeg: 2.0, name: 'AK' },
    akimbo: { damage: 1, pellets: 1, magazine: 16, reserveMax: Infinity, fireCooldown: 0.2, reloadTime: 2.0, auto: false, spreadDeg: 1.6, name: 'DUAL PISTOLS' },
    smokeGrenade: { fuseTime: 1.5, cloudRadius: 3.0, cloudDuration: 8, slowFactor: 0.4, throwSpeed: 11 },
    molotov: { fuseTime: 0.0, burnRadius: 2.2, burnDuration: 5, dps: 3, throwSpeed: 11 },
    nightVision: { batterySeconds: 30, rechargePerDaySecond: 1.0 },
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
    droneDeploy: 40,               // tactical map: scout drone, one flight
    minePlacementFromMap: 26,      // remote placement pays a small premium
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
    spawnDistanceFromPlayer: { min: 12, max: 22 },
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
