# CHANGELOG - ZOMBIE HIGH RISE

## v0.11.1 - 2026-08-23 - the two blockers from Ola's L1 playtest

**"Level 1 is unbeatable, a zombie spawns and cannot make it to the base."**
The navigation grid was still a 34 m box around the world ORIGIN. The
holdout base is at (-13,-11) and its spawn points reach 46 m out, so
several spawns sat entirely off the grid: those zombies never found a
route in, the night's counter stuck at "1 left", and the run could not be
finished. The holdout now declares its own nav bounds covering the whole
field, and the A* node budget scales with the grid instead of being a
fixed 4000 (which a 45 m walk-in blew through on its own).

**"Not possible to enter the elevator, there is a box in the way."** Two
causes, both fixed:
- The cab was rotated to "face the centre of the base" while its collider
  stayed axis-aligned. The visible cab stuck out past its own collision,
  poked through the south wall, and the boarding zone landed half inside
  solid geometry. The lift is now axis-aligned, flush against the west
  wall, doors facing straight east into the base.
- A crate sat squarely on the floor in front of the doors. Interior cover
  is now laid out around two lanes that must never be blocked: the ramp
  up to the platform, and the floor in front of the lift.

Also closed a pocket beside the snipe platform where a player could
squeeze into a 0.8 m slot between the ramp and the east wall.

**New checks, so none of this can come back quietly**
- `debugSpawnRoutes()` - every spawn point must land on open ground and
  have a path that actually reaches the base.
- `debugBoarding()` - nothing may stand in the lift's boarding zone, and
  you must be able to walk to it from the middle of the base.
- The holdout probe now plays night 1 to completion. If a single zombie
  is walled in anywhere, the test fails instead of the player discovering
  it twenty minutes in.

## v0.11.0 - 2026-08-23 - THE FIRST HOLDOUT LEVEL

Floor 1 is now the holdout level from Ola's L1 sketch. The old high-rise
"ground" floor still exists further up the cycle; this is the one to play.

**The field.** An 80 m open daylight field with haze that hides the far
ground. Sight blockers laid out to the sketch: a ridge to the north, a
lone dead tree east, burnt-out cars south-east, a rock field south-west,
two ruined houses. Between them, mid-ground the horde actually crosses:
crash barriers along the road, shipping containers, telegraph poles
marching into the haze, a burnt-out bus. A low ring of city silhouettes
sits inside the horizon haze band for depth.

**Nothing spawns in the open.** All seven spawn points sit behind a sight
blocker, 28 to 46 m out. The horde emerges from the haze and walks the
whole way in, which is the entire tension of the archetype.

**The base.** 8x8 m, off-centre to the north-west as sketched. A low wall
you see and shoot over, sandbags along the threat side, crates inside, a
ramp up to a snipe platform, and the elevator plate in the south-west
corner with its doors facing the middle of the base (foundation bug 5:
the lift derives from the base, it is never placed independently).

**Players cannot leave the base.** Verified from the centre in eight
directions: the wall holds every time.

**The base can be destroyed.** Every wall segment has hit points and its
own collider. Zombies that cannot reach a player attack the wall instead;
segments visibly sink and redden as they are chewed, and a broken one
becomes a real breach the pathfinder routes through. Losing the wall
loses the run. Repair costs 5 scrap a go during the day (E, or the left
grip in VR), which finally gives the prep phase a job. The whole
perimeter is one InstancedMesh, so breaking it costs zero draw calls.

**The drone is a real tool.** It is no longer a scout that hovers and
pings: it is a delivery vehicle. Launching is free, you pay for what it
carries, and you watch the payload fly out and drop.
- MINE (10) - the proximity mine, now placeable anywhere in the field
- TAR (8) - a slick that cuts them to 38% speed for 100 s
- SPIKES (12) - a caltrop field grinding 9 damage a second
- FLARE (14) - a burning lure the horde walks toward instead of you,
  which is how a squad that cannot leave the base decides WHERE the
  wave dies
The drone button on the tactical map cycles the payload and shows the
price. Mines dropped from the map fell 26 -> 12: a staple, not a luxury.

**Fixes found while building it**
- Local-to-world rotation used the wrong sign, so every rotated prop had
  its sub-parts scattered off the body (wheels beside the car, ribs
  poking out of containers as spikes).
- The pathfinder treated ANY collider with a top as walkable, so it
  routed the horde straight through low walls and sandbag stacks. Only
  ramped platforms are walkable now; anything above step-up blocks.
- Zombies attacking the wall no longer count as stuck, which used to
  teleport them away after four seconds and left the base untouchable.
- The player-only boundary ring overlapped the wall. The two pushed
  against each other and pinned the player in place, unable to move.
- The snipe ramp ran straight through the elevator cab. The firing
  position moved to the north-east corner, above the sandbags on the
  threat side, and the lift keeps the west side to itself.
- `audio.play(name, pos)` threw on array positions ("non-finite value").
- Tactical map framed a fixed box at the world origin, which put an 80 m
  field mostly off screen. It now frames the level it is looking at.

**New verification**
- `test/holdoutprobe.mjs` - spawn distance, base pockets, ramp clearance,
  confinement in eight directions, wall damage, breaching, and repair.
- `test/droneprobe.mjs` - every payload delivered, drones fly home, and
  the flare measurably pulls the horde off the base.
- `window.__zhr.debugPockets()` - stand everywhere in the base and try to
  walk back to the middle. Any start that cannot is a trap. This is what
  found both pinning bugs above; run it on every new level.

Performance on the new field: 50 draw calls, 4.5k triangles with 22
zombies, against budgets of ~100 and ~250k.

## v0.10.2 - 2026-08-23

**Foundation bug 3: VR weapon aim was 45 degrees off.** The pistol pointed up
and away from where the shots went.

- WebXR reports two poses per controller. The GRIP pose is the hand (origin at
  the palm), the TARGET RAY pose is where the user is pointing. On Oculus
  Touch these differ by a large, controller-specific angle. The gun models
  hung off the grip while shots fired along the target ray, and that gap WAS
  the bug.
- The angle is no longer guessed: the live rotation between the two poses is
  read each frame and cancelled out, so the gun sits in the hand and points
  exactly along the shot. Works on any controller, not just Touch.
- Shots, tracers and muzzle flash now leave the barrel tip instead of the
  wrist, with a per-weapon muzzle length.
- Held auto fire uses the same barrel ray, so a burst no longer drifts away
  from the first shot.
- Verified by `test/vraimprobe.mjs` with fake grip poses at +45, +60 and -30
  degrees: the gun was 47.5 / 61.5 / 34.2 degrees off the aim, now 0.00.

## v0.10.1 - 2026-08-23

**Foundation bug 2: ground and collision ignored height.** Ola: "no gravity,
absence of natural laws."

- NEW `src/game/locomotion.js`: a real character controller. `groundHeight()`
  samples terrain, ramps and the tops of solid boxes, constrained by how high
  the mover can currently reach. `moveAndCollide()` resolves horizontal
  movement axis by axis, then decides: rise within step-up climbs, a bigger
  rise is a wall, a small drop walks down, a big drop falls with gravity.
- `blockingFor()` fixes "cannot step onto its last step": a platform you are
  tall enough to step onto must not push you out horizontally. Its own
  collider used to eject the player at the exact moment they arrived at the
  edge. Players climb the full 2.4 m watchtower ramp now.
- Real falling: walk off an edge and you fall. Fall out of the world and you
  respawn at the level spawn with 45 damage and a "You fell." toast.
- Zombies use the same ground and the same steppable rule, so they can follow
  the player up a ramp instead of orbiting its base.
- Verified by `test/groundprobe.mjs`: Y goes 0, 0.2, 0.6, 1.0, 1.4, 1.8, 2.2,
  2.4 in clean steps. Smoke test green, navprobe still 0 frozen.

## v0.10.0 - 2026-08-23 - THE REBUILD begins

Direction change from Ola's v0.9.3 playtest, captured in the new
docs/level-design.md (now the authority on level structure) and his two
sketches in docs/sketches/. The high-rise concept is dropped: it never
became real fiction, and every level collapsed into wave defense in a box
because levels were generated to fit the physical play area.

Two alternating archetypes replace it:
- HOLDOUT: a small base (5x5 to 8x8 m) in a big open daylight field
  (60-80 m). Players cannot leave the base; the base itself can be
  damaged and lost. Zombies cross open ground from behind distant sight
  blockers, so you always see them coming.
- TRAVERSE: a dark underground route 10x10 to 20x20 m, spawn in one
  corner, reach the exit in the other. Moving forward is the objective.

Later: RIDE maps (the squad on a moving vehicle).

The elevator survives as the transition device only: a metal plate inside
the base that becomes the lift when the area is cleared, keeping its
three jobs (rebuild the world, run the shop, re-centre roomscale VR).

docs/vision.md and docs/projectplan.md updated to match.

## v0.9.3 - 2026-08-23 - Ola's playtest pass

Everything here comes from real playtest feedback, which outranks every
critic agent. Fixed in the order given: root causes first.

ROOT CAUSE 1 - the play area was driving the whole world (v0.9.0)
- Levels are now a fixed generous 34 m on every platform. The physical
  play area ONLY decides where the roomscale zone is painted, and
  roomscale VR re-centres onto that patch. Shoot far, walk near.
- No more square rooms. New src/world/kit.js builds every level from
  walls, chest-high cover, ramped platforms, railings and corridors:
  the ground compound has three gates, inner buildings and a watchtower;
  the basement is a boiler maze with a spine corridor and a maintenance
  deck; the upper floor is offices around a corridor ring with a
  mezzanine and a balcony; the trench has four lanes, connectors and
  firing steps; the wagon is three cars joined by gangways; the boss
  arena has a gantry ring and cover pillars.

ROOT CAUSE 2 - the day phase was dead time (v0.9.1)
- First zombie now arrives 1.6 s after START (was ~50 s).
- Daylight raids trickle in all day through the same visible entrances,
  so the game is no longer night-only and finally matches the "zombies
  in daylight" art direction.
- Day 45s->22s (first day 8s), countdown 5s->3s, plus an anti-dead-air
  guard that pulls the next beat forward when nothing is happening.
  Measured: 0 of 60 sampled seconds with nothing to fight.
- Prep made meaningful: mines 50->18 scrap, map placement 65->26, and
  players start with 2.

ROOT CAUSE 3 - upper floors had no fiction (v0.9.0)
- Enemies never appear from thin air. Every entry has a VISIBLE source:
  a stairwell head with steps going down out of sight, an open elevator
  shaft with bent doors and a dangling cable, wall breaches with rubble
  spill, facade climbs with bent railing and a hanging cable, gates and
  trench tunnel mouths.

COMBAT FEEL (v0.9.2)
- Right click aims down sights (tighter spread, narrower FOV, slower
  turn); Shift is the ADS modifier so dual pistols can still aim.
- Dual pistols alternate: left button fires the left gun, right the
  right, each with its own cooldown, kick and muzzle side.
- Headshots: real head spheres per enemy type, 2.5x damage, amber
  HEADSHOT callout, distinct sound, blood at head height.
- Reload animation on EVERY weapon.
- Elevator doors open whenever a player is near the cab, in any phase.
- Open edges that only let you walk OUT are sealed with player-only
  barriers the horde still walks through.

DIFFICULTY AND TENSION (v0.9.3)
- Steeper ramp, tighter cadence, harder bites, alive cap 20->24, depth
  roster arriving earlier.
- Every floor announces its own identity and carries a scripted twist.
- Measured with a kiting bot: night 1 survivable at full HP, night 5
  kills it in 68 s, night 9 in 54 s at the cap.

Also: interiors lit so they read, tactical map sees past ceilings and
suspends fog. Perf holds at 44 draw calls / 5.1k triangles with 24
zombies.

## v0.8.2 - 2026-08-23 (run wrap-up)

Budget-driven landing: critic loops stopped, ending shipped. Why: the
account hit its monthly spend limit; the goal became a finishable game
rather than a perfect one.

- Placeholder purge on the critical path: consistent shop labels
  (OWNED/FULL states, dot separators), readable purchase toasts instead
  of raw item keys, HUD markup defaults matching the live formats, and
  a shop status line that names the floor you are heading to.
- README rewritten for a finished project (play, deploy, develop, files).
- TEST-ON-DEVICE.md rewritten around the full 12-floor run.
- Performance gate: 61 draw calls / 3.8k triangles with 16 zombies alive
  at VR quality (budgets ~100 calls, ~250k triangles).

## v0.8.1 - 2026-08-23

- Explosive barrels: red drums near the level entrances, 2 hits to pop,
  4 m blast that chains to nearby barrels, throws corpses and hurts you
  if you stand too close. Grenades set them off too.
- FIXED: night modifiers never actually applied for the host (the
  host-side wave mirror dropped the `mod` field, so fog/blackout lighting
  and the announcement never fired). Verified: fog, frenzy, blackout and
  harvest all roll across nights 3-14.
- forceNight is now robust from any non-terminal phase (test hook).

## v0.8.0 - 2026-08-23

THE ENDING. The run can now be won.

- A run is exactly 12 floors. Floor 12 is the Butcher's arena (dawn-lit
  roof slaughteryard with cover pillars and its own barrels).
- Killing the Butcher on the final floor triggers the ROOF FINALE: a
  helicopter flies in from the west, hovers with a searchlight while the
  survivors hold the roof, then lifts away and the run is WON.
- Victory screen (EXTRACTED) with nights survived, kills and unspent
  scrap; RUN IT AGAIN starts a fresh run on a newly seeded building.
- Anyone still downed is pulled aboard at the finale (no one is left).
- Meta progression records extractions; the menu line shows them.
- Verified end to end by test/endingprobe.mjs.

## v0.7.0 - 2026-08-22 22:40

Phase 3 pass 2: the critic loops begin. Why: visual critic round 1 scored
2-3/10 everywhere; Ola added the feel-critic loop to the plan.

- Visual round 2 (from critic round 1 fix lists): procedural canvas
  textures everywhere (sand, concrete, sandbags, planks, plaster, worn
  metal, dirt) with world-space UV scaling so tiling matches across all
  wall sizes; gradient sky dome + sun glow + soft dust motes; lower warm
  sun with long shadows (desktop); ruins got broken rooflines, window
  holes and rebar; wrecked-car midground anchor; foreground debris ring
  and road tire tracks; upper floor window frames, light pools and
  baseboards; trench duckboards, support beams, rim sandbags and brighter
  flares; elevator fluorescent tube, glowing buttons, hazard sill; deep
  blue dark levels (never pure black); item pickups glow with ground
  rings; HUD skinned with amber accents and low-ammo colors.
- Performance gate work: static level geometry merges into one mesh per
  material; the entire horde renders as SEVEN instanced draw calls (any
  count) with per-instance accent colors, size variation and shadows.
  Levels now render at 11-28 draw calls.
- Feel systems (the new plan section): recoil kick with recovery, shotgun
  knockback shoves, hit markers (white tick, red on kill), screen shake
  on explosions (flat modes only, never VR), zombie limb pivots at real
  joints, corpse topple deaths.
- ?feelclip=1..6 deterministic scripted gameplay clips + capture tooling
  (test/feelcapture.mjs: Playwright video + frame strips per clip).

## v0.6.2 - 2026-08-22 21:15

Fixes from the 26-agent adversarial review of Phase 2 (21 confirmed
findings; scoreboard in QUALITY.md). Why: harden before the visual pass.

- CRITICAL: in half of all trench seeds the elevator's collider sealed the
  only lane connector, cutting the level in two; the first connector is
  now always on the east side, away from the elevator.
- Trench: connector openings now double as zombie routing waypoints (the
  horde can walk the serpentine hop by hop); SMALL/MEDIUM play areas get a
  compact straight-lane trench that actually fits the physical footprint.
- Grenades now bounce off walls instead of tunneling through them, and a
  molotov shatters on wall impact; molotov fire finally credits its
  thrower with scrap (it was the only weapon that paid nobody).
- Upper floor: everything beyond the walls now drops to street height, so
  grenades over the balcony burn down on the street instead of mid-air.
- Arrival day length is chosen from the INCOMING floor's type (the wagon
  got a 45 s day and the floor after it 10 s, reversed).
- Retry after a mid-night death no longer replays the level one night
  harder (off-by-one in the night rollback); per-attempt kill stats stop
  double-counting into the meta totals.
- Day loot now drops near player spawns on every level type (it landed
  beside the wagon and inside trench dirt).
- Client reload desync fixed (a stale snapshot could zero a freshly
  reloaded magazine and force a second reload); host now sees correct
  smoke/molotov tints in flight; fire/ping/drone/zombie visuals free
  their GPU buffers on removal (leak found in review).

## v0.6.1 - 2026-08-22 20:25

Phase 3 pass 1: soundscape + combat feel. Why: projectplan Phase 3 items
(audio, weapon feel, hit reactions).

- Full procedural WebAudio soundscape (no asset files, everything is
  synthesized): per-weapon gunshots, dry-fire, reload, machete whoosh,
  explosions, zombie hit/death/random groans (positional), player hurt
  and heal, pickups and purchases, pings, smoke hiss, molotov ignite,
  elevator doors, and minor/major synth stingers at night/day. Wind
  ambience outdoors, low drone in dark levels. Positional one-shots via
  equal-power panners; listener follows the camera; unlocks on the first
  gesture (iOS rule).
- Weapon feel: per-weapon recoil kick (flat modes), ejected shell
  casings with physics, viewmodel kick retained.
- Zombie hit reactions: torso flinch on hit; deaths now topple backward
  ragdoll-light and sink away instead of shrinking.

## v0.6.0 - 2026-08-22 19:40

Phase 2 complete: roles and depth. Why: projectplan Phase 2 items.

- Weapon roster v2: AK (heavy auto, 650 scrap), dual pistols (slot-1
  upgrade, both hands fire in VR), smoke grenades (slow cloud, 8 s),
  molotovs (burning patch, shatters on impact), night vision device
  (green light + grain overlay, 30 s battery, recharges by day; N key /
  NV button / left-stick press in VR). V / SWAP / right-stick press
  cycles the selected throwable.
- Scout drone from the tactical map (40 scrap): flies to the target,
  hovers 10 s, pings the nearest zombie every 2 s.
- New level types in a 6-floor cycle (ground, basement, upper, ground,
  trench, wagon): the TRENCH (serpentine night trench, flares, flashlight,
  tight lanes) and the WAGON (moving flatbed platform: scenery scrolls
  past, zombies vault in over the open ends, single night, no shop, the
  ride simply arrives).
- Meta progression in localStorage (versioned schema): best nights/floor,
  total kills, run count, veteran scrap bonus (+25 at 4 nights, +50 at 8)
  that each device brings to any room it joins; record line in the menu.
- Shop restyled as a two-column grid with the six new items.
- Smoke test now generates and renders all six level types.

## v0.5.1 - 2026-08-22 18:30

Fixes from the 35-agent adversarial review of Phase 1 (28 confirmed
findings, scoreboard in QUALITY.md). Why: harden the loop before Phase 2.

- CRITICAL: cross-browser desync killed: basement doors were shuffled with
  a random-comparator Array.sort (engine-defined order); doors are now
  fixed to the three non-elevator walls.
- CRITICAL: elevator boarding zones moved INSIDE the play footprint on all
  three level types (roomscale VR players could never physically reach
  them: guaranteed softlock on every ground floor). The basement cab moved
  to the solid north wall with its doors actually facing the room; cabs
  now also have colliders.
- CRITICAL: if the last standing player disconnects while teammates are
  down, the run now ends in game over instead of softlocking.
- Day loot no longer vanishes on floor arrival (it spawned against the old
  level and was wiped by the level switch).
- Upper-floor street spawns removed (they teleported to room height and
  floated at the windows, biting through the sill); street ambience
  returns as visuals in Phase 3.
- Zombies: bites now require line of sight (no chewing through walls),
  spawn jitter reduced so nobody spawns behind a wall, an 8 s stuck
  failsafe re-enters via a doorway, and the spawn timer no longer builds
  a backlog at the alive-cap that dumped the whole queue in one frame.
- Late joiners now land in the correct phase presentation (night lighting,
  open shop, gameover) via idempotent phase side effects; shop/gameover
  panels no longer pop over the connected-lobby of a client who has not
  pressed START.
- Client ammo counter no longer bounces on every shot; killed zombies no
  longer reappear as 120 ms interpolation ghosts.
- Tactical map: taps now work on touch devices (stick/look zones release
  the canvas), the map closes on level load/ride/gameover, and clicking
  during the shop no longer swallows the cursor into pointer lock.
- Entering VR while a join is connecting starts the game on welcome.
- Shop MINE button shows its real label and a FULL state; mine kills now
  pay scrap to the mine's owner.
- Photomode 2 and 6 now actually show their zombies. Zombie skin/pants
  materials shared across the horde (draw-call diet; full instancing
  lands in the Phase 3 performance pass).

## v0.5.0 - 2026-08-22 17:25

Phase 1 Pass D: mines, the tactical map and pings. Phase 1 core loop is
now feature-complete. Why: last Phase 1 projectplan items.

- Mines: buy in the shop (50 scrap, carry 3), hand-place during the day
  (T key, MINE flow on touch via the map, left grip squeeze in VR), 1 s
  arming, proximity trigger, 2.5 m blast that leaves a brute at 3 hp.
- Tactical map view (M key / MAP button, flat platforms): orthographic
  top-down live view with PING (free squad marker, 5 s) and MINE mode
  (remote placement for 65 scrap, the tactician premium).
- Ping markers render in-world for everyone (bouncing cone + ring).
- Shop is now modal (HUD hides during the ride; the overlap checker
  caught the collision on phone screens).
- HUD shows carried mines (G/P/M).

## v0.4.0 - 2026-08-22 16:40

Phase 1 Pass C: the elevator IS the shop. Why: projectplan elevator item.

- Elevator shop during the ride: shotgun, SMG, ammo refills, health packs,
  grenade pairs, priced from the tuning sheet; purchases validated by the
  host against each player's scrap; READY skips the timer when the whole
  squad readies up; downed players can still shop.
- Arriving on a new floor revives anyone still down (they rode along).
- Play-area size choice in the hosting panel (SMALL 3 m / MEDIUM 6 m /
  LARGE 12 m squares); the host's choice reaches every client, all level
  layouts adapt (clutter thins out, windows and walls rescale).
- VR re-centering on every floor arrival: the world rebuilds around the
  player's physical head position (the elevator trick).
- Smoke test now drives the full loop: two nights cleared, squad boards,
  shop on both peers, both arrive on floor 2.

## v0.3.0 - 2026-08-22 15:55

Phase 1 Pass B: the arsenal. Why: projectplan weapon roster v1 + gear.

- Weapons v1 with distinct feel from the tuning sheet: pistol (8-mag,
  infinite reserve), shotgun (6 pellets, one-shots walkers point blank),
  SMG (full auto, 30-mag), machete (one-swing walker/runner, +5 scrap
  melee bonus), frag grenades (3 s fuse, physics arc, falloff, thrower
  self-damage only).
- Host-authoritative inventories (owned weapons, mags, reserves, grenades,
  packs, scrap per player) with client-side prediction (arsenal.js).
- Reload per platform: R key, RELOAD button, VR grip squeeze. Auto weapons
  fire while trigger/button held on all platforms.
- Weapon switching: 1-4 keys + Q cycle, WEAPON button on touch, A button
  in VR; the active weapon's model shows on the flat viewmodel and both VR
  controller grips.
- Loot: day-phase supply drops and zombie drops (ammo, grenades, health
  packs) with pickup by proximity and toast feedback.
- Health packs heal 50, or instantly revive a downed teammate next to you.
- Explosion and muzzle VFX; other players' shots flash at their muzzle.
- HUD: weapon name, mag/reserve, grenade + pack counts, scrap.

## v0.2.0 - 2026-08-22 15:05

Phase 1 Pass A: the world and the loop skeleton. Why: projectplan Phase 1.

- Seeded level generator: ground (fortified base, wasteland sightlines),
  basement (dark room, pillars, doorway entries, flashlight), upper floor
  (window wall, balcony, street below). All peers build identical geometry
  from the seed in the welcome message; levels are never networked.
- Elevator cab (worn metal, sliding doors, interior lamp) on every level;
  doors open when the floor is cleared, the squad boards, the ride leads
  to the next floor.
- Horde: many zombies, three types with readable silhouettes and accents
  (walker rust, runner yellow lean, brute massive dark red).
- Wave director from the tuning sheet (game-design agent pass): threat
  budgets 1.25x per night, trickle + bursts, 2 nights per level, alive cap
  20 (Quest budget), co-op scaling.
- Day/night cycle with smooth sky/fog/sun lerp; night waves, day prep.
- Downed/revive (proximity revive, 4 s), game over + score screen, restart
  current level. Countdown and phase announcements on the HUD.
- Collision: players and zombies resolve against level colliders; hitscan
  is occluded by walls; zombies route through doorways/gaps.
- Flashlight (headlamp, F toggles, auto-on in basements).
- Tuning config in src/game/tuning.js with the design rationale inline.

## v0.1.1 - 2026-08-22 14:20

Fixes from a 33-agent adversarial review of the Phase 0 code (21 confirmed
findings, all addressed; scoreboard in QUALITY.md). Why: harden the steel
thread before real-device testing.

- Critical: the zombie froze forever after its first death (death timer
  went negative and was never reset).
- Session lifecycle: every session start now fully tears down the previous
  one; orphaned PeerJS peers from repeated HOST/JOIN, BACK from joining or
  fatal errors can no longer fire stale callbacks into a later game.
- Client LEAVE no longer shows a false "CONNECTION LOST" overlay
  (net.leave detaches callbacks before destroying the peer, and returning
  to the menu always clears the error panel).
- Broker-socket loss mid-game is no longer fatal: existing P2P connections
  keep playing, a toast explains that new joins are blocked, and the peer
  tries to reconnect to the broker.
- HOST A ROOM disables the menu and shows "contacting broker" while
  pending; double-clicks can no longer create parallel sessions or ghost
  players.
- Touchscreen laptops are desktop again (pointer:fine detection); they
  kept losing keyboard and mouse entirely.
- VR: entering VR from the lobby now starts the game (the 2D START button
  is invisible inside the headset); hand poses are mapped by actual
  handedness and only sent while tracked.
- Sim: the world only simulates while playing (no lobby bites); the zombie
  no longer melees through the sandbag wall while routing to a gap; floor
  height is consistent at the base edge.
- Photomode is now pixel-deterministic (animation no longer advances on
  wall clock) and the debug atlas leaves transparent blob shadows alone.
- Mobile: FIRE button no longer overlaps the ammo readout on notched
  phones. Join input only accepts characters the code alphabet produces.
- Client shows "connection stalled" when snapshots stop arriving
  (backgrounded host tab), per LESSONS.md.
- Smoke test: new regression check that a deliberate client LEAVE lands on
  the menu without an error overlay. All checks green.

## v0.1.0 - 2026-08-22 13:58

- Phase 0 steel thread built and smoke-tested green. Why: the project plan
  demands a playable line through everything before any polish.
- index.html with lobby state machine (boot, menu, hosting, joining,
  connected, playing; VR entry orthogonal), documented z-index scale
  (HUD 100, menus 200, overlays 300, debug 900), room code shown huge with
  copy button, locomotion choice (roomscale/stationary).
- Vendored pinned stack: Three.js r170 + PeerJS 1.5.4 in vendor/, import
  map, no CDN at runtime. Why: reproducible deploys, same-origin assets.
- PeerJS netcode: host-authoritative star, 4-char codes from the safe
  alphabet, id-collision retry, 20 Hz poses up / 15 Hz snapshots down,
  clients interpolate 120 ms behind. Protocol documented in
  src/net/protocol.js.
- One ground-level daylight world (fortified base, sandbag walls with
  firing gaps, wasteland backdrop), one zombie (walks in through gaps,
  attacks, dies, respawns), one pistol (hitscan, ammo, reload).
- Input layers: desktop WASD + pointer lock, mobile joystick + tap/FIRE
  button, WebXR entry button (local-floor, synchronous in click handler),
  stationary VR locomotion (smooth move + snap turn with head pivot),
  simple pistol models on controller grips.
- Photomode presets 1-9 incl. deterministic boot and the debug texture
  atlas (9); verified: no mirrored or flipped text.
- UI state gallery (?uistate=...) and test/smoke.mjs (Playwright: host +
  client contexts, join, two-way sync assert, VR button in hosting AND
  joined states, overlap checks at 3 viewport sizes, no console errors).

## v0.0.3 - 2026-08-22 11:33

- Added the arsenal to docs/vision.md: pistol, dual pistols, shotgun, SMG,
  AK-style rifle, machete, frag/smoke/fire grenades, health packs, night
  vision device, plus per-platform reload mechanics. Split into weapon
  roster v1 (Phase 1) and v2 (Phase 2) in the project plan. Why: Ola's
  spec of classic weapons and gear.
- Added named reference games (Arizona Sunshine, Left 4 Dead 2, CoD
  Zombies, Zero Latency style free-roam, classic rail shooters, Fallout
  for tone) to vision and wired them into the critic loop's side-by-side
  comparisons, with an explicit no-IP-copying rule. Why: named references
  make the critics far sharper than "AAA quality" alone.
- Wasteland tone added to art direction (sun-bleached ruins, scavenged
  improvised gear).

## v0.0.2 - 2026-08-22 11:17

- Renamed to ZOMBIE HIGH RISE, everything switched to English (docs, prompt,
  game UI). Why: the crew decided to run the whole project in English.
- Level design widened: the elevator now goes up AND down. Basement levels
  (claustrophobic), ground levels about every 3rd (shoot OUT of the base
  across open ground), upper floors (balconies). Why: only-indoors felt too
  claustrophobic.
- Added stationary VR mode (stick locomotion + snap turn) as a first-class
  mode; multiplayer now assumes players join from different homes. Quest 3
  explicitly supported. Why: only one headset locally, remote friends.
- Single-player VR calibration removed (not needed); co-located multi-VR
  moved to docs/TODO.md as a future mode. Why: simpler v1.
- Critic loop softened: caps per pass, QUALITY.md scoreboard,
  OPEN-QUESTIONS.md instead of stopping to ask; hard stops only at phase
  boundaries. Why: long autonomous runs must not stall waiting for Ola.
- Added lobby matrix requirement, UI state gallery (?uistate), z-index
  scale, and texture debug atlas (?photomode=9). LESSONS.md pre-seeded with
  the crew's previous real bugs (flipped textures, lobby host-vs-VR
  lockout, UI overlap). Why: these exact issues cost iterations before.

## v0.0.1 - 2026-08-22 10:42

- Kickoff package created (Ola + Claude in Cowork): vision, technical spec,
  art direction, project plan, master prompt, conventions and pre-seeded
  LESSONS.md. Why: give Claude Code a complete, unambiguous start so the
  credits go into the build, not into misunderstandings.
