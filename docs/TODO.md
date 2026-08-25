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

## Open: Ola's v0.22 VR playtest (2026-08-25) - with a sketch

- [x] (v0.23.0) THE DISPLAY IS ON THE WRONG SIDE OF THE ARM, and this
      time there is a drawing (docs/sketches/wrist-side.md): it sat on the
      PALM side, it must sit along the arm on the BACK-OF-HAND side. My
      error, finally localised: I derived "on top" as the weapon's +Y,
      but the back of the hand faces OUTWARD, sideways, when you hold a
      controller. The home is now dial position 10B, the dorsal side, and
      the home pose is applied THROUGH the dial's own maths so the two
      can never disagree again. The probe asserts the sketch: on the
      back-of-hand side, facing out through it, and NOT up the way the
      gun points up.
- [x] (v0.23.0) The strategy map is SO DARK you can barely make anything
      out. It rendered the scene with the scene's own lighting, so the map
      of a dark level was dark. The pass adds its own flat diagram light
      now, tuned by LOOKING at the saved screenshot (test-artifacts/
      strategy-dark-level.png, regenerated every probe run) rather than by
      a number: mean brightness went 17.7 -> 103.6 and the picture reads
      as a plan drawing.
- [x] (v0.23.0) The map fills nearly the whole view AND it draws on top
      of the wrist display. 65 degrees wide down at arm height with depth
      testing off. Now 33 x 27 degrees at eye level, depth-tested so your
      own arm occludes it like a real object, and glancing back down at
      the wrist no longer starts the fold timer.

## Open: Ola's v0.21 VR playtest (2026-08-24) - ANGRY, AND RIGHT

### Blocking bugs
- [x] (v0.22.0) THE DRONE MAP IS BLACK AND WILL NOT CLOSE. "Den är HELT svart och den
      går inte att ta bort igen! Så man måste DÖ för att få bort den!"
      Two bugs in one: the panel renders black, and there is no way out of
      it. Nothing in this game may ever require dying to dismiss.
      Fixed: inside a WebXR session renderer.render ignores the camera it
      is given and draws into the session's framebuffer, so the map pass
      produced nothing. And A, B, X, the stick, looking away, going down
      and changing level all close it now. The panel says the way out on
      itself.
- [x] (v0.22.0) The pistol cannot be put in the holster at all.
      It was pinned near the rig origin, which in roomscale is not where
      you are standing. It follows the body now, at hip height derived
      from eye height, lights up when a hand is near, and the squeeze
      checks the holster first for either hand.
- [x] (v0.22.0) Buying two pistols gives TWO IN EACH HAND. Four guns.

### The wrist, for the third time, and the actual answer
      The akimbo MESH is two pistols in one object. Each VR hand gets a
      single pistol now.
- [x] (v0.22.0) Ola: "Om du kan lista ut var fan pistolen pekar och vad som är upp
      och ner på den lär du ju fan kunna lista ut var displayen ska
      sitta!" He is right, and this is the fix: DERIVE the display's
      transform from the weapon's, which is known-good because he can see
      the gun pointing the right way. Stop guessing offsets.
      Done. Two sign errors: y was negative (under the arm) and the
      rotation was +PI/2 (facing down). Derived from the weapon frame
      now, and the probe checks it against the weapon's axes.
- [x] (v0.22.0) The calibration bracelet inherited the exact bug it was built to
      solve: it was attached to the same grip with the same wrong
      orientation, so it sat under the arm where he could barely see it.
      Ola: "Sätt fucking armbandet som du satt fucking ficklampan! Rakt
      jävla fram! Sätt nummer runt och bokstäver i vinkel." The
      calibration UI must be somewhere he cannot fail to see it.
      The readout is a card in front of your face now, at the debug
      menu's distance, with a ring of twelve and five angle bars.
- [x] (v0.22.0) "Den skriver ut sin position på sig själv" is useless advice when
      the thing printing it is the thing you cannot see.

### Method
      The card in front of your face carries the coordinate.
- [x] (v0.22.0) Ola: "Använd critics för att kontrollera att fucking funktionerna
      blir bättre och inte bara annorlunda!" Every VR fix in this round
      gets checked by a critic pass before it is called done, not just a
      probe that says the variable changed.

## Open: Ola's v0.15.x VR playtest

### Wrist display, still wrong
- [x] (v0.22.0) It sits on the UNDERSIDE of the hand, upside down. It must
      be on the FOREARM like a watch: same side as the back of the hand,
      angled so a natural turn of the forearm brings it to the eyes, and
      NOT attached to the hand itself. It was two sign errors: y was
      negative, which is under the arm, and the rotation was +PI/2, which
      faces a plane down. Derived from the weapon's frame now, and the
      probe checks it against the weapon's axes rather than against
      numbers typed by hand.
- [x] (v0.18.1) Build the calibration aid instead of guessing again: a
      bracelet around the forearm with numbers in a ring and letters
      marking the angle, so Ola can read off the coordinates that work.
      Guessing has cost two attempts already. Open the debug menu in VR:
      "Wrist: move AROUND the arm" and "Wrist: change the ANGLE" step the
      display through 12 positions and 5 tilts, the bracelet shows where
      it is, and the choice is saved. The display prints its own
      coordinate, e.g. POSITION 7C.

### Strategy view in VR (the drone is unusable without it)
- [x] (v0.19.0) The wrist is the TRIGGER, not the whole surface. Looking
      at it unfolds a larger holographic panel at a comfortable distance,
      big enough to read the map and place a drone target precisely. Half
      a second of looking at the wrist unfolds it; looking away for a
      moment folds it. The panel is textured by a render of the SAME map
      camera the flat map uses, so it cannot drift out of agreement with
      the map on the screen, and it is world-locked rather than
      head-locked, because you cannot point precisely at something that
      moves with your head.
- [x] (v0.19.0) Support both interaction modes: holster the pistol at the
      hip to free the hand for pointing, AND point with the barrel using
      the trigger as the click. Both, with no mode switch: what you are
      holding decides which hand points.
- [x] (v0.19.0) The holster is a real object visible on the hip. Move the
      hand to it and press the hand button to stow or draw. The weapon
      mesh physically moves between hand and hip, and a stowed weapon
      cannot fire.

### Bugs
- [x] (v0.17.0) The ramp clipping when entered from the side. Fixed by the
      character controller, and the gym has a station that reproduces it:
      "a ramp cannot be entered from the side: you are stopped, not
      absorbed".
- [x] (v0.18.3) The hand flashlight does not toggle on the trigger. It
      should. The empty hand's trigger is the torch's switch now. The
      toggle is also authoritative: it used to read "on if you toggled it
      OR the level is dark", so underground the lamp was permanently lit
      and the switch did nothing on exactly the levels where you want it.
- [x] (v0.18.3) Remove the headlamp. It should not exist yet. Nothing
      shines from the camera in VR any more; light comes from the hand
      that carries the torch. The flat screen keeps its eye-mounted cone,
      because a flat player has no hand to carry one from. A real headlamp
      is parked below as a scrap unlock.
- [x] (v0.18.1) Desktop HUD overlaps at the top: the objective banner and
      the base integrity bar collide and become unreadable. The top of the
      screen is one three-cell grid now, not five independent absolute
      positions, so nothing there can overlap anything else. smoke.mjs
      checks every visible box against every other at five window sizes
      with all boxes forced visible, and it found two more overlaps on a
      phone that nobody had reported yet.
- [x] (v0.18.2) MINE and DRONE:MINE read as duplicates. If there is no
      real difference, remove the plain MINE. If there is, make the label
      say what it is. There was no difference: the drone carried the same
      mine to the same place for 10 scrap while the plain button charged
      12. The plain button is gone; remote delivery is the drone's job.

### Feel and animation
- [x] (v0.19.1) The VR reload is a slow quarter turn left and back, and it
      is unclear what it represents. It is three beats now: the gun snaps
      over and the magazine drops out, a beat where the well is visibly
      empty, then a fresh magazine seats and the gun snaps upright. The
      weapons grew a tagged magazine part so there is something to watch.
- [x] (v0.19.1) Zombies attacking the base stand and stare while it
      breaks. They need an attack animation that reads from across the
      field. Whole body: arms over the head and down, torso rocking with
      them, each on its own clock so a crowd does not swing in lockstep.
      The wall attack pushed no event and set no state at all, which is
      why nothing had ever moved.

### Mechanics
- [x] (v0.18.2) Shooting a mine should detonate it. Armed mines are in
      the hit test now, on a deliberately small 0.3 m target so it is
      never a stray hit.
- [x] (v0.18.2) Mines and barrels damage each other, so chain reactions
      are possible and trap placement becomes a real tactical puzzle. One
      detonation path for mines now, so anything that can set one off sets
      off everything in range: shots, zombies, other mines, barrels.

## Open: Ola's L2 playtest and process notes (2026-08-23)

### Probes must measure players, not variables
- [x] (v0.21.0) Go through EVERY probe assertion and make each assert what
      a player would notice, not what a variable does. All 21 probes done,
      listed in `QUALITY.md`. Twelve of them could not fail at all: they
      printed numbers and exited 0 whatever the numbers said. Found four
      real bugs in the process, including a debug hook that had been dead
      since v0.17.0 (and had been silently disabling the pressure bot's
      movement) and an enemy mix that went negative from night 7.
      `node test/all.mjs` runs the lot. (The restart assertion was done
      earlier; the rest of the suite is now done too.)

### Tooling to make future levels fast
- [x] (v0.20.0) Hot reload of level data files in dev, so changing a
      number rebuilds the level without restarting the run. `?hot=1`.
      Same phase, same scrap, same inventory, and you keep standing where
      you were standing if that spot still exists. Pairs with
      `?levelpreview=N` for a diagram that redraws itself as you edit. A
      half-typed file is reported and the last good level keeps standing.
      `test/hotprobe.mjs` edits a real data file on disk while the game
      is running and checks all of that.
- [x] (v0.20.0) Write the practical version of cheap-versus-expensive:
      which kinds of sketch are just numbers and existing props (free),
      and which cost new prop code or new mechanism. `docs/sketching.md`,
      with the whole prop library in a table, the tell for each cost tier
      ("if describing it needs the word WHEN, it is a mechanism"), and
      advice on what to put in a sketch in the first place.

## Open: from the dead-code audit (v0.14.2)

- [x] (v0.19.2) Mobile has no repair control. `TouchInput` binds seven
      buttons and repair is not one of them, while index.html hardcodes
      "Hold E to repair the wall". There is a HOLD button now, which
      appears only when there is something to hold and says which of the
      two it is, and the prompt names the right control per platform.
      Checked in `interactprobe` on a real touch device profile, through
      the real button.
- [x] (v0.19.2) A mine proximity beep during its one-second arming
      window. There is an `armed` event now, with its own two-chirp cue:
      placement and arming used to be the same beep, and only one of them
      was true.
- [x] (v0.19.2) A flat-screen READY flash on magazine seat. The ammo
      readout itself pulses, because that is where you look to find out
      whether you can shoot.
- [x] (v0.19.2) A grab cue when the drone picks up a field crate. A claw
      clack and a servo whine, plus a line for the owner. It was the one
      moment of the fetch errand worth watching and nothing announced it.

---

## Done

Ticked with the version that shipped it.

### Dying in VR, and a debug menu (Ola, 2026-08-23)
- [x] (v0.18.0) Recovery from death no longer depends on an event being
      delivered: pressing A puts the local player back on their feet
      directly, and a downed solo player is always offered a way back
      rather than only a way out. The probe now dies the way a player
      dies, and presses the button through the real gamepad loop instead
      of calling the handler.
- [x] (v0.18.0) A debug menu on every platform: give weapons, scrap, ammo
      and kit, revive, jump to any floor, skip a wave, repair the base.
      Y in VR, F8 on desktop. It also prints live state, so a fault in a
      headset can be read out loud instead of guessed at.
- [x] (v0.18.0) `?levelpreview=N`: any level from above, labelled with the
      base, every spawn coloured by ring and tagged with what it hides
      behind and how far out it is, the exit, the chasm, the doors, a
      scale bar and a legend.

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

- **The headlamp, as a scrap unlock.** Removed in v0.18.3 because it
  existed without being earned. It belongs in the same shelf as the laser
  and the holo sight: gear you buy, which frees your off hand from the
  torch and is therefore a real decision rather than a free upgrade.

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
