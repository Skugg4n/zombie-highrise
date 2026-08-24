# TEST-ON-DEVICE - live checklist for Ola

Live build: https://skugg4n.github.io/zombie-highrise/
Always check the version tag (top-right corner) FIRST: Quest caches hard.
Report breakage as "device + what you did + what you saw".

## v0.22.0 - THE FOUR THINGS YOU REPORTED (START HERE)

Each of these is a thing you told me was broken. If any of them is still
wrong, say which and I will not treat it as a matter of taste again.

**The wrist display.** It was two sign errors, not ergonomics: it was
below the arm and facing down. It is derived from the gun's own axes now.

- [ ] It sits on TOP of your forearm, tipped back toward your eyes, so a
      modest turn of the forearm brings it into view. It starts at
      position 1C. If flat-like-a-watch is what you wanted, step the
      ANGLE back to A.
- [ ] Raising your forearm naturally brings it to your eyes.
- [ ] If it is still off, open the debug menu (Y). A card now floats in
      FRONT OF YOUR FACE with twelve numbers in a ring and five angle
      bars, and it moves as you step it. Read the coordinate off THAT,
      not off your arm. "Wrist: BACK TO DEFAULT" undoes any mess.

**The drone map.**

- [ ] It shows the level, not a black rectangle. If it is still black it
      should now say "map not available" in words.
- [ ] A, B or X closes it. So does clicking a stick. So does turning
      away. So does going down. You should never have to die again.
- [ ] It should NOT open by itself while you are shooting.
- [ ] Y still cycles the drone payload while it is open.

**The holster.** Note the change: it is a HOLD now.

- [ ] The loop is beside your RIGHT hip and comes with you when you walk.
      It was on the left hip and behind you, which is why you could not
      find it.
- [ ] It LIGHTS UP when your gun hand is close enough to use it.
- [ ] HOLD the right grip there for about a third of a second to stow the
      pistol. Hold again to draw it.
- [ ] A QUICK squeeze there must still RELOAD. This is the important one:
      a holster and a resting hand are in the same place, so if a quick
      squeeze stows instead of reloading, say so immediately.

**Two pistols.**

- [ ] Buy akimbo. You should have ONE pistol in each hand, two in total.
- [ ] With both hands full, X toggles the flashlight, since no hand is
      carrying it.

## v0.19.0 - THE STRATEGY VIEW, THE HOLSTER, THE TORCH

Everything in this block is new since your last headset session. The
first two answer "the drone is unusable in VR" and the rest are your
v0.15.x bug list.

**The wrist, one more time.** Open the debug menu (Y on the left
controller) and use "Wrist: move AROUND the arm" and "Wrist: change the
ANGLE". A bracelet appears on your forearm with 12 numbered pips and
letters A to E, and the display prints its own position on itself, like
POSITION 7C. Step it until it sits where a watch sits and reads right,
then pick "Wrist: done, hide the bracelet". Tell me the two characters
and I will make that the default. It is saved on your headset meanwhile.

- [ ] The bracelet is readable and stepping it actually moves the display.
- [ ] Report the coordinate that works, e.g. "9B".

**The strategy view.** This is the panel you asked for.

- [ ] Raise your forearm and LOOK at the wrist display for about half a
      second. A large panel should unfold in front of you, showing the
      level from above.
- [ ] Look away from the panel for a second. It should fold itself.
- [ ] Point at the map with the pistol barrel. A crosshair should follow
      where you point, and a line at the bottom should say what the
      trigger will do and what it costs.
- [ ] Pull the trigger on a spot. The drone should launch and fly to
      THAT spot. This is the one to watch closely: tell me if it goes
      somewhere else, especially if it goes to the mirror-image spot.
- [ ] Y on the left controller cycles the payload while the panel is
      open: MINE, TAR, SPIKES, FLARE, FETCH.
- [ ] The panel should stay where it appeared when you move your head.
      If it follows your face, say so.

**The holster.**

- [ ] There is a visible loop on your right hip.
- [ ] Move your right hand to it and squeeze. The pistol should move from
      your hand to the loop, visibly.
- [ ] With it stowed, your now-free hand points at the map instead.
- [ ] Squeeze at the hip again to draw it back.
- [ ] Squeeze anywhere ELSE and it should still reload, not stow.

**The torch and the headlamp.**

- [ ] The empty hand's trigger now turns the flashlight on and off.
- [ ] Underground it starts lit and the trigger can turn it OFF.
- [ ] Nothing should be shining from your face any more. If you still see
      light coming from your viewpoint in VR, say so.

**Two animations that were saying nothing.**

- [ ] Reload in VR. You should see the magazine DROP OUT of the gun, a
      moment with an empty well, then a fresh one snap in. Tell me if it
      still reads as the gun just tipping over.
- [ ] Let the horde reach the base wall and watch from the far side of
      the field. They should be visibly swinging at it, arms over the
      head and down, and not all in time with each other. They used to
      stand perfectly still while the bar went down.

**Mines.** (Anywhere, VR or flat.)

- [ ] Shoot a mine you laid: it should go off.
- [ ] Lay two or three in a row and shoot one: the whole row should go.
- [ ] Lay one next to an explosive barrel and shoot the barrel: the mine
      should go with it.
- [ ] Stand next to your own mine and shoot it. It should hurt YOU. This
      is deliberate; tell me if it hurts too much.
- [ ] Underground on floor 2, you can now lay mines at all. You could not
      before.

**On a phone.**

- [ ] Stand at a damaged bit of wall during the day. A HOLD button should
      appear at the end of the action row, and the prompt should say
      "HOLD THE BUTTON", not "HOLD E".
- [ ] Hold it. The ring fills and the wall repairs.
- [ ] Walk away. The button should disappear again.
- [ ] Same for the door button on floor 2.

**Three things that used to happen silently.**

- [ ] Lay a mine and listen: a beep when it lands, then two rising chirps
      a second later when it goes live.
- [ ] Send the drone to FETCH a crate outside the wall. You should hear
      the claw take it and get a line saying so, rather than finding out
      when it lands.
- [ ] Reload on a flat screen: the ammo readout should flash.

**Desktop only.**

- [ ] Make the browser window narrow, phone-shaped. Nothing at the top of
      the screen should sit on top of anything else.
- [ ] The tactical map has only PING and DRONE now. The old MINE button
      is gone: it did the same thing as the drone for more scrap.

## v0.16.0 - LEVEL 2 IS IN

Floor 2 is THE UNDERWORKS, the traverse level from your L2 sketch. Clear
floor 1, ride the lift, and you land in it.

- [ ] You arrive on a plate in the north-west corner, in a small
      antechamber. It is DARK. Your off-hand flashlight finally matters.
- [ ] The only way out is the sliding door. Walk to the button beside it
      and HOLD (E, or the left grip in VR). A ring fills. Let go and it
      drains.
- [ ] Objective: reach the lift in the far south-east corner. It is lit
      green and you can see it from most of the room.
- [ ] THE CHASM in the middle. Walk into it on purpose once: you should
      fall a long way, take about 45 damage, and be put back on solid
      floor rather than left falling. Then check the horde never walks in.
- [ ] Waves come because you MOVE, not on a clock. Push forward and you
      should get "They heard you move." Stand still and the pressure
      should stay where you left it. Tell me if that reads.
- [ ] The fence on the east side blocks the direct route past the chasm.
      You should have to go the long way round.
- [ ] Three holes in the walls: two east, one south. Nothing should ever
      appear from nowhere.
- [ ] Open the map underground: the drone button should say NO SIGNAL and
      refuse, rather than pretending.
- [ ] SIZE: it is 13x13, not the 10x10 on your sketch. At 10 the ring
      around the chasm is under two metres and four players cannot pass.
      Tell me if 13 feels too roomy and I will dial it back.

## v0.13.0 - VR CAN SEE (CHECK THIS FIRST IN THE HEADSET)

- [ ] WRIST DISPLAY: turn your left wrist toward you like checking a
      watch. It should show the objective in plain words, how many are
      left, HP, base integrity, scrap, weapon and ammo. Tell me if
      anything you need is still missing from it.
- [ ] AMMO ON THE GUN: a counter on the weapon itself, red at zero.
      You should never need the wrist mid-fight.
- [ ] RELOAD: point the gun at the floor and hold. You should hear the
      mag come out, hear it hit the floor, hear the new one seat with a
      clack, and see the charge light go green.
- [ ] EMPTY: pull the trigger with an empty gun. A hard CLICK.
- [ ] LEFT HAND: a flashlight you aim yourself. On floor 1 (daylight) it
      is carried but unlit, which is deliberate. With dual pistols it
      moves under the barrel.
- [ ] RAMP: walk up and down it in roomscale. You should not fall
      through. This was the ground being sampled under the play-space
      origin instead of under you.
- [ ] RECOIL: fire fast and watch the gun kick in your hand. Your AIM
      must never be moved for you, only the spread should widen.

## v0.13.0 - EVERYWHERE

- [ ] SHOOTING: tap-fire is dead accurate; spam and the muzzle climbs off
      the target. The pattern is the same every burst, so you can learn
      to pull against it. Tell me if it feels unfair rather than skilful.
- [ ] BASE UNDER ATTACK: you should hear which section is nearly gone
      without looking, and an alarm that speeds up as the perimeter
      fails.
- [ ] THE APPROACH: something should be on you within about ten seconds
      of a wave starting, with more gathering at 25 m and 40 m. THIS IS
      THE THING I MOST WANT JUDGED: is the walk-in interesting, or is it
      waiting?
- [ ] FIELD CRATES: kill something far out and a crate with a blue beacon
      drops. Open the map, set the drone to FETCH (free) and click it.
      The drone should carry it home and land it in the base.
- [ ] No zombie should ever be unkillable or unreachable. If a wave ever
      sticks with one left, tell me where it was standing.

## v0.11.0 - THE FIRST HOLDOUT LEVEL

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
