// L2 - THE UNDERWORKS. Archetype TRAVERSE, built to Ola's sketch L2.
//
// THIS FILE IS DATA. See docs/level-format.md.
//
// You arrive on the plate in the north-west corner and must reach the lift
// in the south-east. Between them: an antechamber whose only way out is a
// door you have to stop and open, and a chasm that splits the rest of the
// room into a west route and an east route.
//
// SIZE. The sketch says "10x10 m map size". Built at 10 m, a 5x4 chasm
// leaves a walkable ring under two metres wide, which is not enough for
// four players and a horde in the same corridor. This ships at 13x13 with
// the sketch's proportions kept. `route.size` is the dial: say the word
// and it goes back to 10.
//
// DARK ON PURPOSE. The whole campaign rhythm is daylight holdouts against
// dark traverses, so this level has no sun at all and the flashlight in
// your off hand finally has a job.
export const L2 = {
  id: 'L2',
  name: 'THE UNDERWORKS',
  note: 'Get to the far corner. Nothing here is holding still for you.',
  archetype: 'traverse',

  world: {
    size: 13,
    waveLabel: 'PUSH',        // waves come because you advance, not on a clock
    // "The drone is not usable underground: state that in the fiction and
    // in the UI, so its absence reads as intentional." (level-design.md)
    drone: false,
    mapExtent: 11,

    ceiling: { material: 'basementWall', height: 3.1 },

    light: {
      daylight: false,
      sky: 'nightSky', haze: 'nightHaze',
      fogNear: 4, fogFar: 22,
      sun: 0, hemi: 0.28, dark: true,
    },

    // A tight room, but the horde still has to path the whole way round
    // the chasm, so the grid covers the room plus a margin.
    nav: { minX: -9, maxX: 9, minZ: -9, maxZ: 9 },

    props: [],
  },

  // Zombie spawns come from the holes, which the frame registers itself.
  spawns: [],
  barrels: [{ x: 4.2, z: -2.0 }],

  route: {
    at: { x: 0, z: 0 },
    size: { w: 13, d: 13 },

    // FRAME-LOCAL from here down: (0,0) is the middle of the room.

    // The antechamber. A wall running south from the north wall, and one
    // running east from the west wall, so the only way out of the corner
    // you arrive in is through the door.
    walls: [
      // The north-south wall east of the arrival plate, in two pieces with
      // the door in the gap. The sketch draws the door on THIS wall, and
      // it has to be: with it in the east-west wall instead, the
      // antechamber was sealed on all four sides and the level could not
      // be started, let alone finished. The build-time validator caught
      // that before it was ever played.
      { x: -1.4, z: -5.7, w: 0.3, d: 1.6, note: 'north-south, upper piece' },
      { x: -1.4, z: -2.25, w: 0.3, d: 1.7, note: 'north-south, lower piece' },
      // The east-west wall, closing the antechamber's south side.
      { x: -3.95, z: -1.4, w: 5.1, d: 0.3, note: 'east-west, from the west wall' },
      // The FENCE from the sketch: it seals the direct east route past the
      // chasm, so the east side has to be reached the long way round.
      // The FENCE. It does NOT seal the east corridor: a fully sealed
      // fence turns the whole east side into a dead end reachable only the
      // long way round, and the build-time route check rightly refused it.
      // It leaves a squeeze between its west end and the lip of the chasm,
      // which is a better obstacle anyway: you can take the fast route
      // east, but only by walking the edge of the hole.
      { x: 5.4, z: 0.8, w: 2.0, d: 0.25, note: 'FENCE, east side, squeeze at its west end' },
    ],

    // Slide door with a button, in the gap between the two antechamber
    // walls. This is the "moment of standing still and defending" the
    // design doc asks for: holding the button takes time, and the holes
    // are already open.
    doors: [
      {
        x: -1.4, z: -4.0, width: 1.8, along: 'z',
        // The button is on the ANTECHAMBER side (you open the door from
        // where you are), and OFFSET ALONG THE WALL rather than parked in
        // front of the opening. Directly in front, its post narrowed the
        // doorway until nothing could path through it and the level was
        // unfinishable, which the build-time check caught.
        button: { dx: -1.1, dz: -1.6 },
        label: 'HOLD TO OPEN THE DOOR',
      },
    ],

    // CHASM: middle-south, splitting the room into a west route and an
    // east route. You fall in and you do not come back.
    // Sized so the corridors around it stay walkable once every wall and
    // prop is inflated by an agent radius. The first version left a 0.35 m
    // slot along the south wall, which sealed the whole east side off: the
    // build-time route check refused to ship it.
    chasm: { x: 0.0, z: 2.3, w: 5.2, d: 2.8 },

    // Zombie entrances, all visible holes. Two in the east wall (one above
    // the fence, one below it) and one in the south wall toward the west,
    // so pressure comes from both routes and from behind.
    holes: [
      { x: 6.5, z: -3.6, along: 'z', id: 'east breach', inward: -1, width: 2.0 },
      { x: 6.5, z: 3.4, along: 'z', id: 'lower breach', inward: -1, width: 2.0 },
      { x: -3.6, z: 6.5, along: 'x', id: 'south hole', inward: -1, width: 2.2 },
    ],

    interior: [
      // Cover, kept out of the two routes around the chasm.
      { prop: 'cover', x: -5.9, z: -5.9, w: 0.9, d: 0.9, height: 0.85, material: 'crate', note: 'antechamber corner, flush' },
      { prop: 'cover', x: 2.0, z: -5.9, w: 1.1, d: 0.9, height: 1.0, material: 'crate', note: 'north strip' },
      { prop: 'cover', x: 5.4, z: -5.9, w: 0.9, d: 0.9, height: 0.8, material: 'crate' },
      { prop: 'cover', x: -5.9, z: 1.2, w: 0.9, d: 1.4, height: 1.0, material: 'crate', note: 'the west route' },
      { prop: 'cover', x: -5.9, z: 5.4, w: 1.2, d: 0.9, height: 0.9, material: 'crate' },
      // Thin and FLUSH against the south wall. At 0.7 deep and 10 cm off
      // it, these two and the chasm between them left exactly one blocked
      // grid row across the south corridor, which sealed the entire east
      // side off. Depth is not decoration in a corridor this tight.
      { prop: 'cover', x: 0.8, z: 6.1, w: 1.3, d: 0.5, height: 1.0, material: 'crate', note: 'south, flush' },
      // The weapon locker, in the same room as the exit lift, as the
      // design doc asks. It is cover you can also buy from.
      { prop: 'cover', x: 3.0, z: 6.1, w: 1.5, d: 0.5, height: 1.15, material: 'metalShell', note: 'WEAPON LOCKER, flush by the exit' },
    ],

    // Arrive north-west, leave south-east. That diagonal is the level.
    spawnPlate: { x: -4.4, z: -4.4 },
    exitPlate: { x: 4.9, z: 5.2 },

    playerSpawns: [
      { x: -4.4, z: -2.6 },
      { x: -3.2, z: -3.4 },
      { x: -5.4, z: -3.0 },
      { x: -2.9, z: -5.2 },
      { x: -5.4, z: -5.0 },
    ],
  },
};
