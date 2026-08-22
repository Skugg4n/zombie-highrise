# TEST-ON-DEVICE - live checklist for Ola

Live build: https://skugg4n.github.io/zombie-highrise/
Always check the version tag (top-right corner) FIRST: Quest caches hard.
Report breakage as "device + what you did + what you saw".

## v0.8.2 - the run now has an ENDING (start here)

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
