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
