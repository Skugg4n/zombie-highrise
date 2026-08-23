# Parked ideas (pull in when the core is solid)

- [ ] **Co-located VR mode:** several headsets in the same physical room
      (the gym hall!). WebXR has no shared spatial anchors in the browser,
      so each headset has its own private origin AND rotation. Requires an
      alignment ritual: a physical floor marker (use the sports court
      lines!), each VR player stands on the same spot facing the same
      agreed direction and holds trigger 2 s, giving every headset the same
      mapping from physical space to game space. Re-align in the elevator
      each level to kill drift. Players then see each other's avatars where
      they REALLY stand (also a safety feature).
- [ ] Mode: you can only travel between bases AT NIGHT (fun inversion:
      day is safe but static, night opens the map but is dangerous)
- [ ] Host migration if the host drops (v1: run ends)
- [ ] Voice chat via PeerJS calls (P2P audio, no server needed)
- [ ] Spectator mode: an extra device that just watches (fun for an audience)
- [ ] Boss levels every fifth level
- [ ] Roof finale: last level on the roof, helicopter extraction
- [ ] Drone flyable in realtime instead of place-and-forget
- [ ] Train section as its own level type: defend the train while it rolls
- [ ] Asymmetric PvP later: one player controls the horde from the map view
- [ ] Physical props in the gym hall (thick mats = sandbags in-game?)
      Requires manually marking up the layout. Crazy but cool.
- [ ] Post-run stats: most kills, longest physical distance walked (VR)

## From the dead-code audit (v0.14.2)

- [ ] Mobile has no repair control. `TouchInput` binds seven buttons and
      repair is not one of them, while the prompt shows on every platform
      and index.html hardcodes "Hold E to repair the wall". Add a touch
      button and make the prompt name the right control per platform.
- [ ] A mine proximity beep during its one-second arming window. The
      countdown is host-only sim state and emits no event, so this needs a
      new event rather than a rewiring. The placement blip is done.
- [ ] A flat-screen READY flash on magazine seat. `magSeatFlashT` was
      declared for it and never built; deleted rather than left dangling.
      The other three seat confirmations (clack, viewmodel snap, VR charge
      light) all work.
- [ ] A grab cue when the drone picks up a field crate. The `fetched`
      event was pushed and never handled; the crate visibly rides home
      either way.

## Queue from Ola's v0.15.x VR playtest (logged 2026-08-23)

Logged while finishing L2, which Ola asked to come first. In his order.

### Wrist display, still wrong
- [ ] It sits on the UNDERSIDE of the hand, upside down. It must be on the
      FOREARM like a watch: same side as the back of the hand, angled so a
      natural turn of the forearm brings it to the eyes, and NOT attached
      to the hand itself.
- [ ] If the correct orientation cannot be determined without a headset,
      build the calibration aid Ola suggested: a bracelet around the
      forearm with numbers in a ring and letters marking the angle, so he
      can read off the coordinates that work and tell us. Faster than
      guessing, and guessing has now cost two attempts.

### Strategy view in VR (the drone is unusable without it)
- [ ] The wrist is the TRIGGER, not the whole surface. Looking at it
      unfolds a larger holographic panel at a comfortable distance, big
      enough to read the map and place a drone target precisely.
- [ ] Two interaction modes, both supported:
      - holster the pistol at the hip to free the hand for pointing
      - point with the barrel, trigger as the click
- [ ] The holster is a real physical object visible on the hip. Move the
      hand to it and press the hand button to stow or draw. Ola expects
      this to feel good, so it is worth doing properly.

### Bugs
- [ ] The ramp still clips. It is solid only when entered from the LOWEST
      end; entering from the side where it is higher clips straight
      through. (The probe walks it from the foot, which is why it passes.
      Add a side-entry case to test/rampprobe.mjs first, then fix.)
- [ ] The hand flashlight does not toggle on the trigger. It should.
- [ ] There is a HEADLAMP that should not exist yet. Remove it.
- [ ] Desktop HUD overlaps at the top: the objective banner and the base
      integrity bar collide and become unreadable. Lay out the top HUD so
      nothing can overlap at ANY window size, and add that to the UI state
      checks so it cannot come back.
- [ ] MINE and DRONE:MINE read as duplicates. If there is no real
      difference, remove the plain MINE. If there is, make the label say
      what it is.

### Feel and animation
- [ ] The VR reload is a slow quarter turn left and back, and it is
      unclear what it represents. Make it snappy and readable: one quick
      decisive motion, not a drift.
- [ ] Zombies attacking the base stand and stare while it breaks. They
      need a real attack animation that reads from across the field.

### Mechanics
- [ ] Shooting a mine should detonate it.
- [ ] Mines and barrels should damage each other, so chain reactions are
      possible and trap placement becomes a real tactical puzzle.

### Future unlocks (parked, not now)
- [ ] Headlamp, laser sight and holo sight as things you buy with scrap.
