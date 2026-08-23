# The level format

A level is a **data file**. There is one generic builder per archetype, and
a new sketch becomes a new file in `src/world/levels/` and nothing else.

If you are here to move a crate, change how far the horde spawns, make the
field bigger or swap a house for a rock, everything you need is in one file
and you can edit it yourself. You do not need to touch any builder code.

The test that this is true: **hand over a new sketch, get back a playable
level, with only a data file written.**

- `src/world/levels/L1.js` is the worked example used throughout this
  document. Read it alongside this file.
- `src/world/levelkit.js` is the prop library and the build sequence.
- `src/world/holdout.js` is the holdout frame (the base).
- `src/world/levels/index.js` maps a floor number to its spec.

---

## Adding a level

1. Write `src/world/levels/L7.js` exporting one object (copy the closest
   existing level and change the numbers).
2. Add it to `SPECS` in `src/world/levels/index.js`:
   ```js
   import { L7 } from './L7.js';
   export const SPECS = { 1: L1, 7: L7 };
   ```
3. Make sure `LEVEL_TYPES` in `src/world/levelgen.js` gives that floor a
   type string matching the archetype.

That is the whole procedure. The game validates the file on load and
refuses to start if it describes an unplayable level, with a message
naming what is wrong (see **Validation** below).

---

## The shape of a spec

```js
export const L1 = {
  id: 'L1',                  // used in error messages
  name: 'THE FIELD',         // shown on the arrival card and the wrist
  note: 'Nowhere to run. Hold the base and watch the haze.',
  archetype: 'holdout',      // decides which frame builds it

  world: { ... },            // the field: light, ground, props, nav bounds
  spawns: [ ... ],           // where the horde comes from
  barrels: [ ... ],          // explosive barrels out in the world
  base: { ... },             // the frame: holdout levels have a base
};
```

A level has exactly **one frame**: `base` for a holdout, `route` for a
traverse. Having both, or neither, is a validation error.

---

## `world`

```js
world: {
  size: 80,                  // the field, edge to edge, in metres
  waveLabel: 'WAVE',         // the word the HUD uses. Surface levels never
                             // go dark, so they say WAVE, not NIGHT
  drone: true,               // false underground: the drone cannot fly there
  mapExtent: 50,             // optional; defaults to size * 0.62

  ground: { material: 'sandGround', size: 420, y: -0.02 },
  ceiling: { material: 'basementWall', height: 3.2 },   // interiors only

  light: {
    daylight: true,          // true = waves happen in daylight, sun just
                             // drops lower as they climb
    sky: 'daySky',           // a PALETTE key or a 0xRRGGBB number
    haze: 'dayHaze',
    fogNear: 26, fogFar: 96, // where the world starts and finishes fading
    sun: 2.4, hemi: 1.0,
    dark: false,             // true = the sky stops mattering, torches on
  },

  nav: { minX: -52, maxX: 46, minZ: -52, maxZ: 44 },
  props: [ ... ],
}
```

### `nav` deserves a warning

The navigation grid must cover **every spawn point and the whole walkable
area**. If you leave it out it is derived from the geometry, which is fine
for a compact level and wrong for a big one: a derived box moves the moment
you add a prop.

Anything outside the grid is off the map to the pathfinder. Zombies
spawning there **never find a route in**, the wave counter sticks at
"1 left" forever, and the level cannot be finished. This has happened. If
you widen a field, widen `nav` with it.

### Fog is a game mechanic, not a look

`fogNear` should start past the base so the base itself is always crisp,
and `fogFar` decides how much of the approach you can see. On a holdout
level the fog is what hides the spawns and makes the horde *emerge* rather
than *appear*.

---

## `props`

A list, built in order. Each entry names a prop from the library and gives
its parameters:

```js
{ prop: 'ruinedHouse', id: 'house', x: 8, z: 26, rot: -0.25, note: 'HOUSE, south' }
```

- `prop` the library name. An unknown one is a validation error that lists
  the valid names.
- `id` optional, but **required if a spawn hides behind it**. It is the
  word the debug overlay prints when it tells you where something came
  from.
- `note` free text for the human reading the file. Use it to tie the entry
  back to the sketch.

### The library

Sight blockers and world dressing:

| prop | parameters | what it is |
|---|---|---|
| `road` | `x, z, width, length, rot` | a flat strip, no collision |
| `ridge` | `x, z, len, height, rot, gapAt, gapW` | a rolling line of hills |
| `loneTree` | `x, z` | a dead tree |
| `bigRock` | `x, z` | a scatter of boulders |
| `burntCars` | `x, z` | three wrecked cars |
| `ruinedHouse` | `x, z, rot` | walls, window holes, broken roofline |
| `container` | `x, z, rot, colour` | a shipping container |
| `crashBarrier` | `x, z, len, rot` | a run of barriers, some knocked flat |
| `pylons` | `x, z, dx, dz, count` | telegraph poles marching away |
| `busWreck` | `x, z, rot` | a burnt-out bus |
| `pipeMound` | `x, z, rot` | concrete pipes and rubble, compact |
| `skyline` | `count, radius, ...` | the far city silhouette |
| `scatter` | `count, around, minR, maxR, size, colour` | debris |

Interior and shared:

| prop | parameters | what it is |
|---|---|---|
| `platform` | `x, z, w, d, height, ramp, material` | a raised platform with a ramp |
| `railing` | `x, z, w, d, material` | a rail along a platform edge |
| `cover` | `x, z, w, d, height, material` | chest-high cover: blocks walking, not shooting |
| `sandbags` | `x, z, count, step, w, d, height, hx, hz` | a run of sandbag stacks |

### `gapAt` on a ridge

A long ridge is a wall, and a wall is a detour. A 34 m ridge forces a 40 m
walk around it for anything spawning behind it, which is far enough that
the pathfinder gives up and the horde drifts instead of arriving. `gapAt`
cuts a pass through it, measured in metres along the ridge from its centre.
It reads better too: they funnel through it, in view.

### Compact props make better cover

A spawn is placed on a ray at a fixed distance (see below). That works for
a compact blocker and fails for a long one: a spawn 14 m out along the ray
to a 9.5 m bus can land *inside* the bus. Use `pipeMound`, `bigRock` or
`container` for close cover, and save the long props for the middle
distance.

### Prop order is a contract

Props are built in array order, and three of them draw from the level's
random number generator: `burntCars`, `skyline` and `scatter`.

Every player builds the level **locally** from the same seed. Nothing about
the geometry is sent over the network. So if two players run code where
those props are in a different order, they get different fields, and the
game desyncs. **Add new props that use randomness at the end of the list.**

---

## `spawns`

```js
spawns: [
  { behind: [-4, -15], dist: 14, from: 'pipes', ring: 'near' },
  { behind: [6, -34],  dist: 42, from: 'ridge', ring: 'far'  },
]
```

A spawn is described by the thing it hides **behind** and how far out it
sits. The position is derived: on the base-to-blocker ray at `dist`. That
keeps it hidden and keeps it at the intended range, both of which typed
coordinates stop being the moment you move a prop.

- `behind` the `[x, z]` of a prop in `world.props`. Must match a prop's
  position within 0.6 m or it is a validation error.
- `dist` metres from the base. Must be at least 3.5 m past the blocker,
  or the spawn is *inside* it rather than behind it.
- `from` the prop's `id`, used in messages and the debug overlay.
- `ring` `near`, `mid` or `far`.

You can also give `x` and `z` directly for a spawn with no blocker to
reference, but then it is on you to keep it hidden.

### The rings

| ring | band | what it is for |
|---|---|---|
| `near` | 11 to 17 m | something is on you in about ten seconds, so the level opens fast |
| `mid` | 22 to 30 m | the working distance, where most of the fight happens |
| `far` | 38 m and out | the ones you watch gather out of the haze, and dread |

Wave 1 draws entirely from the near ring. Later waves widen out. Populate
all three: one distance is a parade, mixed distances are a fight.

The long walk is only tension **if the player can act during it**: shooting
at range, sending the drone out, choosing which lane to reinforce. If there
is nothing to do while they walk, it is waiting.

---

## `base` (holdout frame)

```js
base: {
  at: { x: -13, z: -11 },
  size: 8,
  wall: { hp: 120, height: 0.95 },
  lift: { corner: 'southwest', inset: 0.24 },
  roomscale: { x: -0.2, z: 0.4 },
  interior: [ ... ],          // FRAME-LOCAL coordinates
  barrels: [ ... ],           // FRAME-LOCAL
  playerSpawns: [ ... ],      // FRAME-LOCAL, [0] is the host
}
```

`interior`, `barrels` and `playerSpawns` are all **relative to `at`**, so
you can move the whole base by changing two numbers.

- `wall.height` should stay low enough to shoot over from the ground
  (0.95 m). The snipe platform is then a choice about sightlines, not the
  only place you can fight from.
- `wall.hp` is per one-metre segment. The whole perimeter is one
  InstancedMesh, so a broken wall costs no extra draw calls.
- `lift.corner` is `northwest`, `northeast`, `southwest` or `southeast`.
  The lift plate's position and facing both derive from the base; it is
  never placed independently.

### Leave no slot the width of a player

The single most damaging mistake in this format: a gap between two solids
narrower than the player's diameter (about 0.64 m) **pins the player in
place**. Both colliders push, the pushes cancel, and they cannot move at
all. It has shipped twice.

The rule: props near a wall are **flush against it**, or a clear two metres
away. Never 0.8 m off.

---

## Validation

The spec is checked when the level is built, and a bad spec **throws**
rather than producing a quietly broken level. A spec error is identical on
every player's machine, so it is a programming error, not a runtime
condition.

Checked before anything is built:

- unknown archetype, or both/neither frame
- unknown prop names, missing required parameters, unknown material or
  colour names
- a spawn with no `behind` and no `x`/`z`
- a spawn whose `behind` names a position with no prop there
- a spawn less than 3.5 m past its blocker (it would be *inside* it)
- a spawn outside the distance band for its `ring`

Checked after the geometry exists:

- a spawn that has ended up inside a prop it was not aiming at
- a spawn with **no route** to the squad, by exact flood fill rather than a
  pathfinding query, because a long way round can exhaust a search budget
  and report a good route as a wall
- anything standing in the lift's boarding zone

The messages say what to change, not just what is wrong. For example:

```
levelkit: L1 is not playable
  spawn 3 ("depot") at 10.8,-0.4 has NO route to the squad. Anything
  spawning there can never be killed, so the wave counter sticks and the
  level cannot be won. Open a way round, or move the spawn.
```

---

## Checking a level you have edited

```
node test/holdoutprobe.mjs     # rings, routes, pockets, boarding, the base
node test/rampprobe.mjs        # ramps are solid from every approach
node test/navprobe.mjs         # nothing freezes
node test/smoke.mjs            # everything still boots
```

The one to watch is the **pocket test**: it floods the playable area with a
player-sized agent and reports every unreachable island big enough to stand
in. If it fails, you have made a slot somebody can be trapped in.

---

## What this format cannot express

Deliberately, so that the limits are visible rather than discovered:

- **Anything animated or scripted.** Moving platforms, doors on timers and
  set pieces are frame mechanism, not data.
- **Anything conditional.** A spec is a static description; it cannot say
  "if two players, add a gate".
- **Custom geometry.** If a sketch needs a shape the library does not have,
  the shape becomes a new prop in `src/world/levelkit.js`, available to
  every level from then on. That is the intended way to grow.

The escape hatch, for the rare thing that does not fit:

```js
after(level, ctx) {
  // arbitrary code, run last, with the built level in hand
}
```

Reach for it seldom. Every use is a piece of a level that lives outside
the format, and the point of the format is that a sketch does not need one.

## Working on a sketch

- `docs/sketching.md` is the answer to "what is cheap and what is
  expensive", written for deciding BEFORE you draw.
- `?levelpreview=N` is a labelled top-down diagram of floor N.
- `?hot=1` rebuilds the current floor when its data file changes, without
  restarting the run.
- `?levelpreview=N&hot=1` is the loop for tuning a layout: a diagram that
  redraws itself while you edit the numbers.

A broken data file is reported and the last good level keeps standing, so
editing with the game running is safe. The spec validator runs on every
hot reload exactly as it does on load, which means a typo in a prop name
tells you the entry index and the level you were playing is untouched.
