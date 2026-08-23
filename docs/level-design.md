# LEVEL DESIGN - the rebuild (from Ola's sketches, 2026-08-23)

This document supersedes the "every level is a floor of a high rise"
concept. It comes from Ola's hand sketches after playtesting v0.9.3 and
it is now the authority on level structure. Where this conflicts with
docs/vision.md, this wins; update vision.md to match.

## Why the high rise is being dropped

The high-rise conceit never became real fiction. The elevator ended up
outside the building with no floors above it, upper floors had no
believable enemy source, and every level collapsed into "wave defense in
a box" because the level was generated to fit the physical play area.
The playtest verdict was boring, samey and unconvincing, and the cause
was structural, not cosmetic.

The elevator survives as the transition device between levels: a metal
platform inside the base that becomes the lift once the area is cleared.
It keeps its jobs (rebuild the world, run the shop, re-centre roomscale
VR) without pretending to be a building.

## The two level archetypes

The campaign alternates between them. Alternation is the point: one
archetype is about digging in and holding, the other is about moving
forward under pressure. Neither is fun on its own for long.

### Archetype A: HOLDOUT (Ola's sketch L1)

An open outdoor field, roughly 60 to 80 m across. Daylight, haze,
long sightlines. The squad's base sits in the middle and is SMALL,
about 5x5 m to 8x8 m.

The base contains:
- Low wall plus sandbags around the perimeter: you can see and shoot
  over it, zombies must break through or climb it
- Crates and random junk as interior cover
- A raised platform or ramp position for one player to shoot from
- The metal plate that becomes the elevator when the area is cleared
- Player spawn points (up to 4)

The field contains, at distance:
- Fog or haze that hides the far ground
- Houses, rocks, ridges, burnt-out cars, a lone tree: sight blockers
  that zombies emerge from and disappear behind
- A far "wall" of city buildings as a backdrop texture for depth
- Zombie spawn points out in the field, always behind a sight blocker,
  never in the open and never within view of the base

Rules that make this archetype work:
- **Players cannot leave the base.** This is deliberate, not a bug. The
  low wall is the boundary. It is what makes the drone matter and what
  makes a roomscale VR play area match the base footprint exactly.
- **The base can be damaged.** Zombies attack the wall and the sandbags,
  not only the players. Breaches open up and can be repaired during the
  day. Losing the base is a fail state alongside losing the players.
- **You see them coming.** Long approach from the fog is the whole
  tension. Never spawn a zombie close to the base.
- Difficulty comes from approach angles, sight blockers and mixed enemy
  types, not from cramped space.

### Archetype B: TRAVERSE (Ola's sketch L2)

A route, roughly 10x10 m to 20x20 m of connected space. You spawn in one
corner and must reach the exit in the opposite corner to win. Underground
or interior, therefore dark: this is where the flashlight and the
claustrophobia live.

Contains:
- A spawn point at the entrance (arriving from the previous level)
- A hazard that shapes the route: a chasm you must go around, a fence,
  a collapsed section
- At least one door that must be opened, ideally with a button or a
  lever, so there is a moment of standing still and defending
- Zombie entrances along the route: holes in walls, holes in the ground,
  all visible and readable, never spawning from nothing
- A weapon locker to buy from, ideally in the same room as the exit lift
- The exit: the lift or hatch that takes the squad up to the next level

Rules:
- Movement forward is the objective, not survival timers. Waves come
  because you advance, not because a clock ticks.
- Darkness here is a feature. The contrast with the daylight holdout
  levels is the emotional rhythm of the game.
- The drone is not usable underground: state that in the fiction and in
  the UI, so its absence reads as intentional.

## Campaign structure

Alternate, with the surface levels changing character as you go:

1. HOLDOUT, open field, daylight. The tutorial holdout.
2. TRAVERSE, underground, dark. Get to the far corner.
3. HOLDOUT, but you emerge somewhere new: a rooftop, a walled yard, or
   inside a house shooting out through windows. Same archetype, new
   silhouette and new sightlines.
4. TRAVERSE, longer, with more doors and a real hazard.
5. HOLDOUT, harder: more approach lanes, night, or fog that hides more.
6. Boss level: the BUTCHER, in an arena that is a holdout with one huge
   threat instead of many small ones.
... and so on, ending in a real finale with a win state.

Emerging in a NEW place after every traverse level is what sells the
journey. The player should feel they are travelling across a landscape,
not riding a lift in one building.

## What this fixes

- **The drone gets its purpose back.** On holdout levels the player is
  confined to the base, so the drone is the only way to place mines and
  traps out in the field. That was always the intent. Price it as a
  core tool, not a luxury: it must be affordable and it must clearly do
  something. Add more trap types for it to place.
- **Roomscale VR becomes coherent.** The 5x5 m base IS the play area.
  Walking the base physically is the whole VR experience on holdout
  levels; traverse levels use stationary locomotion.
- **Day and night get their meaning back.** Surface is bright, under is
  dark, and the alternation gives the game a rhythm.
- **The upper-floor fiction problem disappears.** No more unexplained
  zombies on floor 8.

## Foundation bugs that must be fixed first

These will ruin any level design, so they come before or with the
rebuild:

1. **Enemy navigation is broken.** Zombies get stuck, jitter in place,
   walk into geometry and cannot get out, and are trivially harmless.
   This is the single biggest threat to the whole game: dumb enemies
   mean no tension regardless of how good the level is. Implement real
   navigation (a navigation grid over the level with proper pathfinding,
   plus separation between agents so they do not clump and jam). Enemies
   must route around obstacles, find breaches, and never freeze.
2. **Ground and collision ignore height.** Players can walk up and down
   the sides of a ramp as if the world were flat, and cannot step onto
   the ramp's last step. Ground height must be sampled properly, with
   step-up limits, slope limits and a real fall when there is nothing
   underneath. Ola described it as "no gravity, absence of natural
   laws", which is exactly right and will break every level with
   verticality.
3. **VR weapon aim is 45 degrees off.** The pistol points up and away
   from the controller's forward axis, so shots do not go where the
   player aims. Fix the weapon-to-controller transform and verify in
   headset.
4. **Reload needs a readable animation**, still missing.
5. **The elevator sometimes faces the wrong way**, so players cannot
   enter it. With the rebuild it becomes the base's lift plate, so
   orientation must be derived from the base, not placed independently.

## Build order

1. Foundation bugs 1 to 3 (navigation, ground and collision, VR aim).
   Nothing else matters until enemies are dangerous and movement is
   honest.
2. One HOLDOUT level built to the sketch, played, iterated until it is
   genuinely fun on its own. Do not build six levels of something that
   has not been proven fun once.
3. One TRAVERSE level, same treatment.
4. Then the campaign: more variants of each archetype, the boss, the
   finale, the win state.

Ola can sketch further levels on request. Ask for a sketch rather than
inventing layouts when a level's shape is unclear.
