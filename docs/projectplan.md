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

- [ ] Drone the tactician sends to unreachable zones
- [ ] Moving platform section (train or wagon between areas)
- [ ] Weapon roster v2: AK-style rifle, dual pistols, smoke and fire
      grenades, night vision device (grainy green, limited battery)
- [ ] Meta progression in localStorage (permanent unlocks)
- [ ] Trench sections between bases (tight, flashlight, night)

## Phase 3 - The polish loop (sub-agent critics, see KICKOFF-PROMPT.md)

- [ ] Light and atmosphere per photo mode view until critics score 9+/10
- [ ] Zombie animation and hit feel (hit reactions, ragdoll-light)
- [ ] Weapon feel: recoil, sound, muzzle flash, shell casings
- [ ] Soundscape: positional, music stingers at wave start
- [ ] UI polish: HUD, menus, elevator shop, all in English
- [ ] Performance gate: 72 fps on Quest 2 in the worst scene

## Phase 4 - Release

- [ ] GitHub Pages deploy documented in README
- [ ] Playtest with the whole crew, bugs into LESSONS.md
- [ ] Cross-city test: Quest 2 + Quest 3 + desktop + mobile from different homes

## Future (parked in docs/TODO.md)

- Co-located VR: several headsets in the same physical room (gym hall),
  with the alignment ritual it requires
- Host migration, voice chat, PvP horde mode, roof finale
