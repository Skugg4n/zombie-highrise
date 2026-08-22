# ZOMBIE HIGH RISE

Co-op zombie wave defense in Three.js for Quest 2/3 (WebXR, room scale or
stationary), mobile and desktop. Multiplayer via 4-character room codes,
no server, GitHub Pages.

## Play it

Live build: **https://skugg4n.github.io/zombie-highrise/**

Host a room on a desktop, share the 4-character code, friends join from
their own devices (phone, desktop, Quest browser). Or press PRACTICE SOLO.
A full run is 12 floors ending with the Butcher and a roof extraction.

## Deploy

The site is a static build with no build step: GitHub Pages serves the
repo root.

1. `git push` to `main` on https://github.com/Skugg4n/zombie-highrise
2. Pages is already configured (Settings, Pages, deploy from branch
   `main`, folder `/ (root)`). A push is the whole deploy.
3. Hard-reload on Quest after a deploy; its browser caches aggressively.
   The version tag in the top-right corner tells you which build you are
   actually running.

## Develop

    npm install            # Playwright, test-only dependency
    npx playwright install chromium
    node test/smoke.mjs    # the always-green gate: run after EVERY change

Other tooling: `test/capture.mjs` (photomode + UI screenshot gallery),
`test/feelcapture.mjs` (scripted gameplay clips), `test/perfprobe.mjs`
(draw-call/triangle budget), `test/endingprobe.mjs` (the win state).

Runtime deps are vendored and pinned in `vendor/` (Three.js r170, PeerJS
1.5.4); there is no CDN at runtime and no build step.

## The files

- `index.html` - boot, lobby, HUD, all UI states (documented z-index scale)
- `src/main.js` - bootstrap, frame loop, VFX, netcode glue
- `src/game/` - host-authoritative sim, tuning sheet, arsenal, meta saves
- `src/world/` - level generator, instanced horde, procedural textures
- `src/net/` - PeerJS transport + wire protocol
- `src/input/` - keyboard, touch and WebXR layers
- `src/audio/` - fully procedural WebAudio (no sound files)
- `docs/` - vision, technical spec, art direction, project plan, TODO
- `HANDOFF.md` - state of the build and what to pick up next
- `TEST-ON-DEVICE.md` - what to verify on real hardware
- `LESSONS.md` - known pitfalls and their solutions (read before debugging)
- `QUALITY.md` - critic-loop scoreboards and accepted flaws
- `CHANGELOG.md` - version log
