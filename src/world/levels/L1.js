// L1 - THE FIELD. Archetype HOLDOUT, built to Ola's sketch L1.
//
// THIS FILE IS DATA. Every number here describes THIS level; none of it is
// mechanism. A new holdout sketch is a new file like this one and no new
// builder code. See docs/level-format.md, which uses this file as its
// worked example.
//
// The base sits toward the north-west and every sight blocker is east and
// south of it. That asymmetry is the point: the threat arrives across an
// arc from north through east to south-west, so where you stand inside the
// base is a real decision.
//
// RNG ORDER IS A CONTRACT. Props are built in array order and three of them
// draw from the shared per-level rng (burntCars, skyline, scatter). Every
// peer builds this level locally from the same seed, so reordering them
// gives two players different fields. Add new rng-using props at the END.
export const L1 = {
  id: 'L1',
  name: 'THE FIELD',
  note: 'Nowhere to run. Hold the base and watch the haze.',
  archetype: 'holdout',

  world: {
    size: 80,                  // the open field, edge to edge
    waveLabel: 'WAVE',         // a surface level never gets dark, so not NIGHT
    drone: true,

    ground: { material: 'sandGround', size: 420, y: -0.02 },

    // Daylight and haze. Waves happen in DAYLIGHT on the surface: the whole
    // tension is watching them cross forty metres of open ground. fogNear
    // starts well past the base so the base itself is always crisp, and the
    // far ground dissolves, which is what hides the spawns.
    light: {
      daylight: true,
      sky: 'daySky', haze: 'dayHaze',
      fogNear: 26, fogFar: 96,
      sun: 2.4, hemi: 1.0, dark: false,
    },

    // PINNED, not derived. The horde spawns out to 46 m from a base that is
    // not at the world origin. A derived box would move the moment a prop
    // is added, and off-grid spawns never find a route in, which leaves the
    // wave counter stuck and the level unwinnable. Do not make this derived.
    nav: { minX: -52, maxX: 46, minZ: -52, maxZ: 44 },

    props: [
      // A road running past the base gives the eye a line into the haze.
      { prop: 'road', x: 6, z: 0, width: 8, length: 420, rot: 0.22 },

      // ---- Sight blockers, laid out to the sketch ----
      // `id` is the word a spawn's `from` points at, so it is also what the
      // debug overlay prints when it tells you where something came from.
      {
        prop: 'ridge', id: 'ridge', x: 6, z: -34, len: 34, height: 6.5, rot: 0.18,
        // A pass through it, roughly on the base's bearing. Without one,
        // anything spawning behind a 34 m ridge faces a forty metre detour
        // and the pathfinder gives up on it. With one they funnel through
        // in full view, which is better to watch anyway.
        gapAt: -7, gapW: 7,
        note: 'RIDGE, north, with a pass',
      },
      { prop: 'loneTree', id: 'tree', x: 18, z: -6, note: 'TREE, east' },
      { prop: 'burntCars', id: 'cars', x: 22, z: 9, note: 'BURNT OUT CARS, south-east' },
      { prop: 'bigRock', id: 'rock', x: -22, z: 16, note: 'ROCK, south-west' },
      { prop: 'ruinedHouse', id: 'house', x: 8, z: 26, rot: -0.25, note: 'HOUSE, south' },
      { prop: 'ruinedHouse', id: 'house', x: -34, z: -27, rot: 1.1, note: 'second house, north-west' },

      // ---- Mid-ground: the ground the horde actually crosses ----
      { prop: 'crashBarrier', id: 'barrier', x: 2, z: -14, len: 22, rot: 1.35, note: 'along the road, north' },
      { prop: 'crashBarrier', x: 11, z: 14, len: 18, rot: 1.35, note: 'along the road, south' },
      { prop: 'container', id: 'container', x: -4, z: 6, rot: 0.5, colour: 0x6b3a2e, note: 'south of the base' },
      { prop: 'container', x: 12, z: -22, rot: -0.9, colour: 0x2f4a52, note: 'on the ridge approach' },
      { prop: 'container', id: 'westbox', x: -20, z: -6, rot: 1.4, colour: 0x4a4736, note: 'west, close in, the quiet side' },
      { prop: 'busWreck', id: 'bus', x: -6, z: 20, rot: 0.35, note: 'south-west approach' },

      // ---- Close-in cover, so the NEAR spawn ring has somewhere to come
      // out from. Without these the level opens with an empty field.
      { prop: 'pipeMound', id: 'pipes', x: -4, z: -15, rot: 0.6, note: '10 m out, north-east' },
      { prop: 'pipeMound', id: 'pipes3', x: -15, z: -1.5, rot: 1.5, note: '10 m out, south' },

      // ---- Mid-distance cover, at 18-20 m in three directions, so the mid
      // ring has compact blockers to come out from. A long prop like the
      // crash barrier is no good for this: a spawn on the base-to-barrier
      // ray at 25 m can end up well off the end of it, in the open.
      { prop: 'container', id: 'depot', x: 5, z: -3, rot: -0.4, colour: 0x55503f, note: '20 m east' },
      { prop: 'pipeMound', id: 'pipes2', x: -17, z: 7, rot: 1.1, note: '18 m south-west' },
      { prop: 'bigRock', id: 'boulder', x: -19, z: -28, note: '18 m north-west, clear of the ridge' },

      { prop: 'pylons', x: -8, z: -30, dx: 6.5, dz: 4.2, count: 6, note: 'marching in from the ridge' },
      { prop: 'pylons', x: 26, z: -2, dx: 2.0, dz: 7.5, count: 5, note: 'east, past the tree' },
      { prop: 'skyline' },

      // Scrub and debris. minR/maxR are RESOLVED numbers, not arithmetic on
      // world.size: re-deriving them would let a change of field size
      // silently move all 46 rocks and change what a given seed builds.
      { prop: 'scatter', count: 46, around: 'frame', minR: 14, maxR: 52, size: [0.35, 1.1], colour: 0x8b8070 },
    ],
  },

  // ---- Zombie spawns: three rings, always behind a blocker ----
  //
  // "Mixed distances, not one distance. Nearest spawn cover about 12-15 m
  // so something is on you within roughly ten seconds, mid ring about 25 m,
  // far ring 40 m+ for the ones you watch build up. Wave 1 starts from the
  // near ring so the level opens fast." (Ola, 2026-08-23)
  //
  // Each spawn names the prop it hides BEHIND and how far out it sits, and
  // the position is derived: on the base-to-blocker ray at that distance,
  // so it is always hidden and always in its band. Typed coordinates stop
  // being either the moment a prop moves.
  spawns: [
    // NEAR: on you in about ten seconds, so the level opens immediately.
    { behind: [-4, -15], dist: 16, from: 'pipes', ring: 'near' },
    { behind: [-15, -1.5], dist: 16, from: 'pipes3', ring: 'near' },
    { behind: [-20, -6], dist: 15.5, from: 'westbox', ring: 'near' },
    // MID: the working distance, where most of the fight happens.
    { behind: [5, -3], dist: 26, from: 'depot', ring: 'mid' },
    { behind: [-17, 7], dist: 25, from: 'pipes2', ring: 'mid' },
    { behind: [-19, -28], dist: 27, from: 'boulder', ring: 'mid' },
    { behind: [-4, 6], dist: 26, from: 'container', ring: 'mid' },
    // FAR: the ones you watch gather out of the haze, and dread.
    { behind: [6, -34], dist: 42, from: 'ridge', ring: 'far' },
    { behind: [18, -6], dist: 40, from: 'tree', ring: 'far' },
    { behind: [22, 9], dist: 50, from: 'cars', ring: 'far' },
    { behind: [-22, 16], dist: 41, from: 'rock', ring: 'far' },
    { behind: [8, 26], dist: 54, from: 'house', ring: 'far' },
    { behind: [-6, 20], dist: 41, from: 'bus', ring: 'far' },
  ],

  // Out in the field on the approach lanes: a reward for a good shot at
  // range. The one inside the base is under base.barrels.
  barrels: [
    { x: 4, z: -18 },
    { x: 14, z: 2 },
    { x: -14, z: 10 },
  ],

  base: {
    at: { x: -13, z: -11 },
    size: 8,
    // Waist high on purpose: you shoot over it standing on the ground, so
    // the snipe platform is a choice about sightlines and not the only
    // place you can fight from.
    wall: { hp: 120, height: 0.95 },
    lift: { corner: 'southwest', inset: 0.24 },
    roomscale: { x: -0.2, z: 0.4 },

    // FRAME-LOCAL: (0,0) is base.at. The interior splits along the
    // west/east line: the lift owns the west side, the firing line owns the
    // east side facing the field.
    //
    // The sketch draws the ramp in the north-west corner. Built literally,
    // its ramp ran down the west wall and straight through the lift, which
    // trapped anyone who walked into the overlap. The firing position
    // therefore sits in the north-EAST corner instead, directly above the
    // sandbags and looking out over the threat side.
    interior: [
      // RAMP 4 SNIPE. Flush against the north and east walls, and 1.4 m
      // rather than 1.6 so its ramp fits inside the base instead of running
      // into the south wall.
      { prop: 'platform', x: 2.06, z: -2.36, w: 3.4, d: 2.8, height: 1.4, ramp: 'south', material: 'planksOld' },
      { prop: 'railing', x: 2.06, z: -3.76, w: 3.4, d: 0.12, material: 'metalDoor' },
      { prop: 'railing', x: 3.76, z: -2.36, w: 0.12, d: 2.8, material: 'metalDoor' },

      // Sandbags along the southern half of the east wall: ground-level
      // cover on the threat side, so you can fight the field low or high.
      // Flush against the platform's south edge, so the strip between the
      // ramp and the east wall is filled rather than left as a 0.8 m slot a
      // player can squeeze into and then not get out of.
      { prop: 'sandbags', x: 3.38, z: -0.68, count: 4, step: 1.15, w: 0.75, d: 1.05, height: 0.8, hx: 0.38, hz: 0.52 },

      // Interior cover. All of it stays out of three lanes that must never
      // be blocked: the ramp, the floor in front of the lift, and the
      // middle of the base itself.
      { prop: 'cover', x: -3.11, z: -3.11, w: 1.3, d: 1.3, height: 1.0, material: 'crate', note: 'NW corner, flush' },
      { prop: 'cover', x: -1.9, z: 2.2, w: 0.9, d: 0.9, height: 0.75, material: 'crate', note: 'south-west of centre' },
      { prop: 'cover', x: -3.06, z: -0.6, w: 1.4, d: 0.7, height: 1.05, material: 'sandbag', note: 'flush to the west wall' },
    ],

    // One inside, clear of the ramp lane: a risk you chose to keep.
    barrels: [{ x: -2.2, z: -1.6 }],

    // Clustered middle-south: clear of the ramp, clear of the lift, facing
    // the field. [0] is the host.
    playerSpawns: [
      { x: -0.5, z: 0.5 },
      { x: -1.8, z: 1.4 },
      { x: 0.6, z: 1.9 },
      { x: -2.2, z: 2.6 },
      { x: 1.4, z: 0.4 },
    ],
  },
};
