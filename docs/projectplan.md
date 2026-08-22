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
- [ ] Zombie animation and hit feel (hit reactions, ragdoll-light)
- [ ] Weapon feel: recoil, sound, muzzle flash, shell casings
- [ ] Soundscape: positional, music stingers at wave start
- [ ] UI polish: HUD, menus, elevator shop, all in English
- [ ] Performance gate: 72 fps on Quest 2 in the worst scene

### Feel critic loop (screenshots cannot judge how the game FEELS)

- [ ] ?feelclip=N deterministic gameplay clips (scripted input, fixed
      seed): pistol firing at a walker, SMG spraying a group, shotgun
      point-blank on a brute, machete swing, grenade throw and explosion,
      taking damage and going downed
- [ ] Capture each as video (Playwright recordVideo) AND as a frame strip;
      a SEPARATE critic sub-agent judges them 1-10 on game feel against
      the reference games in docs/vision.md: does firing feel punchy, is
      there weight and consequence, does the zombie react visibly to being
      hit, is the feedback loop readable within 100 ms of the trigger?
      Loop until 9+ like the visual critics (same 6-round cap per pass).
- [ ] Minimum feel requirements before that loop can pass: muzzle flash
      that briefly lights the surroundings, camera/weapon recoil kick
      with recovery, hit reactions on enemies (flinch, knockback on
      shotgun), hit markers or clear damage feedback, shell casings,
      screen shake on explosions, and a full WebAudio layer (fire,
      reload, impact, empty click, enemy sounds, wave stingers)
      synthesized in code so there are no asset downloads

## Phase 3.5 - Depth and replayability (added per Ola's ambition brief:
## Quest 2 caps rendering only; feel, content depth and functional quality
## are judged against full commercial titles. Boredom is a bug.)

- [ ] Enemy roster expansion (readable silhouettes + distinct behavior):
      SPITTER (ranged acid arc, forces repositioning, fragile),
      CRAWLER (low fast silhouette, ducks under sightlines, lunges),
      SCREAMER (support: scream summons a burst wave, priority target)
- [ ] BOSS floor every 6th level: the BUTCHER guards the elevator
      (heavy charge attack, stagger windows, weak-point back plate,
      scrap jackpot). Boss floor = difficulty peak by design.
- [ ] Night modifiers rolled per night and announced at countdown (fog
      night, frenzy, blackout, swarm of weaklings, loot night) so floors
      6+ differ structurally, not just numerically
- [ ] Day-phase events with real decisions: SUPPLY DROP (rich crate lands
      OUTSIDE the walls: risk/reward run), GENERATOR (dark levels: find
      and start it to keep the lights on all night)
- [ ] Hazards: explosive barrels (shootable, chain into the horde)
- [ ] Upgrade paths as late-game scrap sinks: weapon tier upgrades
      (damage/magazine, 2 tiers per gun), armor vest (absorbs damage,
      breaks), bandolier (carry caps up)
- [ ] Weapon role audit: every weapon has a distinct moment where it is
      the right choice; no strict dominance (tuning + playtest critic)
- [ ] Difficulty curve with peaks and breathers: surge nights every 3rd
      night, calmer post-surge days with bonus loot, wagon floors as
      breathers, boss floors as peaks
- [ ] Playtest critic loop: an autopilot bot (?autoplay=1) plays a full
      multi-floor session headless at accelerated speed, logging pacing
      metrics (night lengths, damage, economy flow, idle time); a
      SEPARATE critic sub-agent reviews the session log + periodic
      screenshots and reports where it got bored, confused or frustrated;
      loop on its findings like the visual and feel critics (6-round cap
      per pass)
- [ ] Final placeholder purge: every sound, animation, reaction,
      transition and UI state deliberate; nothing left as scaffold

## Phase 4 - Release

- [ ] GitHub Pages deploy documented in README
- [ ] Playtest with the whole crew, bugs into LESSONS.md
- [ ] Cross-city test: Quest 2 + Quest 3 + desktop + mobile from different homes

## Future (parked in docs/TODO.md)

- Co-located VR: several headsets in the same physical room (gym hall),
  with the alignment ritual it requires
- Host migration, voice chat, PvP horde mode, roof finale
