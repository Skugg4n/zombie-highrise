# CHANGELOG - ZOMBIE HIGH RISE

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
