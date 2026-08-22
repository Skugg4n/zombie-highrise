# TEST-ON-DEVICE - live checklist for Ola

Live build: https://skugg4n.github.io/zombie-highrise/
Always check the version tag (top-right corner) FIRST: Quest caches hard.
Report breakage as "device + what you did + what you saw". Newest checks
at the top; ticked history stays for regression reference.

## v0.5.0 - Phase 1 core loop (NEW)

### Any platform (solo is enough to verify the loop)
- [ ] PRACTICE SOLO: day phase counts down 45 s, then a 5-4-3-2-1
      countdown, then NIGHT 1: zombies walk in through the wall gaps.
- [ ] Three enemy silhouettes readable at range: gray walker (rust shirt),
      lean fast runner (yellow), massive slow brute (dark red).
- [ ] Kill everything: night clears, day again, night 2, then CLEARED and
      the elevator doors open. Walk in: the shop appears.
- [ ] Shop: buy the shotgun (250 scrap needs ~2 nights of kills), READY,
      arrive on floor 2: the BASEMENT (dark, flashlight on, doorway
      entries). Floor 3 is the upper floor (windows, balcony, street).
- [ ] Weapons: 1/2/3/4 keys switch (or WEAPON button / A button in VR),
      shotgun spreads, SMG full-auto on hold, machete swings (walk into a
      zombie and swing: one-shot walkers), G throws a grenade (arc, bounce,
      3 s fuse, explosion).
- [ ] T places a mine during the day (after buying one); it blinks red,
      arms in 1 s, and detonates a zombie cluster at night.
- [ ] M opens the tactical map (top-down): tap PING (marker all players
      see), MINE mode places for 65 scrap. CLOSE MAP returns.
- [ ] Get hurt: HP drops; at 0 you are DOWNED (solo = game over screen
      with stats and TRY AGAIN restarting the current floor).
- [ ] Loot: supply drops appear at dawn; zombies sometimes drop pickups;
      walking over them grants (toast message).

### Co-op specific (desktop host + phone join is enough)
- [ ] Client sees the same wave phases, zombies, mines, pings and shop.
- [ ] Downed client: a teammate standing close for 4 s revives them.
- [ ] Both must stand in the elevator to depart; READY skips the timer
      when everyone pressed it.
- [ ] Client purchases update their own scrap/HUD only.

### Quest 2 (VR-specific Phase 1 checks)
- [ ] Trigger fires, HOLD trigger auto-fires the SMG.
- [ ] RIGHT grip squeeze reloads. LEFT grip squeeze drops a mine.
- [ ] A cycles weapon (model changes in your hands), B throws a grenade,
      X uses a health pack, Y toggles the flashlight.
- [ ] Basement floor: flashlight beam follows your head, scene readable.
- [ ] Elevator ride: the world rebuilds and you arrive CENTERED on the new
      floor regardless of where you physically stood (the elevator trick).
- [ ] Play-area size (host panel): SMALL/MEDIUM/LARGE change the level
      footprint; roomscale walking should cover the whole floor.

## v0.1.1 - Phase 0 steel thread (verified? tick what you tested)

- [ ] Desktop: host, code shown, WASD + pointer lock, R reload.
- [ ] Phone: join with code, joystick + tap/FIRE, smooth remote players,
      lock/unlock shows "Connection stalled" then recovers.
- [ ] Quest: ENTER VR in lobby (hosting AND joined), correct floor height,
      pistols in hands, stick move + 45-degree snap turn, roomscale walk,
      clean exit.
- [ ] Lobby matrix: host/join from every device, ENTER VR always present.

## Known limitations (documented, not bugs)
- Cross-network play needs NAT-friendly home networks (no TURN by design).
- Host death ends the run (host migration parked in docs/TODO.md).
- Audio lands in Phase 3; visual polish (real lighting pass, animation,
  instancing) lands in Phase 3.
