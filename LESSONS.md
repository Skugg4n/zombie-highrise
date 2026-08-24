# LESSONS.md - Known problems and solutions

Pre-seeded with known pitfalls for exactly this stack, including issues
from the crew's previous game projects. Check here BEFORE debugging. Add
new entries in the same format: Symptom, Cause, Solution.

## From previous projects (these WILL bite again if ignored)

- **Symptom:** Textures appear mirrored or backwards (text reads reversed,
  details flipped). **Cause:** mixed texture pipelines. Three.js flips
  regular textures by default (`flipY = true`) while the glTF pipeline
  expects `flipY = false`; mirrored UVs and negative scales also flip
  faces. **Solution:** one pipeline per asset type, never toggle flipY per
  texture, and verify early with the debug atlas (?photomode=9) whose
  readable text exposes any flip instantly.
- **Symptom:** The lobby cannot both host a room AND enter VR; picking one
  locks out the other. **Cause:** the flow was designed as either/or, and
  WebXR's requirement that the session starts from a user gesture makes
  any auto-entry fail silently. **Solution:** lobby as an explicit state
  machine where VR entry is an independent, always-visible button in both
  hosting and joined states. The smoke test asserts that button exists and
  is enabled in both states.
- **Symptom:** UI elements render under other text, overlap or clip.
  **Cause:** ad-hoc absolute positioning and improvised z-indexes.
  **Solution:** one root UI container with a documented z-index scale
  (HUD 100, menus 200, overlays 300, debug 900), plus the ?uistate gallery
  screenshotted at phone/laptop/desktop sizes and reviewed by the critic
  after UI changes.

## WebXR / Quest

- **Symptom:** The "Enter VR" button does nothing or throws SecurityError.
  **Cause:** WebXR requires HTTPS AND `requestSession` called directly in a
  click handler. **Solution:** GitHub Pages (HTTPS) or localhost, and start
  the session synchronously in the button's click handler.
- **Symptom:** Black screen in the headset while the game runs on desktop.
  **Cause:** `requestAnimationFrame` used instead of the XR loop.
  **Solution:** `renderer.setAnimationLoop(loop)` always, even outside VR.
- **Symptom:** Stuttering in VR despite a simple scene. **Cause:** too many
  draw calls or materials; Quest 2 is CPU-bound on draw calls. **Solution:**
  InstancedMesh for zombies, merge static geometry, texture atlas, one
  material instance per atlas. Set `renderer.xr.setFoveation(1)`.
- **Symptom:** Player stands inside the floor or floats. **Cause:** wrong
  reference space. **Solution:** use `local-floor`.
- **Symptom:** Tracking drifts in large rooms. **Cause:** cameras lack
  visual reference points on plain surfaces. **Solution:** good lighting
  and visual features on the floor. (A gym hall with sport court lines is
  actually GOOD tracking terrain; a bare white studio is bad.)
- **Symptom:** The Quest browser caches old versions hard. **Solution:**
  version query on modules (`main.js?v=123`) or hard reload; always show
  the version number in the UI so you SEE which build is running.

## PeerJS / networking

- **Symptom:** Connections work sometimes, not always. **Cause:** the public
  cloud broker can be slow/down, or peer-id collision. **Solution:** retry
  with backoff, clear error in the UI, generate a new room code on "ID is
  taken".
- **Symptom:** Remote players look jittery. **Cause:** rendering the raw
  latest position. **Solution:** interpolate 100 to 150 ms behind between
  snapshots.
- **Symptom:** Everything dies when a phone locks its screen or the tab is
  backgrounded. **Cause:** browsers throttle background tabs. **Solution:**
  the host should be a desktop; pause and show "reconnecting" instead of
  crashing; handle `visibilitychange`.
- **Symptom:** Works on LAN but not between different networks. **Cause:**
  symmetric NAT without TURN. **Solution:** accepted v1 limitation (TURN
  needs a server and we refuse servers); document it. Most home networks
  work fine.

## Mobile (iOS/Android)

- **Symptom:** No sound on iPhone. **Cause:** WebAudio requires a user
  gesture. **Solution:** create/resume AudioContext on first touch (the
  lobby button).
- **Symptom:** Pointer lock does not work on mobile. **Solution:** it must
  not be used there; the touch layer has its own camera control (drag to look).
- **Symptom:** Page scales oddly, the address bar eats height. **Solution:**
  `dvh` units or visualViewport, `touch-action: none` on the game surface,
  `user-scalable=no`.

## Three.js

- **Symptom:** Colors look washed out or too dark after a version change.
  **Cause:** color management changed in r150+. **Solution:** pin the Three
  version in the import map and set `renderer.outputColorSpace` on purpose.
  Never change versions mid-project.
- **Symptom:** Textures black on GitHub Pages but fine locally. **Cause:**
  cross-origin or wrong path (case sensitivity!). **Solution:** all assets
  same-origin, exact lowercase filenames.

## Playwright / smoke test

- **Symptom:** The "Enter VR" button never appears in headless smoke tests
  even with a navigator.xr stub. **Cause:** headless Chromium ALREADY has a
  real `navigator.xr` (which reports no immersive-vr support), so a stub
  guarded by `if (!navigator.xr)` never installs. **Solution:** always
  override `navigator.xr` with `Object.defineProperty` in the test's init
  script, unconditionally.

- **Symptom:** Playwright wants to download browsers in CI/sandbox.
  **Solution:** use the system Chromium (`executablePath`) or run
  `npx playwright install chromium` once locally.
- **Symptom:** Two browser contexts cannot find each other in the test.
  **Cause:** the PeerJS broker is unreachable from the test environment.
  **Solution:** longer timeout, log peer events; if the broker is down,
  rerun later.

## The rebuild (v0.10.x - v0.11.0)

- **Symptom:** The player climbs a ramp but stops one step short and can
  never get onto the platform. **Cause:** the platform's own collider
  ejects the player horizontally at the exact moment they arrive at its
  edge. **Solution:** a mover may not be blocked by a collider whose top
  it can already step onto (`blockingFor()` in locomotion.js). Anything
  with a `top` at or below `LOCO.stepUp` above you is furniture, not wall.

- **Symptom:** The player gets pinned somewhere and cannot move at all,
  in any direction. **Cause:** two solids with a gap between them
  narrower than the player's diameter. Both push, the pushes cancel, and
  the player is stuck forever. It happened twice here: the player-only
  boundary ring overlapping the base wall, and a snipe ramp running
  through the elevator cab. **Solution:** never leave a gap between 0 and
  about 0.8 m. Verify behaviourally, not geometrically: `debugPockets()`
  stands at every point in the base and walks toward the middle; anything
  that cannot get there is a trap. Pairwise geometry checks over-report,
  because a tiled wall run looks like it is full of gaps.

- **Symptom:** Zombies walk straight through low walls and sandbag
  stacks. **Cause:** the nav grid skipped every collider with a `top`,
  calling it "a walkable platform". A low wall has a top too.
  **Solution:** only colliders explicitly marked `walkable` (platforms,
  which have a ramp) are passable; anything taller than step-up blocks.

- **Symptom:** The horde reaches a walled base and mills about; the wall
  never takes damage. **Cause:** pressing against a wall reads as being
  stuck, and the stuck escalation relocated them after four seconds.
  **Solution:** attacking is not being stuck. Reset `stuckT` while the
  attack is happening. Also make the attack reach generous: the nav grid
  inflates obstacles by the agent radius, so a path ends about a metre
  short of the thing it leads to.

- **Symptom:** A rotated prop's sub-parts sit beside the body rather than
  on it (wheels next to the car, container ribs poking out as spikes).
  **Cause:** the naive 2D rotation `(x*cos - z*sin, x*sin + z*cos)` has
  the opposite sign to three's Y rotation. **Solution:** for
  `rotation.y = t`, local (lx, lz) maps to world
  `(lx*cos + lz*sin, -lx*sin + lz*cos)`. Use one shared helper.

- **Symptom:** `Failed to set the 'value' property on 'AudioParam': the
  provided float value is non-finite.` **Cause:** `audio.play(name, pos)`
  was given `[x, y, z]` where the panner expected `{x, y, z}`, so every
  component read as `undefined`. **Solution:** accept both forms and bail
  to the master bus if any component is not finite.

- **Symptom:** A shared material suddenly renders black on unrelated
  meshes. **Cause:** attaching `instanceColor` to a material shared with
  non-instanced meshes makes three compile it with
  `USE_INSTANCING_COLOR`. **Solution:** clone the material for the
  InstancedMesh. (Not the cause of the drab base floor here, but it is a
  real trap and the clone is correct either way.)

- **Symptom:** A probe reports a feature is broken when it is not.
  **Cause:** the probe still points at old level geometry after a level
  was replaced (the ground probe was climbing a ramp that no longer
  existed on floor 1). **Solution:** when a level changes, re-target its
  probes in the same commit.

- **Symptom:** WebXR weapon points about 45 degrees away from where shots
  go. **Cause:** the model hangs off the GRIP pose (the hand) while shots
  fire along the TARGET RAY pose (the pointing direction); on Oculus
  Touch those differ by a lot. **Solution:** read the live rotation
  between the two poses each frame and cancel it, rather than hardcoding
  an angle. Note that three sets `matrixAutoUpdate = false` on XR
  controller groups, so a fake pose in a test must write `.matrix` and
  decompose it, exactly as a real XR frame does.

## VR is an interface, not a rendering mode (v0.14.x)

- **Symptom:** A VR feature is written, described in the changelog, and
  does nothing on the device. **Cause:** the code was authored but never
  wired into the frame loop. Specifically, the reload gesture was added
  with a search-and-replace whose anchor did not match, so the edit was a
  silent no-op and `_reloadGesture` was never called. **Solution:** two
  rules. (1) Every scripted edit must ASSERT that it changed something;
  a replace that matches nothing must fail loudly, not pass quietly.
  (2) Every VR feature needs a probe assertion, because a headset is the
  only other place it would have been noticed.

- **Symptom:** Being downed in VR is a softlock: no text, no explanation,
  no way to restart or quit. **Cause:** every stopped state (downed, game
  over, victory) was a DOM overlay, and DOM does not exist inside a
  headset. The player could neither see their state nor act on it.
  **Solution:** a world-space panel parented to the camera, with actions
  on FACE BUTTONS rather than a laser pointer (a downed player should not
  have to aim at anything to get out of it). The general rule, from Ola:
  a feature is NOT done until it is usable in VR. Every piece of state a
  flat player can see must reach a VR player, and every action a flat
  player can take must be performable in VR. `test/vrprobe.mjs` asserts
  that list.

- **Symptom:** The flashlight fires bullets. **Cause:** the trigger was
  wired to "shoot" on every controller, and the off hand had since
  stopped holding a gun. **Solution:** only a hand actually holding a
  weapon fires. When a hand's contents become dynamic, everything bound
  to that hand has to become conditional at the same time.

- **Note on headless VR testing:** a real XR session cannot be created in
  a headless browser, but nearly all VR logic can run without one, since
  three creates the controller and grip groups on demand. A test seam
  that flips the session flag and supplies a session object with no input
  sources lets every pose-driven path (alignment, gestures, recoil, the
  panel) be driven and asserted. Poses must be written to `.matrix` and
  decomposed, because three sets `matrixAutoUpdate = false` on those
  groups.

## A probe can go to the wrong place and still say GREEN (v0.18.3)

**Symptom.** Two probes reported that a feature worked "underground" and
"on a traverse level". Both were on floor 1, in daylight, the whole time.

**Cause.** They opened the game with `?level=2`. There is no `level` URL
parameter. An unknown query parameter is not an error, it is just
ignored, so the page loaded floor 1 and every assertion after it was
about the wrong level. The real way in is `debugGotoLevel(2)`.

**Solution.** Two parts, and the second is the one that generalises:

1. Use `debugGotoLevel(n)`.
2. **Assert that you arrived.** Both probes now check the level they are
   standing on before checking anything about it: `debugArchetype() ===
   'traverse'`, `debugTorch().dark === true`. A setup step that can fail
   silently will eventually fail silently, and a green test on the wrong
   level is worse than no test, because it is evidence for a claim it
   never examined.

Related: the reload gesture that was changelogged as shipped and never
wired up, and the HUD overlap check that passed on a screen the
overlapping box was not on. Same family: the test ran, the test was
green, the test never looked at the thing.

## The host fell a column behind its own clients (v0.19.1)

**Symptom.** Zombies hammering the base animated correctly for a joining
client and stood perfectly still for the host, which in solo play means
they stood still for everybody.

**Cause.** The zombie row `[id, type, x, y, z, hp]` was written out as a
literal in two places: `snapshot()` in state.js, for the wire, and the
host's own render path in main.js, which reads the sim directly and never
needs a snapshot. Adding an `attacking` column to the first left the
second a field short. Nothing errored: the extra slot was simply
`undefined`, which is falsy, which is exactly "not attacking".

**Solution.** One exported `zombieRow(z, rounded)` used by both. A row
shape written down twice is a row shape that will disagree, and the
failure is silent because a missing trailing field in a destructure is
just `undefined`.

**Where else to look:** the same pattern exists for items, grenades,
barrels, drones, mines and traps. They have not diverged yet. They will,
the first time one of them grows a field.

## fetch and import() do not agree on what a relative path means (v0.20.0)

**Symptom.** The hot reloader detected every edit correctly and then
silently failed to load any of them.

**Cause.** One relative string, `./src/world/levels/L1.js`, used for both
polling and importing. `fetch` resolves against the DOCUMENT, so it read
the right file. `import()` resolves against the calling MODULE, which was
`/src/views/hotreload.js`, so it asked for
`/src/views/src/world/levels/L1.js`, which does not exist.

**Solution.** Build the URL once, absolute, from `import.meta.url` in the
module that owns the files. The same URL then means the same thing to
both, and it keeps working when the game is served from a subdirectory,
which GitHub Pages does.

**The general shape:** any path used by two different APIs is a path that
needs to be absolute. The failure is quiet because both APIs happily
accept the string.

## A debug hook can die quietly when the code under it changes (v0.21.0)

**Symptom.** `groundprobe` reported that the player could not climb a ramp.
The ramp was fine. The player had not moved at all.

**Cause.** `debugMove` added a delta straight to `rig.group.position`. In
v0.17.0 the character controller took ownership of the body and started
copying `controller.pos` over the rig every frame, so every write was
undone before anything could observe it. Nothing errored, nothing warned;
the function ran and did nothing.

**Where it really hurt.** `pressureprobe` drives a bot that kites, and
kiting is the core skill the probe exists to simulate. It had not kited
for four versions, and the probe reported its numbers with a straight face.

**Solution.** `debugMove` steps the controller, exactly as a player's
input does. Test seams must go through the same door as the real thing,
which is the same rule as "no calling handlers directly" and fails the
same way when broken.

**How to spot the family:** any debug hook that WRITES state the game also
writes. When ownership of a piece of state moves, every writer of it needs
checking, and a probe is a writer nobody thinks about.
