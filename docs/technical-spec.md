# ZOMBIE HIGH RISE - Technical spec

## Ground rules

- **Static site, no custom server.** Everything runs from GitHub Pages
  (HTTPS included, which WebXR requires).
- **The stack is a DECISION, not a suggestion.** Three.js (pinned version)
  plus PeerJS (pinned version), plain ES modules with an import map, no
  build step, no frameworks. Claude Code has full freedom in internal
  architecture and code design, but does not swap or add stack pieces.
  Rationale: reproducible deploys, LESSONS.md stays valid, and credits go
  into the game instead of tooling churn.
- **One codebase, three modes.** Platform is detected at startup: VR
  (WebXR available), mobile (touch), desktop (mouse/keyboard). Same world,
  different input layers.

## File structure

```
/
  index.html          (boot, lobby, room codes)
  src/
    main.js           (bootstrap, platform detection, quality tier)
    net/              (PeerJS host/client, protocol, snapshot sync)
    game/             (state, waves, zombie AI, weapons, traps, elevator)
    world/            (level generator, layouts, props, lighting)
    input/            (vr.js, touch.js, keyboard.js)
    views/            (fps view, tactical map view)
    ui/               (HUD, menus, elevator shop, version number)
    audio/            (WebAudio, positional sound)
  assets/             (textures, models, sounds - all same-origin)
  test/
    smoke.mjs         (Playwright: host + client, join, sync assert, UI gallery)
```

## Networking (PeerJS, P2P)

- PeerJS with the public cloud broker. No server of our own.
- **Room code:** 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no
  easily confused characters). Peer id = `zhr-v1-<CODE>`. On collision when
  hosting: generate a new code.
- **Star topology, host-authoritative.** The host (ideally desktop, the most
  stable device) owns game state: zombies, waves, damage, traps. Clients
  send input/events (about 20 Hz), the host broadcasts snapshots (about
  15 Hz). Clients interpolate 100 to 150 ms behind; own movement is
  predicted locally.
- Player poses are sent plainly (position + facing + VR head/hand poses).
- Reconnect: a dropped client retries with the same code. Host death ends
  the run (acceptable v1, host migration parked in docs/TODO.md).
- Same-LAN play gets very low latency via P2P; cross-city play works as
  long as NAT allows (no TURN server, documented limitation).

## The lobby (explicit requirements, learned the hard way)

The lobby MUST support every combination on EVERY platform:

```
{ Host a room, Join a room } x { play flat, enter VR }
```

- Hosting must never lock out VR entry. Joining must never lock out VR entry.
- "Enter VR" is always its own button, shown whenever WebXR is available,
  in the lobby AND in-game. It must be pressed by the user (WebXR gesture
  requirement); never auto-enter VR.
- The lobby is implemented as an explicit state machine
  (boot -> menu -> hosting/joining -> connected -> playing, VR entry
  orthogonal to all of it), documented in a comment at the top of the file.
- The room code is displayed huge for the host, with a copy button on flat
  platforms.

## WebXR / Quest 2 and 3

- `navigator.xr.requestSession('immersive-vr', ...)` with `local-floor`.
  Session must be requested inside a click handler.
- `renderer.setAnimationLoop` (never requestAnimationFrame) everywhere.
- Foveation on (`renderer.xr.setFoveation(1)`), dynamic resolution scale if
  fps drops. Quest 2 is the performance floor; Quest 3 runs the same code
  with headroom.
- Controllers: simple custom weapon models on the controller poses.
  Trigger = shoot, grip = reload, button = flashlight.

### Two VR locomotion modes (selectable in the lobby, switchable in-game)

1. **ROOMSCALE:** the player walks physically. Play area size chosen in the
   lobby: SMALL (2x2 m), MEDIUM (5x5), LARGE (up to 10x14, gym hall).
   Levels are generated to fit the chosen footprint. Guardian caps at about
   15x15 m; never design beyond it.
2. **STATIONARY:** for playing seated or standing still at home, and for
   testing. Left stick = smooth locomotion, right stick = snap turn,
   optional comfort vignette during movement. Everything reachable in
   roomscale must be reachable stationary.

A single VR player needs NO calibration: the world is generated around the
player's `local-floor` origin and chosen play size. (Several VR players in
the same physical room is a future mode and lives in docs/TODO.md together
with the alignment ritual it requires.)

### Moving platforms (elevator, train, wagon)

The player stands still physically while the platform moves them through
the world. Implemented by parenting the player rig to the platform node.
Comfort: soft acceleration, optional vignette, sound and rumble anchoring
the motion. Also the sequencing tool for travel between areas.

## Performance budget (Quest 2 is the floor)

- Target: 72 fps in VR, 60 fps mobile/desktop.
- Max about 100 draw calls, about 250k triangles in view.
- Zombies: `InstancedMesh` plus shared-material animation. One texture
  atlas for the environment, one for enemies.
- No realtime shadows in the VR tier: baked/faked (blob shadows, light
  gradients). Desktop tier gets real shadows and bloom.
- Quality tiers `VR` / `MOBILE` / `DESKTOP` set automatically, forceable
  via `?q=`.

## Photo mode (for the critic loop)

`?photomode=N` boots deterministically: fixed seed, fixed time of day,
camera at preset position N (1-8: ground-level exterior day, basement
corridor with flashlight, elevator interior, tactical view, distant horde,
balcony vista, trench at night, HUD in action). Playwright captures the
exact same views every iteration so critics compare like for like.

## UI state gallery (for the UI critic)

`?uistate=lobby|hosting|joining|hud|shop|gameover` renders that UI state
with representative fake data. Captured at 390x844 (phone), 1280x720 and
1920x1080. One root UI container with a documented z-index scale
(HUD 100, menus 200, overlays 300, debug 900). No ad-hoc z-indexes.

## Texture correctness check

`?photomode=9` applies a debug atlas (readable text and direction arrows on
every material slot). Any mirrored or upside-down text in the screenshot is
an instant fail. Rule of thumb: glTF assets expect `flipY = false`; never
mix pipelines per-texture.

## Misc

- Saves: meta progression in `localStorage`, versioned schema with migration.
- Audio: WebAudio, positional, unlocked on first user gesture (iOS rule).
- Version number always visible discreetly in a UI corner, bumped on every change.
- All game text in English. Code comments in English.
