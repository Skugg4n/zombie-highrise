# CHANGELOG - ZOMBIE HIGH RISE

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
