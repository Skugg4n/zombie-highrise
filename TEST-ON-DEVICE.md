# TEST-ON-DEVICE - live checklist for Ola

Live build: https://skugg4n.github.io/zombie-highrise/
Always check the version tag (top-right corner) FIRST: Quest caches hard.
Report breakage as "device + what you did + what you saw".

## v0.9.3 - Ola's playtest fixes (START HERE)

Everything below came from your last session. Please check these first.

- [ ] LEVELS ARE BIG NOW on every platform, including desktop and
      including SMALL play area. Corridors, rooms, cover, ramps up to
      platforms, multiple routes. Nothing should feel like a shoebox.
- [ ] The dashed amber square on the floor is your roomscale zone. In VR
      roomscale you are re-centred onto it each floor; the level extends
      far beyond it and you shoot out into it.
- [ ] The first zombie arrives within a couple of seconds of START, and
      zombies keep trickling in DURING THE DAY. You should never be
      standing around with nothing to do.
- [ ] Mines are cheap now (18) and you start with 2. Press T during the
      day to lay one.
- [ ] Look at where enemies come from: a stairwell, an open elevator
      shaft, wall breaches, climbers over the balcony, gates, trench
      tunnel mouths. Tell me if any enemy still appears from nowhere.
- [ ] RIGHT CLICK aims down sights (Shift also works). With DUAL PISTOLS
      left and right mouse fire the left and right gun so they alternate.
- [ ] Shoot a zombie in the head: 2.5x damage, amber HEADSHOT callout.
- [ ] Every weapon now has a reload animation.
- [ ] Walk up to the elevator: the doors should open as you approach and
      stay open. Tell me if they ever shut in your face.
- [ ] Difficulty: night 1 should be manageable, night 5 sweaty, night 9
      desperate. Each floor announces its own name and twist on arrival.
      Tell me where it is still too easy.

## v0.8.2 - the run now has an ENDING

A full run is 12 floors. Floor 12 is the Butcher's arena; beating him
triggers the roof extraction and the victory screen. That is the win
state, and it is the single most important thing to verify.

### Desktop, solo, one sitting (~20-40 min)
- [ ] PRACTICE SOLO, play floor by floor. The floor cycle is ground,
      basement, upper, ground, trench, wagon, then repeats with the boss
      arena replacing the second wagon slot on floor 12.
- [ ] From night 3 on, some nights announce a MODIFIER (fog, frenzy,
      blackout, swarm, harvest). Check the toast matches what you feel:
      fog = short sightlines, blackout = very dark (night vision helps),
      swarm = many weak walkers, harvest = lots of drops.
- [ ] Every 3rd night is a SURGE (announced); the day after is longer
      with extra loot.
- [ ] New enemies appear as nights climb: SPITTER (green, keeps distance
      and lobs acid), CRAWLER (low and fast, lunges when close),
      SCREAMER (pale, hangs back, screams to summon reinforcements).
- [ ] Explosive barrels (red with a yellow band) sit near the entrances.
      Shoot one as zombies funnel past. It should chain to nearby barrels
      and hurt you if you are too close.
- [ ] Floor 12: the BUTCHER. He telegraphs a charge (roar), then charges
      in a straight line. Dodge behind a pillar, then shoot his back
      while he recovers (back hits do double damage).
- [ ] Kill him: "EXTRACTION" appears, the helicopter flies in from the
      west, and after ~14 s you get the EXTRACTED victory screen with
      your run stats. RUN IT AGAIN should start a fresh run on a new
      building.

### Phone (join a desktop host)
- [ ] Joystick, drag-look, FIRE, and the action buttons all work.
- [ ] The client sees the same modifiers, barrels, boss and ending.
- [ ] Lock the phone ~10 s, unlock: "Connection stalled" then recovery.

### Quest 2
- [ ] ENTER VR from the lobby in both hosting and joined states.
- [ ] Trigger fires, right grip reloads, left grip drops a mine,
      A cycles weapon, B throws, X uses a pack, Y is the flashlight,
      stick-press cycles throwable / toggles night vision.
- [ ] Explosions do NOT shake the view in VR (comfort rule).
- [ ] Report the frame rate feel on floor 1 night 2 with 15+ zombies.
- [ ] The roof finale: the helicopter should be readable in VR too.

## Known limitations (documented, not bugs)
- Cross-network play needs NAT-friendly home networks (no TURN server).
- Host death ends the run; host migration is parked.
- Visual polish stopped mid-loop by budget decision: the art is
  functional and consistent but not final (see HANDOFF.md).
