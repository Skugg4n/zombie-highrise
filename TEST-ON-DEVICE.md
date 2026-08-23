# TEST-ON-DEVICE - live checklist for Ola

Live build: https://skugg4n.github.io/zombie-highrise/
Always check the version tag (top-right corner) FIRST: Quest caches hard.
Report breakage as "device + what you did + what you saw".

## v0.11.0 - THE FIRST HOLDOUT LEVEL (START HERE, THIS IS THE ONE)

This is the level to judge. Everything else in the build is the old
high-rise content still sitting further up the cycle. Play floor 1 and
tell me whether it is fun on its own; nothing else gets built until it is.

### Desktop, solo, floor 1 only
- [ ] You start inside a small base in a big open daylight field. You can
      see a long way. The far ground dissolves into haze.
- [ ] Walk the whole base. You cannot get out, in any direction. That is
      deliberate. Tell me if it feels like a cage rather than a position.
- [ ] Walk up the ramp in the north-east corner onto the snipe platform.
      From there you shoot out over the wall into the field.
- [ ] Watch where they come from: the ridge, behind the lone tree, the
      burnt-out cars, the rock field, the ruined houses. Nothing should
      ever appear in the open. Tell me if anything does.
- [ ] They walk 30 to 45 m to reach you. Is that approach interesting or
      is it waiting? This is the question I most want answered.
- [ ] Let them reach the wall without shooting. They attack it: segments
      go red and sink, then break. The BASE bar at the top drops. Losing
      the wall entirely ends the run.
- [ ] During the DAY, stand next to a damaged bit of wall. Press E to
      repair for 5 scrap. Is patching the base every morning worth doing,
      or busywork?
- [ ] Open the tactical map (M). It now frames the whole field. Click
      DRONE to cycle its payload: MINE / TAR / SPIKES / FLARE, price on
      the button. Click a spot in the field and watch the drone fly out
      with the payload slung underneath, drop it, and come home.
- [ ] Drop a FLARE out on an approach lane during a night. The horde
      should visibly walk toward it instead of you. Then mine that lane.
- [ ] Explosive barrels sit inside the base and out on the approaches.

### Quest 2
- [ ] The base IS your roomscale play area now. Walking it physically
      should line up with the dashed amber square.
- [ ] VR AIM: the gun now points exactly where the shot goes. This was
      about 45 degrees off. Point at a zombie and confirm you hit it.
- [ ] Left grip is contextual: it repairs a damaged wall you are standing
      at during the day, and drops a mine otherwise.

### Everywhere
- [ ] GRAVITY AND GROUND: walk up and down the ramp. You should step up
      cleanly, walk down cleanly, and be unable to scale the platform's
      side. Nothing should feel flat or weightless.
- [ ] NAVIGATION: no zombie should freeze, jitter, or grind against
      geometry. They should route around cover and pour through breaches.

## v0.9.3 - Ola's playtest fixes (older, still worth a look)

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
