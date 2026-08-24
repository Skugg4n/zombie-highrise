# ZOMBIE HIGH RISE - Project plan

Phases are built in order. **Phase 0 must be verified on real devices
before any polish work starts.** Building the wrong thing beautifully is
expensive.

## Phase 0 - Steel thread (a playable line through everything)

- [x] index.html + Three.js scene loading from GitHub Pages (built; Pages
      goes live when Ola pushes, see README)
- [x] Lobby: host a room (4-char code shown huge), join with a code
- [x] Lobby matrix verified: {host, join} x {flat, VR} all work on all
      platforms (smoke-tested; real-device pass pending below)
- [x] PeerJS host + client, players see each other move
- [x] Desktop controls (WASD + mouse, pointer lock)
- [x] Mobile controls (joystick + tap to shoot)
- [x] WebXR entry on Quest (button, local-floor, controllers visible)
      (implemented; real-Quest pass pending below)
- [x] Stationary VR locomotion (stick move + snap turn) works
      (implemented; real-Quest pass pending below)
- [x] One level, one zombie walking at players, one weapon dealing damage
- [x] UI state gallery (?uistate=...) renders all states without overlap
- [x] Texture debug view (?photomode=9) shows no mirrored/flipped text
- [x] Smoke test (test/smoke.mjs) green: host + client + sync + UI gallery
- [ ] VERIFIED ON REAL DEVICES: Quest, one phone, one desktop

## Phase 1 - The core loop

- [x] Wave system with escalating difficulty, day/night cycle
- [x] Level generator: basement / ground level / upper floor types, layouts
      fitting the chosen play area (SMALL/MEDIUM/LARGE), ground level about
      every 3rd level with open sightlines OUT of the base
- [x] The elevator: end level, upgrade shop, next level, re-center world
- [x] 3 enemy types with distinct behavior and readable silhouettes
- [x] Weapon roster v1: pistol, shotgun, SMG, each with distinct feel,
      ammo, loot and proper reloading (VR grip squeeze, R key, touch button)
- [x] Machete melee (ammo saver, satisfying in VR)
- [x] Health packs (use on self or teammate) and frag grenades
- [x] Traps and mines, placeable
- [x] Tactical map view (mobile can flip): ping, place traps
- [x] Countdown, game over, score screen

## Phase 2 - Roles and depth

- [x] Drone the tactician sends to unreachable zones
- [x] Moving platform section (train or wagon between areas)
- [x] Weapon roster v2: AK-style rifle, dual pistols, smoke and fire
      grenades, night vision device (grainy green, limited battery)
- [x] Meta progression in localStorage (permanent unlocks)
- [x] Trench sections between bases (tight, flashlight, night)

## Phase 3 - The polish loop (sub-agent critics, see KICKOFF-PROMPT.md)

- [ ] Light and atmosphere per photo mode view until critics score 9+/10
- [x] Zombie animation and hit feel (hit reactions, ragdoll-light)
- [x] Weapon feel: recoil, sound, muzzle flash, shell casings
- [x] Soundscape: positional, music stingers at wave start
- [ ] UI polish: HUD, menus, elevator shop, all in English
- [x] Performance gate: budget verified (61 calls / 3.8k tris with 16
      zombies); 72 fps on real Quest 2 hardware still needs Ola's check

### Feel critic loop (screenshots cannot judge how the game FEELS)

- [x] ?feelclip=N deterministic gameplay clips (scripted input, fixed
      seed): pistol firing at a walker, SMG spraying a group, shotgun
      point-blank on a brute, machete swing, grenade throw and explosion,
      taking damage and going downed
- [x] Capture each as video (Playwright recordVideo) AND as a frame strip;
      a SEPARATE critic sub-agent judges them 1-10 on game feel against
      the reference games in docs/vision.md: does firing feel punchy, is
      there weight and consequence, does the zombie react visibly to being
      hit, is the feedback loop readable within 100 ms of the trigger?
      Loop until 9+ like the visual critics (same 6-round cap per pass).
- [x] Minimum feel requirements (all implemented): muzzle flash
      that briefly lights the surroundings, camera/weapon recoil kick
      with recovery, hit reactions on enemies (flinch, knockback on
      shotgun), hit markers or clear damage feedback, shell casings,
      screen shake on explosions, and a full WebAudio layer (fire,
      reload, impact, empty click, enemy sounds, wave stingers)
      synthesized in code so there are no asset downloads

## THE REBUILD (2026-08-23) - authority: docs/level-design.md

Ola's v0.9.3 playtest replaced the high-rise concept with two alternating
level archetypes. docs/level-design.md is the authority on level
structure; this plan follows its build order. Phases 0-3 below stay as
history: their systems (netcode, arsenal, audio, feel, ending) survive
the rebuild. What changes is the LEVELS.

### Step 1 - Foundation bugs (nothing else matters until these are fixed)

- [x] **Enemy navigation.** (v0.10.0: navgrid.js, A* + string-pulling +
      separation; navprobe reports 0 frozen on all three level types)
      ORIGINAL: Zombies get stuck, jitter, walk into geometry
      and cannot escape, and are harmless. Implement a navigation grid
      over the level with real pathfinding plus agent separation. They
      must route around obstacles, find breaches, and never freeze.
- [x] **Ground and collision ignore height.** (v0.10.1: locomotion.js,
      step-up 0.45 / step-down 0.55 / gravity 22, steppable tops no longer
      eject the mover; groundprobe climbs the 2.4 m ramp cleanly)
      ORIGINAL: Players walk up and down the
      sides of a ramp as if the world were flat and cannot step onto its
      last step ("no gravity, absence of natural laws"). Implement proper
      ground sampling, step-up and slope limits, and real falling.
- [x] **VR weapon aim is 45 degrees off.** (v0.10.2: the models hung off
      the GRIP pose while shots fired along the TARGET RAY pose; the live
      rotation between the two is now cancelled out each frame, and shots
      leave the barrel tip. vraimprobe: 47.5deg off -> 0.00deg.)
      ORIGINAL: The pistol points up and away
      from the controller forward axis. Fix the weapon-to-controller
      transform and verify in headset.
- [x] Reload needs a readable animation (done in v0.9.2)
- [x] The elevator sometimes faces the wrong way. (v0.11.0: on holdout
      levels position AND facing derive from the base centre.)
      ORIGINAL: It becomes the base's
      lift plate, so orientation derives from the base, never placed
      independently.

### Step 2 - ONE holdout level, proven fun

- [x] Build L1 to the sketch (v0.11.0). One deviation, noted: the snipe
      platform moved from the north-west to the north-east corner because
      its ramp ran through the elevator cab there. ORIGINAL: (docs/sketches/L1-holdout.jpg):
      open daylight field 60-80 m, small base in it, low wall + sandbags,
      interior crates, a ramp to a snipe platform, the elevator plate with
      its control panel, 4 player spawns.
- [x] Field: fog/haze hiding the far ground, sight blockers (ridge, lone
      tree, burnt-out cars, rock/house, a building), zombie spawns ALWAYS
      behind a sight blocker and never in view of the base.
- [x] Players cannot leave the base (verified in 8 directions); the low wall is the boundary.
- [x] The base takes damage: zombies attack the wall and sandbags,
      breaches open, repairable during the day, losing the base is a fail
      state.
- [x] The drone becomes a real tool (4 payloads, free to launch): affordable, obvious effect, and it
      flies OUT to place traps where players cannot reach. More trap
      types for it to drop.
- [x] Mines priced as a staple: 12 from the map, 10 by drone.
- [x] **STOP. Ola plays it. Iterate until this single level is genuinely
      fun on its own before building anything else.** Played repeatedly,
      flat and in VR, from v0.11 onward. Every round of feedback is logged
      in docs/TODO.md and ticked with the version that did it.

### Step 3 - ONE traverse level, same treatment

- [x] (v0.16.0) Build L2 to the sketch (docs/sketches/L2-traverse.jpg):
      dark route, elevator/spawn in one corner, slide door with a button,
      a chasm to route around, a fence, zombie holes in walls and ground,
      a weapon locker, the exit lift in the opposite corner. Shipped at
      13x13 m rather than the sketch's 10x10; the deviation and its reason
      are stated in the data file.
- [x] (v0.16.0) Drone explicitly unavailable underground, stated in
      fiction and UI ("DRONE: NO SIGNAL UNDERGROUND", and a line in the
      world when you try).
- [x] Stop, playtest, iterate. Two rounds of VR feedback on L2 so far,
      all of it in docs/TODO.md.

### Step 4 - The campaign

- [ ] More variants of each archetype (holdout on a rooftop, in a walled
      yard, inside a house shooting out of windows; longer traverses with
      more doors and real hazards)
- [ ] RIDE maps: the squad stands on a moving vehicle, danger arrives
      along the path
- [x] (v0.8.0) The BUTCHER boss as a holdout with one huge threat, on
      floor 12. Checked end to end by `test/endingprobe.mjs`.
- [x] (v0.8.0) Finale and win state: the roof extraction. Same probe.

## Phase 4 - Release

- [x] GitHub Pages deploy documented in README
- [ ] Playtest with the whole crew, bugs into LESSONS.md
- [ ] Cross-city test: Quest 2 + Quest 3 + desktop + mobile from different homes
