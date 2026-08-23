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
- [ ] **VR weapon aim is 45 degrees off.** The pistol points up and away
      from the controller forward axis. Fix the weapon-to-controller
      transform and verify in headset.
- [x] Reload needs a readable animation (done in v0.9.2)
- [ ] The elevator sometimes faces the wrong way. It becomes the base's
      lift plate, so orientation derives from the base, never placed
      independently.

### Step 2 - ONE holdout level, proven fun

- [ ] Build L1 exactly to the sketch (docs/sketches/L1-holdout.jpg):
      open daylight field 60-80 m, small base in it, low wall + sandbags,
      interior crates, a ramp to a snipe platform, the elevator plate with
      its control panel, 4 player spawns.
- [ ] Field: fog/haze hiding the far ground, sight blockers (ridge, lone
      tree, burnt-out cars, rock/house, a building), zombie spawns ALWAYS
      behind a sight blocker and never in view of the base.
- [ ] Players cannot leave the base; the low wall is the boundary.
- [ ] The base takes damage: zombies attack the wall and sandbags,
      breaches open, repairable during the day, losing the base is a fail
      state.
- [ ] The drone becomes a real tool: affordable, obvious effect, and it
      flies OUT to place traps where players cannot reach. More trap
      types for it to drop.
- [ ] Mines priced as a staple, not a luxury.
- [ ] **STOP. Ola plays it. Iterate until this single level is genuinely
      fun on its own before building anything else.**

### Step 3 - ONE traverse level, same treatment

- [ ] Build L2 to the sketch (docs/sketches/L2-traverse.jpg): 10x10 m
      dark route, elevator/spawn in one corner, slide door with a button,
      a chasm to route around, a fence, zombie holes in walls and ground,
      a weapon locker, the exit lift in the opposite corner.
- [ ] Drone explicitly unavailable underground, stated in fiction and UI.
- [ ] Stop, playtest, iterate.

### Step 4 - The campaign

- [ ] More variants of each archetype (holdout on a rooftop, in a walled
      yard, inside a house shooting out of windows; longer traverses with
      more doors and real hazards)
- [ ] RIDE maps: the squad stands on a moving vehicle, danger arrives
      along the path
- [ ] The BUTCHER boss as a holdout with one huge threat
- [ ] Finale and win state (the roof extraction survives from v0.8.0)

## Phase 4 - Release

- [x] GitHub Pages deploy documented in README
- [ ] Playtest with the whole crew, bugs into LESSONS.md
- [ ] Cross-city test: Quest 2 + Quest 3 + desktop + mobile from different homes
