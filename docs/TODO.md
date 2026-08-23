# TODO: the single source of truth for everything Ola asks for

**The rule (Ola, 2026-08-23):** he should be able to think out loud without
doing the bookkeeping. That is my job.

1. **Every request goes in here as a checkbox BEFORE any work starts**, even
   the ones being fixed immediately. Ten requests, three fixed: all ten are
   in the file.
2. **Tick it the moment it is done, with the version that did it**:
   `- [x] (v0.16.1) zombies attack on traverse levels`.
3. **Anything deliberately not done says so**, in Parked with a reason.
   Nothing is silently left open.
4. Every reply to Ola ends with the open count and the next three items.

---

## Open: Ola's v0.15.x VR playtest

### Wrist display, still wrong
- [ ] It sits on the UNDERSIDE of the hand, upside down. It must be on the
      FOREARM like a watch: same side as the back of the hand, angled so a
      natural turn of the forearm brings it to the eyes, and NOT attached
      to the hand itself.
- [ ] Build the calibration aid instead of guessing again: a bracelet
      around the forearm with numbers in a ring and letters marking the
      angle, so Ola can read off the coordinates that work. Guessing has
      cost two attempts already.

### Strategy view in VR (the drone is unusable without it)
- [ ] The wrist is the TRIGGER, not the whole surface. Looking at it
      unfolds a larger holographic panel at a comfortable distance, big
      enough to read the map and place a drone target precisely.
- [ ] Support both interaction modes: holster the pistol at the hip to
      free the hand for pointing, AND point with the barrel using the
      trigger as the click.
- [ ] The holster is a real object visible on the hip. Move the hand to it
      and press the hand button to stow or draw.

### Bugs
- [x] (v0.17.0) The ramp clipping when entered from the side. Fixed by the
      character controller, and the gym has a station that reproduces it:
      "a ramp cannot be entered from the side: you are stopped, not
      absorbed".
- [ ] The hand flashlight does not toggle on the trigger. It should.
- [ ] Remove the headlamp. It should not exist yet.
- [ ] Desktop HUD overlaps at the top: the objective banner and the base
      integrity bar collide and become unreadable. Lay out the top HUD so
      nothing can overlap at ANY window size, and add that to the UI state
      checks so it cannot come back.
- [ ] MINE and DRONE:MINE read as duplicates. If there is no real
      difference, remove the plain MINE. If there is, make the label say
      what it is.

### Feel and animation
- [ ] The VR reload is a slow quarter turn left and back, and it is
      unclear what it represents. One quick decisive motion instead.
- [ ] Zombies attacking the base stand and stare while it breaks. They
      need an attack animation that reads from across the field.

### Mechanics
- [ ] Shooting a mine should detonate it.
- [ ] Mines and barrels should damage each other, so chain reactions are
      possible and trap placement becomes a real tactical puzzle.

## Open: Ola's L2 playtest and process notes (2026-08-23)

### Probes must measure players, not variables
- [ ] Go through EVERY probe assertion and make each assert what a player
      would notice, not what a variable does. Where one checks a state name
      or a flag, replace or supplement it with the observable consequence.
      List in `QUALITY.md` which assertions changed and what each now
      proves. (The restart assertion is done; the rest of the suite is not
      audited yet.)

### Tooling to make future levels fast
- [ ] `?levelpreview=N`: render any level from above with labels on the
      base, spawn rings, sight blockers and the exit, without playing it.
      Five seconds instead of five minutes changes how many sketches Ola
      can try.
- [ ] Hot reload of level data files in dev, so changing a number rebuilds
      the level without restarting the run.
- [ ] Write the practical version of cheap-versus-expensive: which kinds of
      sketch are just numbers and existing props (free), and which cost new
      prop code or new mechanism. Ola wants to know before he draws so he
      can stay on the cheap side by choice.

## Open: from the dead-code audit (v0.14.2)

- [ ] Mobile has no repair control. `TouchInput` binds seven buttons and
      repair is not one of them, while index.html hardcodes "Hold E to
      repair the wall". Add a touch button and name the right control per
      platform.
- [ ] A mine proximity beep during its one-second arming window. The
      countdown is host-only sim state and emits no event, so this needs a
      new event rather than a rewiring.
- [ ] A flat-screen READY flash on magazine seat.
- [ ] A grab cue when the drone picks up a field crate.

---

## Done

Ticked with the version that shipped it.

### Archetype parity (Ola, 2026-08-23)
- [x] (v0.17.1) `docs/archetype-parity.md`: 23 behaviours, status per
      archetype, and what to do when adding one. Found four real parity
      failures, all of them a traverse silently inheriting or missing
      something written for a holdout: no supplies at all on a route
      level, loot that turned into field crates a grounded drone could
      never fetch, the wave director running, and enemies never being
      stepped. Probe assertions added for the first two.

### The movement foundation (Ola, 2026-08-23)
- [x] (v0.17.0) ONE authoritative movement system, swept so nothing is
      tunnelled through. `src/game/controller.js`. Input now reports
      DESIRED VELOCITY; only the controller moves anything.
- [x] (v0.17.0) Real gravity, a fall state and a landing, with impact
      speed reported so the game can react to it.
- [x] (v0.17.0) Ground detection from the feet, including in roomscale VR
      where the body follows the CAMERA and corrections go back to the rig.
- [x] (v0.17.0) Step-up limit, and a slope limit measured over a 0.7 m
      window rather than per sub-step. A per-step rise-over-run is infinite
      at every slab edge, which rejected every ramp and staircase.
- [x] (v0.17.0) Eye height derived from state every frame. Proven by the
      gym: identical before and after a fall.
- [x] (v0.17.0) Stuck recovery every frame, plus recovery from under the
      floor. The gym drops a player inside a wall and walks them out.
- [x] (v0.17.0) THE PHYSICS GYM at `?gym=1` with eight stations, and
      `test/gymprobe.mjs` asserting observable outcomes on all of them. It
      found seven real problems on its first run.
- [x] (v0.17.0) `level.lowered`: a pit has a FLOOR. Ground below the base
      floor was unreachable, so every pit was bottomless.
- [x] (v0.17.0) No enemy spawns within 6 m of a living player, and the
      arrival point is cleared of anything already standing on it before
      players are placed.
- [x] (v0.17.0) A traverse level does not run the wave director.
- [x] (v0.17.0) L3 DECIDED: the high-rise floor is REMOVED, not re-themed.
      Floor 3 is a holdout until it gets its own sketch. An office floor
      with balconies has no place in a campaign about crossing a landscape.

### L2 playtest bugs (Ola, 2026-08-23)
- [x] (v0.16.1) **Zombies do not attack at all on L2.** Verified before
      fixing, as asked: they were not failing to attack, they were never
      being STEPPED. `_stepZombies` ran only in the `night` and `elevator`
      phases, so the route phase moved nothing. Daylight raiders on L1 were
      frozen for the same reason. Replaced the phase list with an
      allow-list of phases in which the world is running.
- [x] (v0.16.1) **The chasm reads as a flat plate.** It has banded shaft
      walls going nine metres down, girders across the top to measure the
      drop against, and a floor at the bottom of them rather than one
      floating in space.
- [x] (v0.16.1) **Players clip through the chasm.** They fell already, but
      the horde stood on thin air over it: `extraBlocked` is called with the
      GRID and expects it to mark cells, and the void blocker was returning
      a coordinate predicate whose answer was thrown away. The hole was
      never in the navigation grid at all.
- [x] (v0.16.1) **Zombies spawn on the open floor instead of from holes.**
      A hole was a dark rectangle painted on a solid wall. It is a real
      opening now, cut out of a segmented wall, with a recess behind it
      that they walk out of.
- [x] (v0.16.1) **Pickups cannot be collected.** It was the rig-origin
      class of bug, as suspected: the radius was measured from the play
      space origin, so in VR a med kit at your feet was two metres away.
      Measured from the head now, with a bigger radius, a proximity prompt
      naming what it is, and a world-space confirmation in VR.

### Restart (Ola, 2026-08-23)
- [x] (v0.16.1) **TRY AGAIN left the player downed.** The simulation reset
      `down` and told nobody, so the client's own flag stayed latched. There
      is now ONE authoritative reset path that every restart and level
      transition calls, it announces itself, and the client DERIVES the
      downed state from the simulation rather than latching it from events.
- [x] (v0.16.1) The restart probe assertion now checks what a player would
      notice: not downed, full health, can move, can shoot. It previously
      asserted a phase name and was green while the game was unplayable.

### Earlier
- [x] (v0.16.0) Level 2, THE UNDERWORKS, built to the L2 sketch.
- [x] (v0.15.1) Teammates render as people, with tracked hands, IK arms and
      name tags, instead of a gas bottle.
- [x] (v0.15.0) Objectives are actionable: highlighted target, proximity
      prompt and hold-to-act ring for repair and revive.
- [x] (v0.14.3) The wrist display announces changes and colour-codes
      urgency. (Its POSITION is still wrong, see Open.)
- [x] (v0.14.3) VR shots read: weapon kicks, slide cycles, muzzle flashes.
- [x] (v0.14.3) The smoke test fails if the visible version has no
      CHANGELOG entry.
- [x] (v0.14.2) The dead-code audit: 43 things that existed and never ran.
- [x] (v0.14.1) Being downed in VR is no longer a softlock.
- [x] (v0.14.0) Levels are DATA, with a validator that fails loudly.
- [x] (v0.8.0) Roof finale with helicopter extraction, and the win state.
      *(Was still listed as a parked idea until the 2026-08-23 audit.)*
- [x] (v0.8.0) A boss level: the Butcher, on floor 12.
      *(Was still listed as a parked idea. "Every fifth level" is not done;
      see Parked.)*
- [x] (v0.7.x) A moving-platform level: the wagon.
      *(Was still listed as a parked idea as "train section".)*

---

## Parked, with reasons

Deliberately not being done now. Not forgotten, not silently open.

- **Co-located VR mode** (several headsets in one physical room). Needs an
  alignment ritual because WebXR gives each headset its own origin AND
  rotation. Big, self-contained, and worth doing only once the core game
  is worth playing together. The design is written down in git history.
- **Boss every fifth level.** There is one boss, on floor 12. More bosses
  is content work that should wait until the archetypes are proven.
- **Night-only travel between bases.** A good inversion, but it changes the
  campaign structure, which is still moving.
- **Host migration.** The run ends if the host drops. Real work in the
  netcode, low value until people play long sessions.
- **Voice chat over PeerJS.** Nice, not load-bearing; a phone call works.
- **Spectator mode.** Fun for an audience, no one is watching yet.
- **Realtime flyable drone.** The place-and-forget drone now has a real
  job. Flying it is a different game mode, not an improvement to this one.
- **Asymmetric PvP** (one player controls the horde). A whole second game.
- **Physical props in the gym hall.** Depends on co-located VR first.
- **Post-run stats** beyond the current victory screen.
- **Headlamp, laser sight and holo sight as scrap unlocks.** Parked as
  future upgrades. The headlamp that currently exists is being REMOVED
  (see Open, Bugs) precisely so it can come back as something you earn.
