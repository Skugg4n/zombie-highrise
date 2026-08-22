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
    budgetPoints: (night) => Math.round(8 * Math.pow(1.25, night - 1)),
    threatCost: { walker: 1, runner: 1.5, brute: 4 },
    mixWeights: (night) => {
      const runner = Math.min(0.40, Math.max(0, 0.12 * (night - 1))); // runners from night 2
      const brute = Math.min(0.25, Math.max(0, 0.07 * (night - 3)));  // brutes from night 4
      return { walker: 1 - runner - brute, runner, brute };
    },
    maxAlive: 20,           // Quest 2 hard cap, all player counts
    levelTypeModifier: { ground: 1.15, basement: 0.90, upper: 1.00 },
  },

  // ---- 2. Enemies -------------------------------------------------------
  // Walker (1.3 m/s) fully kitable at 4 m/s. Runner (3.4) JUST slower than
  // the player. Brute (0.85) is an hp wall that sells the shop. Bite model
  // (damage + interval) reads better than contact dps and syncs to anim.
  // Aggro: nearest STANDING player, re-evaluate every 2 s; never attack
  // downed players (L4D rule).
  enemies: {
    walker: { hp: 3, speed: 1.3, biteDamage: 10, biteInterval: 1.0, scrap: 10, radius: 0.55 },
    runner: { hp: 2, speed: 3.4, biteDamage: 6, biteInterval: 0.7, scrap: 15, radius: 0.45 },
    brute: { hp: 15, speed: 0.85, biteDamage: 25, biteInterval: 1.5, scrap: 40, radius: 0.75 },
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
      mine: 50,                    // hand-placed during the day
      grenadePack: 60,             // 2 frags
    },
    minePlacementFromMap: 65,      // remote placement pays a convenience premium
    mine: { triggerRadius: 0.6, blastRadius: 2.5, damage: 12 },
  },

  // ---- 5. Pacing --------------------------------------------------------
  // Trickle 2.8 -> 0.9 s; bursts from night 3 break the metronome and
  // create grenade/mine moments. Nights land at 45-90 s. Day 45 s,
  // skippable when everyone readies up.
  pacing: {
    dayPhaseDuration: 45,
    nightIntroCountdown: 5,
    spawnInterval: (night) => Math.max(0.9, 2.8 - 0.2 * night),
    burst: {
      startNight: 3,
      everyNthSpawn: 8,
      size: (night) => Math.min(5, 2 + Math.floor(night / 3)),
    },
    spawnDistanceFromPlayer: { min: 12, max: 22 },
    nightsPerLevel: 2,
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
