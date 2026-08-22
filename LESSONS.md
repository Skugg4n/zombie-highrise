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
