# TEST-ON-DEVICE - live checklist for Ola

Live build: https://skugg4n.github.io/zombie-highrise/
Always check the version tag (top-right corner) first: Quest caches hard.
Report breakage as "device + what you did + what you saw". This file is
updated as features land; newest additions at the top of each section.

## Current build: v0.1.1 (Phase 0 steel thread)

### Desktop (host here)
- [ ] HOST A ROOM shows a huge 4-char code; COPY CODE works.
- [ ] START GAME: WASD moves, mouse looks after clicking the canvas
      (pointer lock), click shoots, R reloads.
- [ ] The zombie walks in through a wall gap, dies after 3 hits, respawns
      after ~3 s, and drops your HP at melee range.
- [ ] Version tag reads the version at the top of CHANGELOG.md.

### Phone (join, ideally on mobile data)
- [ ] JOIN A ROOM with the code, START GAME.
- [ ] Left-thumb joystick moves; dragging right half looks; tapping right
      half or the FIRE button shoots.
- [ ] The desktop player moves smoothly (no teleporting/jitter); both see
      the same zombie in the same place.
- [ ] Lock the phone ~10 s, unlock: "Connection stalled" appears and it
      recovers (or gives a clear error), never a silent freeze.

### Quest 2 (browser)
- [ ] ENTER VR button visible in the lobby both when hosting and joined.
- [ ] ENTER VR: standing at correct floor height, a pistol in each hand,
      game starts automatically.
- [ ] Stationary mode: left stick smooth-moves, right stick snap-turns 45
      degrees. Trigger shoots.
- [ ] Roomscale: physically walking moves you through the world; the world
      itself stays put.
- [ ] Exit VR: the 2D page is still functional afterwards.

### Cross-cutting
- [ ] Lobby matrix: host from each device, join from each device; ENTER VR
      never disappears on the Quest in any path.

## Known limitations (documented, not bugs)
- Cross-network play needs NAT-friendly home networks (no TURN server by
  design). Symmetric corporate NATs may fail.
- Host death ends the run (host migration is parked in docs/TODO.md).
