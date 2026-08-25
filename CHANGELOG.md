# CHANGELOG - ZOMBIE HIGH RISE

## v0.23.1 - 2026-08-25 - the critic's pass over the sketch round

The critic confirmed the direction of v0.23.0 (right axis per the sketch,
verified maths, one code path) and found four real holes. All verified in
the code before acting, all fixed:

**The panel could spawn inside a wall, invisible, while owning the
trigger.** placeFor hung the map 1.05 m ahead with no collision check, and
underground corridors are often narrower than that. With depth testing on
the panel was then completely invisible while `selectstart` still went to
it instead of the gun: "I looked at my watch and now the pistol does not
fire", the quiet cousin of the black-map trap. The opening now marches
along the heading through the same colliders the player collides with and
clamps the distance to the free space; under half a metre the panel draws
over the wall (x-ray) instead of ever vanishing. Probed underground
against a tall wall, and falsified: removing the clamp goes red.

Finding the trap also surfaced two test-seam bugs: `debugLook` set yaw
variables that only the flat frame loop applies, so in a fake VR session
it did nothing and the wall test measured a player facing open field; and
teleporting closer to a wall than the body's push-out radius shoves the
player to the far side before the panel opens. The first wall test
"passed" on floor 1 for a third reason: the base wall is LOW so you shoot
over it, and a panel at eye height is legitimately visible above it. The
trap only exists where walls are taller than your eyes, so that is where
the test lives.

**The empty-map guard was defeated by its own clear colour.** _hasContent
asked "is any pixel brighter than 12" while the clear colour itself
averages 24, so in exactly the case the guard exists for, a pass that
cleared and drew nothing, it answered "content". It now compares samples
against the clear colour: content means something DIFFERS from the
ground.

**The diagram light would have clipped the daylight map to white.**
Render-target passes skip tone mapping (verified in the vendored build),
so the ambient 5.0 that makes an underground map readable would push a
sunlit field into linear clipping: a whiteboard with dots. The light now
scales with the level's darkness (5.0 dark, 1.2 daylight), and the probe
holds a ceiling on the daylight map (mean under 230) next to the floor on
the dark one (over 80).

**Two smaller ones:** the bracelet still highlighted pip 1 as home from
the era when 1 WAS home; the current pip is now marked live, one source of
truth. And the fold timer's attention check now requires the display to
face you, same as the open gesture, so the torch hand riding just under
your gaze on a dark level no longer keeps the panel open after you have
gone back to playing.

## v0.23.0 - 2026-08-25 - the sketch ends the guessing, and the map becomes a map

**The wrist display, with a drawing this time.** Ola drew it
(docs/sketches/wrist-side.md): the display sat on the PALM side of the
wrist, it belongs along the arm on the BACK-OF-HAND side. The drawing
localised my error exactly. I had derived "on top of the arm" as the
weapon's +Y, which is UP when you aim, and the derivation was fine: the
premise was wrong. When you hold a controller, the palm faces inward and
the back of the hand faces OUTWARD, sideways. The dorsal side of the
wrist, where every watch in the world sits, is the weapon frame's -X for
the left arm, roughly perpendicular to the weapon's up. Right maths,
wrong axis, three versions running.

The home is dial position 10B now, and it is applied THROUGH the dial's
own maths: attachTo() calls setCalibration() instead of carrying its own
copy of the transform, so "where the display is" and "what the label
says" are one computation. The probe asserts the sketch itself: on the
back-of-hand side, facing out through it, tipped toward the eyes, and NOT
up the way the gun points up, which was the old wrong guess and now goes
red if it comes back.

**The map was so dark you could only sense where things were.** Ola:
"tittar du inte hur det ser ut?" No, was the honest answer: I measured
it, and the measurement passed while the picture was murk. The map
rendered the scene with the scene's own lighting, so on a dark level the
map of the dark level was dark. The pass adds its own flat diagram light
now, the same rule ?levelpreview=N already follows, and the intensity was
set by LOOKING at the saved screenshot until it read as a plan drawing:
light floor, walls, the chasm, the doors, the blips. The screenshot is
regenerated on every probe run (test-artifacts/strategy-dark-level.png)
so the number's honesty can keep being checked by eye, and the threshold
sits above the value that had passed while the picture was still murky.

**The map filled nearly the whole view and covered the wrist display.**
0.92 m wide at 0.72 m is 65 degrees, hung at arm height, drawn with depth
testing off so it painted over everything nearer, including the display
that had just opened it. It is 33 x 27 degrees at eye level now, and
depth-tested, so it behaves like an object in the world: raise your arm
in front of it and your arm wins. The wrist sits below it, both visible
at once, and glancing back down at the wrist no longer starts the fold
timer, so comparing the two does not make the panel flap.

Also: the phone repair check in interactprobe held for a fixed 1.1
seconds and lost the race one run in three on a busy machine. It holds
until the ring fills now. A flaky test teaches people to rerun failures,
which is the end of trusting red.

## v0.22.2 - 2026-08-25 - the same bug, mirrored onto the other hand

A second critic pass on v0.22.1. It confirmed three of Ola's five
complaints were genuinely fixed, and found that I had moved one bug rather
than removed it.

**The right grip at the hip stowed the pistol instead of reloading.** The
grab radius had been widened to 0.34 m to compensate for the holster being
in the wrong PLACE. The place got fixed and the compensation stayed, so
the bug that had just been removed from the left hand appeared on the
right, where it is worse: the left grip is mines and wall repair, but the
right grip is the RELOAD. Lowering the gun and squeezing is how everyone
reloads, and it would have stowed the weapon instead, mid-wave, leaving
him unarmed in front of a horde.

No probe could see it. The holster seam teleports the hand onto the
holster before measuring, so any radius passes.

**And no radius can fix it**, which is the actual lesson. A holster sits
at the hip and a relaxed arm hangs at the hip: about 18 cm apart. Any
radius big enough to find by feel also catches the reload. So the
distinction is the HOLD, not the distance: a quick squeeze at the hip
reloads exactly as it does anywhere else, and holding for a third of a
second stows or draws. That is the same hold-to-act vocabulary the wall
repair and the door already use. The new test squeezes with the hand
directly on the holster and requires the ammunition to go up.

Also from the same pass:

- **The status row was about to report the wrong coordinate.** The display
  starts at the orientation the class calls 1A, but the default tilt index
  was 2, so `label()` said "1C". That label was added to the debug menu
  specifically so Ola could read it out loud. The first press of "change
  the ANGLE" also jumped A straight to D.
- **The bracelet still used the collapsed maths** the calibration ring had
  just been rid of, so the dial on the arm and the display it drives
  disagreed about direction.
- **`debugWristFrame` compared the wrong hand's gun**, and only agreed
  because the test poses both controllers identically. It takes the weapon
  on the same arm now.
- **The paint check stalled the most expensive frame of the whole
  feature.** `readPixels` is a synchronous GPU stall of several
  milliseconds against a 13.9 ms budget, and it was running on the frame
  that also places the panel, walks the level to hide ceilings, and does
  the first map render. It happens two passes later now. It also sampled 8
  pixels from the exact centre, which on a dark underground level could
  read as blank and cover a WORKING map with an error message; it samples
  32 and the panel clears to a colour, so black now means one thing only.
- **A sleeping controller could let you holster the flashlight**, because
  `disconnected` cleared the hand assignment without re-dressing.
- **Hand tracking was in `optionalFeatures`** while nothing supports it,
  and it breaks the wrist mount: with tracked hands the target ray comes
  from a finger rather than being rigid to the grip, so the display would
  swim along the forearm.

**The default angle is now C**, tipped 60 degrees back toward the eyes
rather than lying flat. Flat is what a watch does, but reading a flat face
means holding the forearm level and bending your neck at it. Noted in
OPEN-QUESTIONS.md; the dial reaches every other angle in two presses.

One more small lesson: my first version of the new "is it tipped toward
your eyes" assertion had the sign backwards and went red for the correct
behaviour. An assertion written from a guess about a sign is the same
mistake as code written from a guess about a sign.

## v0.22.1 - 2026-08-24 - v0.22.0 claimed four fixes and shipped two

Ola asked for critics: "använd critics för att kontrollera att fucking
funktionerna blir bättre och inte bara annorlunda." One ran over v0.22.0
and found that half of it was not fixed, and that three of my own probes
were certifying the unfixed half as working. Every finding was verified in
the code before acting on it.

**Akimbo was not fixed at all.** The new code computed `perHand =
'pistol'`, used it for the label, and then passed `kind` to
`makeWeaponMesh` on the next line. Every hand still got the two-pistol
mesh. Four guns, exactly as before. And the probe read the label rather
than the geometry, so it reported "exactly two guns in total, not four"
while standing next to the line that was wrong.

**The holster was on the wrong hip.** `Math.atan2(-e[8], -e[10])` is the
heading plus 180 degrees. The loop sat on the LEFT hip, four centimetres
behind, out of reach of the gun hand, and permanently inside the resting
position of the off hand, which would have turned the left grip into a
random stow-your-pistol button and broken the mine and the wall repair.
The probe measured distance from the head, which is the same number for
either hip.

**The wrist derivation was right in the wrong space.** The weapon's axes
are the HOLDER's, and `_alignWeapons` exists precisely because the holder
and the grip differ, by about 47 degrees on Touch controllers. The
placement was derived from the weapon and then applied in grip space,
carrying all 47 degrees into the answer. There is an `armFrame` per grip
now, carrying the weapon's alignment and nothing else, and the display is
mounted on that. So it uses the weapon's frame rather than a description
of it.

**And the calibration ring could not express the answer.** It oriented
itself with `lookAt(position * 4)`, and the position includes the offset
ALONG the arm, so the target was mostly down the arm rather than out from
it. The ring collapsed: at position 7, meant to be the underside, the face
still pointed along the arm. It rolls about the forearm axis now. 1A is
exactly the derived home, 4A faces right, 7A faces down, 10A faces left.

Also fixed, all found by the same pass:

- The calibration was thrown away on every page load: `attachTo` stamped
  the default over the loaded value, and on the first call the early
  return could not fire because the group had no parent yet.
- The calibration card covered the five debug menu rows that drive it,
  including Close. It sits below the menu now, and the coordinate is a
  status row on the menu itself, because every confirmation in that flow
  went through a DOM toast and DOM does not exist in a headset.
- Switching weapons on a dark level disconnected the torch, because the
  dressing pass clears the holder the beam is parented to.
- The strategy map could unfold on top of the debug menu and then eat its
  buttons, most likely of all during calibration.
- "map not available" could never appear, because `painted` was set
  because a draw call happened rather than because anything landed.
- A comment counted a way out of the panel that does not exist.

**The three probes are rewritten to measure the thing.** Barrels are
counted as geometry in space, the holster is reported as a signed offset
in the head's own frame, and the display is compared against the real
weapon holder with the controllers posed by `debugVRAim(45)` first,
because headless controllers sit at identity and the divergence the check
exists to catch is not there otherwise. All three were falsified by
re-breaking the fix and watching them go red. Written up in LESSONS.md and
QUALITY.md, which now has a fourth rule: the test must run where the bug
can happen.

## v0.22.0 - 2026-08-24 - four VR bugs, and the wrist derived instead of guessed

Ola's v0.21 headset session, and he was right about all of it.

**The wrist display was two sign errors, not an ergonomics problem.** He
had already said it twice: "det sitter på handens undersida, upp och ner."
Then he said the thing that solved it: "om du kan lista ut var fan
pistolen pekar och vad som är upp och ner på den lär du ju fan kunna lista
ut var displayen ska sitta."

He is right. The weapon's frame is known good, because he can see the gun
and aim it: in grip space the barrel points along -Z and the top of the
gun is +Y. From that there is nothing left to guess. The forearm runs
backward from the hand, so +Z. The back of the wrist faces the same way as
the top of the gun, so +Y. The display sits at +Z toward the elbow, at +Y
on top of the arm, facing +Y.

The old values were `y: -0.032` and `rotation.x: +PI/2`. Negative y is
under the arm. Plus PI/2 turns a plane's normal to face down. That is
literally "under the hand, upside down", which is what he said both times,
and I spent two versions treating it as a matter of taste. The probe now
checks the display against the WEAPON's axes rather than against numbers I
typed, so it cannot be wrong again in a way a test would not notice.

**The calibration aid had inherited the bug it existed to fix.** It was
pinned to the same grip with the same orientation, so the tool for finding
the display sat exactly where the display was: out of sight. Ola: "sätt
fucking armbandet som du satt fucking ficklampan! Rakt jävla fram!" The
readout is now a card floating in front of your face, at the distance the
debug menu already uses, with the twelve positions in a ring and the five
angles drawn as actual tilted bars. There is a BACK TO DEFAULT entry too,
because a calibration with no way back is a trap.

**The drone map was black and you had to die to escape it.** Two separate
failures:

- Black, because inside a WebXR session `renderer.render(scene, camera)`
  ignores the camera you give it and draws the session's own view into the
  session's own framebuffer. So the map pass rendered the player's
  viewpoint into the wrong buffer and nothing landed on the panel. On a
  flat screen the identical code works, which is why it shipped: the only
  place it was broken was the only place the feature is for.
- Inescapable, because the only exits were looking away and a trigger
  click on a panel he could not see. A, B and X all close it now, so does
  clicking the stick, so does turning away, going down closes it, and
  changing level closes it. The panel says "A OR B TO CLOSE" on itself,
  and if no map has landed it says so in words instead of being a black
  rectangle. Nothing in this game may ever require dying to dismiss.
- It also no longer unfolds itself while you are shooting or within a
  second of a shot. The display is now correctly on top of the forearm,
  which is a place a shooting stance can bring into view.

**Buying two pistols gave you four.** The `akimbo` mesh is two pistols in
one object, because a flat viewmodel has to show both. Handing that mesh
to each hand is two hands holding two guns each. In VR akimbo is one
pistol per hand.

**The holster could not be reached.** It was pinned near the rig origin,
and in roomscale the player walks away from the rig origin: the camera
moves, the play space does not. So the loop sat wherever the level had
started, often several metres behind him. It follows the body now, at hip
height derived from eye height rather than assumed, with a more forgiving
grab radius, and it lights up when a hand is close enough to use it. The
squeeze also checks the holster FIRST and for either hand, because
reaching to your own hip can only sensibly mean one thing, and the old
branch order sent it to reload whenever the runtime had not told us which
hand was which.

## v0.21.1 - 2026-08-24 - the plan catches up with the code

Bookkeeping, and it was overdue. Six items in docs/projectplan.md had been
built and shipped versions ago while still showing as open: L2 to the
sketch, the drone grounded underground, the Butcher boss, the roof
extraction finale, and both "stop and playtest" gates, which Ola has in
fact been through twice. Each is ticked with the version that did it and
what verifies it.

docs/TODO.md is down to one open item, and it is one only Ola can close:
reading the wrist display's position off the calibration bracelet in the
headset.

## v0.21.0 - 2026-08-24 - twelve tests that could not fail

Ola's rule: "probes must assert what a PLAYER would notice, not what a
variable does." Walking the whole suite to apply it turned up something
worse than badly-phrased assertions.

**Twelve of the twenty-one probes could not fail at all.** They printed
numbers, sometimes with the word FAIL inside the string, and exited 0
whatever the numbers said. A red run and a green run were
indistinguishable to anything reading an exit code, which includes a
person scrolling past a wall of output. They are all converted, listed
one by one in QUALITY.md with what each was and what it now proves.
`node test/all.mjs` runs the lot.

**It found four real bugs.** Two are in earlier versions this week; these
two are new:

**`debugMove` had been dead since v0.17.0.** It wrote straight into the
rig's position, and the character controller has copied its own position
over the rig every frame since it took ownership of the body. Every write
was silently undone. `groundprobe` walked at a ramp for 22 steps without
moving a centimetre and reported "could not reach the top", which reads
like a ramp bug rather than a dead hook. Worse, the pressure probe's
kiting bot, the whole point of that probe, has not moved for four
versions. This is the same family as the reload gesture that was
changelogged as shipped and never wired up.

**The enemy mix went negative from night 7.** Walker is the remainder
after the other five types take their capped share, and from night 7 those
caps add up to more than 1. Walkers vanished entirely and the spawn budget
was over-allocated by the overflow. Clamped and normalised, so the walker
thins out to nothing instead of going into debt.

**Three assertions I had to correct after writing them**, which is the
lesson worth keeping:

- "No zombie stands still" failed the game for zombies that were standing
  still because they were BITING THE PLAYER. The real bug it was reaching
  for is stranding: not moving AND far away.
- "The bot takes damage on a hard night" was measuring the instrument.
  That bot has perfect aim, perfect kiting and infinite ammo; it walking
  away untouched says nothing about the game. It now asks whether the
  horde can catch a player running away, with the trigger held.
- "Night 9 spawns more than walkers" failed at random, because `swarm` is
  all walkers on purpose.

An assertion about the wrong thing is not better than no assertion. It is
worse, because it goes red for reasons that are not bugs and trains you to
ignore it.

## v0.20.0 - 2026-08-24 - edit a number, see it happen

**Hot reload of level data: `?hot=1`.** Ola asked for it and the reason is
arithmetic. The loop before this was: edit the file, reload the page,
click solo, wait for the level, walk back to the thing you were looking
at. Half a minute per number. On a layout that is thirty numbers, most of
an afternoon goes into walking.

Now the data files are watched and the current floor rebuilds when one
changes. Same phase, same wave, same scrap, same inventory, and you keep
standing where you were standing if that spot still has floor under it. If
the edit moved a wall through you, you go back to the spawn plate, because
being left inside a new wall is the one outcome that would make this
useless.

It works without a build step because ES modules cache by URL, so a fresh
query string is a fresh module. The file is polled rather than watched: a
browser cannot watch a disk, and a dev server that could is a build step
by another name.

**`?levelpreview=N&hot=1`** is the pairing this was built for: a labelled
diagram of the level that redraws itself while the data file is edited.

**A half-typed file is the normal state of a file being edited**, so it
must never be fatal. A broken file is reported by name and reason, the
last good level keeps standing, and fixing it recovers. The spec validator
runs on every reload exactly as it does on load, so a typo in a prop name
names the entry index and leaves the level you were playing alone. That
behaviour is checked on purpose, not assumed: `test/hotprobe.mjs` edits a
real data file on disk while the game is running, breaks it, and fixes it.

**A trap worth writing down.** `fetch` resolves a relative path against
the DOCUMENT and `import()` resolves it against the calling MODULE, so one
relative string cannot serve both. The first version polled the right file
and imported a path two directories deep that does not exist. The paths
are absolute, built from `import.meta.url`, which is also what keeps them
working when Pages serves the game from a subdirectory.

**docs/sketching.md**, the cheap-versus-expensive guide. The whole prop
library in a table with the numbers each one takes, the four cost tiers
with a tell for each ("if describing it needs the word WHEN, it is a
mechanism"), and what to put in a sketch in the first place: the shape
rather than coordinates, what the player should feel at three moments,
where the enemies come from and what hides them, and a circle around
anything that moves.

## v0.19.2 - 2026-08-24 - a phone can repair the wall, and three things that happened silently

**Mobile could not repair or open doors at all.** `TouchInput` bound seven
buttons and neither of the two HOLD interactions was among them, while the
prompt cheerfully told a phone player to "HOLD E". There is a HOLD button
now, at the end of the action row, which appears only when there is
something to hold and says which of the two it is, and the prompt names
the control you actually have: E, the grip, or the button. This is the
flat-mode version of the VR parity rule and it had the same shape: built
for the first platform, never ported to the second.

`interactprobe` checks it on a real touch device profile, dispatching a
touch on the real button, because the whole claim is that the button is
reachable.

**Three things the game did without telling you:**

- A mine is inert for its first second and nothing said so, so "why did
  that not go off" had no answer. Arming now has its own event and its own
  two-chirp cue. Placement and arming used to be the same beep.
- The drone closing its claw on a field crate. It was the one moment of
  the fetch errand worth watching, and from inside the base the drone flew
  out, hovered, and came back, and you learned whether it had worked when
  it landed. It now clacks, whines, and says so.
- Magazine seated on a flat screen. There was a sound and a small
  viewmodel kick, both easy to miss with a horde in front of you. The ammo
  readout itself pulses now, because that is where you look to find out
  whether you can shoot.

## v0.19.1 - 2026-08-24 - two animations that were not saying anything

**The reload was a gun tipping over, not a reload.** Ola: "the reload
animation in VR is a slow quarter turn left and back, and it is unclear
what it represents." It was one sine sweep rolling the whole weapon and
back. What makes a reload legible is the MAGAZINE, so the weapons grew a
tagged magazine part and the animation is three beats: the gun snaps over
and the magazine drops out, a beat where the well is visibly empty (this
is the beat that says "you cannot shoot right now"), then a fresh
magazine rises and seats and the gun snaps upright. Sharp motion at the
ends, held in the middle. Easing everything smoothly is what made it read
as one slow turn.

**Zombies ate the base without moving.** Ola: "zombies attacking the base
just stand and stare while it breaks. They need an attack animation
readable from across the field." The wall attack pushed no event and set
no state, so nothing on any screen had ever moved: the only clue that the
base was under attack was the integrity bar going down. Attacking is now
a STATE that rides the snapshot rather than an event, because an event
gives you one twitch every 0.9 seconds and that is not what hammering on
a wall looks like. The pose is whole-body, arms over the head and down
with the torso rocking, because at thirty metres a hand movement is
invisible. Each one runs on its own clock so a crowd does not swing in
lockstep.

**The host was a column behind its own clients.** Found by the new check.
The zombie row was written out as a literal in two places, the snapshot
and the host's own render path, so adding a column to one left the other
short. Nothing errored: the missing field destructures to `undefined`,
which is falsy, which is exactly "not attacking". There is one exported
row builder now. LESSONS.md, including which other row shapes are waiting
to do the same thing.

**holdoutprobe can fail now.** It printed FAIL strings and exited 0, so a
red run looked exactly like a green one to anything reading the exit code.

## v0.19.0 - 2026-08-24 - the strategy view, and a holster to free your hand

**The drone existed and could not be used in a headset.** It is the
holdout level's answer to "loot landed where I cannot walk", and sending
it needs a point on a map. A flat player clicks. A VR player had nothing
at all. Ola: "the wrist is the TRIGGER, not the whole surface. Looking at
the wrist unfolds a larger holographic panel floating at a comfortable
distance, big enough to read the map and place a drone target precisely."

That is what this is:

- **Glance, dwell, unfold.** Raise the forearm so the display faces you
  and look at it for half a second. Look away from the panel for a moment
  and it folds. A dwell rather than a button, because it is the gesture
  you would make anyway to read a watch, and both conditions must hold
  (looking at it AND it facing you) so a wrist drifting through your
  sightline cannot open the map mid-fight.
- **The map is the real map.** The panel is textured by a render of the
  same orthographic camera the flat map uses, markers and all. Not a
  second drawing that can drift out of agreement with the first. Throttled
  to about 10 Hz, because a map is a readout, not an action view, and a
  full extra scene pass every frame is exactly what a Quest 2 cannot
  absorb.
- **World-locked, not head-locked.** Once unfolded it stays where it was
  placed. You cannot point precisely at something that runs away from
  your hand.
- **Both ways to point, with no mode switch.** Pistol in hand: you point
  along the barrel, the same target ray the gun shoots along, so the panel
  is aimed at exactly like a target. Pistol stowed: the free hand points.
  What you are holding decides.
- **A holster you reach for.** A visible loop on the right hip. Move your
  hand to it and squeeze to stow or draw; squeeze anywhere else and you
  still reload. The weapon mesh physically moves between hand and hip, so
  what you see is what is true, and a stowed weapon cannot fire.

**A bug this found before Ola could.** Turning a point on the panel back
into a place on the ground had the vertical axis mirrored, so every drone
would have flown to the wrong side of the level with nothing on screen to
say so. The map camera looks down with up = -Z, which means screen-down
is world +Z and the image is not mirrored at all. The probe now checks
the mapping against the camera's own projection matrix at OFF-CENTRE
points: checking the centre proved nothing, because a symmetric frustum
maps the centre to the centre no matter which signs are wrong.

Also found while wiring the test: controller groups run with
matrixAutoUpdate off, because WebXR writes their matrix directly, so
moving a hand by setting its position does nothing until the matrix is
recomposed by hand.

## v0.18.3 - 2026-08-24 - the torch gets a switch, the headlamp goes away

**The flashlight had no switch in VR.** Ola: "the flashlight in the hand
does not toggle on the trigger. It should." The only switch was the F
key, which does not exist in a headset, so the lamp could only ever be
turned on by the level being dark. The empty hand's trigger is the
torch's switch now, which was the missing half of a fix already in the
file: the hand that is not holding a gun does not shoot, and it took
until now to say what it does instead.

The toggle is also authoritative. It used to read "lit if you switched it
on OR the level is dark", which meant that underground the lamp was
permanently on and the switch did nothing, on exactly the levels where
you would want to turn it off. Darkness now sets the DEFAULT on arrival
and the switch owns it from there.

**No more headlamp.** Ola: "there is also a headlamp that should not
exist yet. Remove it." In a headset that light was mounted on your face,
which is both wrong and a spoiler for gear that has not been earned.
Nothing shines from the camera in VR. The flat screen keeps its
eye-mounted cone, because a flat player has no hand to carry a torch
from. A real headlamp is parked in docs/TODO.md as a scrap unlock beside
the laser and the holo sight.

**Two probes were testing floor 1 while claiming to test floor 2.** Both
opened the game with `?level=2`. There is no `level` URL parameter, and an
unknown query parameter is silently ignored, so every "underground"
assertion was made in daylight. Fixed, and both probes now assert they
arrived before asserting anything about where they are. Written up in
LESSONS.md, because this is the same family as the reload gesture that
was never wired up and the HUD check that ran on a screen the box was
not on: the test ran, the test was green, the test never looked.

## v0.18.2 - 2026-08-24 - explosives that talk to each other

**The two MINE buttons were worse than duplicates.** Ola: "MINE and
DRONE:MINE read as duplicates. If there is no real difference, remove the
plain MINE." There was no difference, and the plain one was the bad deal:
it teleported a mine onto the map for 12 scrap, while the drone carried
the same mine to the same place for 10 and was more fun doing it. The
plain button is gone. Remote mine delivery is the drone's job, which is
also part of what makes the drone worth owning.

**A mine could only ever be set off by a zombie standing on it.** Shooting
one did nothing. A barrel going off beside it did nothing. It could not
hurt the person who laid it. That is furniture, not a hazard. Detonation
is one code path now and everything in range is affected:

- Armed mines are in the hit test, so you can set your trap off from
  cover. The target is a deliberate 0.3 m so it is a shot you meant to
  take, and unarmed mines are ignored so you cannot shoot one out of your
  own hand while placing it.
- Mines chain into mines, mines set off barrels, and barrel blasts take
  the minefield with them. Bounded to four levels of chaining so a mine
  laid against a barrel stack cannot recurse away.
- Your own blast hurts you inside 70% of its radius, which is the rule
  barrels already followed.

**Mines were unusable underground.** Hand placement required the day or
countdown phase, and a traverse level has neither, so on L2 the mines in
your inventory did nothing and nothing said why. The phase gate is gone:
the one-second arming delay is what keeps a mine a trap rather than a
grenade. Noted in OPEN-QUESTIONS.md as a deliberate balance change.

**The probe assertion overhaul starts here** (QUALITY.md). The old
barrelprobe printed numbers and exited 0 no matter what they said, so it
could not fail. It is now EXPLOSIVES: nine assertions, all on things a
player would see happen, and falsified by disabling the chain on purpose
to watch it go red. It also waits for the mine to appear on the ground
rather than reading the count on the next line, because placement is an
action that goes to the host and comes back, and a probe that ignores
that is measuring latency instead of gameplay.

## v0.18.1 - 2026-08-24 - stop guessing where the wrist is, stop stacking the HUD

**The wrist display, third attempt, but this time with a ruler.** Two
guesses at where a forearm display should sit have both been wrong, so
this version stops guessing and hands Ola the measuring tool he asked for.
A bracelet appears around the forearm: twelve numbered pips around the arm
and five lettered marks for the angle. The debug menu steps the display
through them, the display prints its own coordinate on itself, e.g.
POSITION 7C, and the choice is saved to localStorage. Ola reads two
characters out loud and the guessing is over.

**The top of the screen is a bar now, not a pile.** The objective banner
and the base integrity bar were both absolutely positioned at the top
centre, so on anything narrow they sat on top of each other and neither
could be read. Room, objective, base, scrap and night vision are one
three-cell grid now: they are laid out relative to each other, so they
cannot overlap at any window size.

smoke.mjs checks it at five window sizes, every visible HUD box against
every other, with the normally-hidden boxes forced visible first. That
last part matters: the first version of the check passed while looking at
a screen the base bar was not on, which is not a test of anything. With
the boxes actually visible it immediately found two more collisions on a
phone that nobody had reported: the base bar under SCRAP, and the repair
prompt under the carried-items box. Both fixed.

## v0.18.0 - 2026-08-23 - a way back, a debug menu, and a level preview

**Dying in VR left you dead.** Ola: "a box appears where you can press A
or B, neither gives me a new chance, it just changes level or not, but I
am still dead." The probe asserted this worked and was green, which is the
second time a test has measured the wrong thing here. Two causes, both
addressed:

- The test reached game over with a debug shortcut and pressed the button
  by calling its handler directly. It now dies the way a player dies, and
  presses A through the real gamepad loop. The fake XR session grew input
  sources, because with an empty list the entire per-controller loop was
  skipped and every face-button binding in the game was untested.
- Recovery no longer depends on an event arriving. Pressing A restarts the
  level AND puts the local player back on their feet directly. A restart
  that can fail silently is not a restart.

A downed solo player is also always offered a way back, not only a way
out. Nobody is coming to revive you when you are alone, so "wait for help"
was not a state, it was a trap.

**A debug menu, on every platform.** Ola asked for one so that everything
built can actually be reached: weapons, scrap, ammo and kit, revive, jump
to any floor, skip a wave, repair the base. Y in VR, F8 on desktop, and it
is world-space so there is exactly one implementation.

It also prints live state at the top: level, archetype, phase, health,
downed, enemies left, scrap. That is deliberate. When something goes wrong
inside a headset the only evidence available is what Ola can read out
loud, and "I am still dead" is much easier to act on when it arrives as
"phase day, downed yes".

**`?levelpreview=N`.** Ola: "the only way for me to see a new layout is to
play through it, which is the slowest possible loop. Five seconds instead
of five minutes changes how many sketches I can try." Any level from
above, without playing it: the base with its footprint, every spawn
coloured by ring and labelled with what it hides behind and how far out it
sits, the exit, the chasm, the doors, a scale bar and a legend. It is a
READ of the built level, not a second implementation: if the preview shows
it, the game has it.

## v0.17.1 - 2026-08-23 - archetype parity

Ola named the pattern: "something built for the first variant is only
partly ported to the second. Flat was built first and VR got a partial
port. Holdout was built first and traverse is now getting a partial port."

`docs/archetype-parity.md` is the same idea as the VR parity checklist, on
a different axis: 23 behaviours, a status per archetype, and the rule that
"it inherits that" is not an answer until you have checked what it
inherits.

Walking the list found four real failures, every one of them a traverse
silently inheriting or missing something written for a holdout:

- **A route level handed out no supplies at all.** Loot is given by
  `_enterDay`, and a route has no day. You started with whatever you
  walked in with and found nothing on the floor. Supplies are now spread
  along the route rather than dumped at the arrival plate, which is better
  anyway: at the plate they were inside the pickup radius the moment you
  landed and vanished into your pockets before you saw them.
- **Loot on a traverse became uncollectable.** A drop outside the
  "reachable" area becomes a FIELD CRATE that only a drone can fetch, and
  the drone cannot fly underground. But "reachable" was answered from
  `baseCentre` and `playableHalf`, which a traverse also sets, so a kill in
  a corner of the room dropped a crate nobody could ever collect and
  nothing said why. Only a level that CONFINES the squad has unreachable
  ground, and only a holdout does.
- The wave director running on a route, and enemies never being stepped at
  all, both fixed in the two previous versions and recorded here.

A duplicate `sim.setLevel` call fell out of testing the first fix: the
first call handed out the supplies and the second cleared them.

## v0.17.0 - 2026-08-23 - a real character controller, and a gym to keep it honest

Ola's diagnosis, and it was right: clipping through a ramp from the side,
falling through it in places, walking up its flank as if the world were
flat, ground sampled at the wrong position, getting stuck in the chasm,
becoming permanently short after a fall. Not separate bugs. One missing
system.

**Input reports intent; the controller owns position.** Every input layer
used to write straight into the player's position and collision was a
push-out applied afterwards, which fails exactly as listed, because by the
time anything is checked the player is already inside the wall. Keyboard,
touch and VR stick now all report a DESIRED VELOCITY and nothing else.

`src/game/controller.js` enforces, in order:
- **Swept, not discrete.** A frame's motion is split into steps no larger
  than half the body radius. A discrete check lets a fast player skip past
  a thin wall or land inside a ramp.
- **The feet decide.** Ground is sampled at the body's real position. In
  roomscale VR the body follows the CAMERA and corrections are applied
  back to the rig, so a player two metres from the play-space origin is
  not judged by what is under the origin.
- **Step up or be stopped**, per axis, so a glancing hit costs you one
  direction rather than all movement.
- **The slope limit is measured over a 0.7 m window**, not per sub-step.
  This was the subtle one: a ramp is built from slabs, so at every slab
  edge the rise-over-run is infinite, and the first version rejected every
  ramp and every staircase in the gym.
- **Nothing is ever stuck**, including recovery from under the floor.
- **Height is derived, never stored.** Ola stayed short after a fall
  because eye height was mutated once and left stale.

**THE PHYSICS GYM, at `?gym=1`.** Eight stations in one room: ramps at 15,
30 and 50 degrees, stairs at the step-up limit, a 6 cm wall, a pit with a
climbable end, a ledge, a narrow gap, a moving platform and a low ceiling.
Walk it yourself in VR or flat; `test/gymprobe.mjs` walks it headlessly on
every change, asserting observable outcomes only ("can you get up there",
"did it stop you", "did you land", "could you always continue").

It found seven real problems on its first run, including two of mine: a
pit with no bottom, because ground below the base floor was unreachable by
construction (there is a `level.lowered` concept now), and a moving
platform taller than the step-up limit, which was correctly refusing to be
boarded. **This is the movement regression suite permanently: a movement
bug is not fixed until the gym has a station that reproduces it.**

### Two gameplay errors alongside

**Nobody spawns in your lap.** Ola took damage every second at his arrival
point and died without ever seeing what hit him. Nothing is now born
within six metres of a living player, and the arrival point is cleared of
anything already standing there before players are placed.

**A traverse does not run the wave director.** It is a route from A to B
where you clear what stands in the way, not a siege you survive.

### L3, decided

**Removed, not re-themed.** Floor 3 was a high-rise office floor from the
concept `docs/level-design.md` replaced. An office with balconies has no
place in a campaign about crossing a landscape, and re-theming it would
cost more than the holdout variant that belongs there. Floor 3 is a
holdout until it gets its own sketch, which the design doc already calls
for: "you emerge somewhere new, a rooftop, a walled yard, inside a house".

A floor whose TYPE is an archetype but which has no sketch yet reuses the
first spec of that archetype, so the campaign stays playable without
inventing a layout nobody asked for.

## v0.16.1 - 2026-08-23 - the L2 playtest, and the same mistake three times

Ola's L2 playtest, plus the restart bug. Three of the four level bugs were
the same organisational failure he named himself: something built for the
first variant only partly ported to the second.

**"Zombies do not attack at all on L2."** Verified before fixing, as he
asked, and the hypothesis was wrong in an instructive way. They were not
failing to attack; they were never being STEPPED. `_stepZombies` ran only
in the `night` and `elevator` phases, and the route phase was never added
to that list. Daylight raiders on L1 had been frozen for the same reason
the whole time. The list of phases where the horde moves is now an
allow-list of phases in which the world is RUNNING, because a list of
combat phases is a list that gets forgotten.

**The chasm read as a flat plate, and the horde stood on it.** Two
separate faults. Visually it had no depth: it now has banded shaft walls
nine metres down, girders across the top to measure the drop against, and
a floor at the bottom of them rather than one floating in space with a gap
between. Mechanically the hole was never in the navigation grid at all:
`extraBlocked` is called with the GRID and expects it to mark cells, while
the void blocker returned an (x, z) predicate whose answer was thrown
away. Same family as the dead reload gesture: a contract mismatch that
fails silently.

**Zombies spawned on the open floor instead of from the holes.** A hole
was a dark rectangle painted on a solid wall, so there was nowhere to come
from. The outer walls are built as segments now with real gaps where the
holes are, and each hole has a recess behind it that they walk out of.

**Pickups could not be collected.** It was the rig-origin class of bug, as
Ola guessed: the radius was measured from the play-space origin, so in
roomscale VR a med kit at your feet was two metres away. It measures from
the head now, with a bigger radius, a proximity prompt naming what it is,
and a world-space confirmation card in VR where the toast does not exist.

**TRY AGAIN left you downed.** The simulation reset `down` and told
nobody, so the client's own flag stayed latched: you respawned on the
floor, unable to move or shoot, with the run over and the game silent
about it. There is now ONE authoritative reset path that every restart and
level transition calls, it announces itself, and the client DERIVES the
downed state from the simulation rather than latching it from events. Ad
hoc resets are how a field gets forgotten.

**And the probe that was green while that was broken.** It asserted
`phase !== 'gameover'`, which is a variable, not a player. It now checks
that after pressing TRY AGAIN you are not downed, have full health, can
move and can shoot. Fixing it immediately exposed a second layer of the
same mistake: the probe had been faking the downed flag on the CLIENT,
which the new derivation correctly ignores. It downs the actual player in
the simulation now.

**Also unified: one way to put a body on the ground.** There were three
copies and only one handled a void, and none of them ran before the early
exits, so a zombie with no path hovered over the hole forever.

## v0.16.0 - 2026-08-23 - LEVEL 2: THE UNDERWORKS

The traverse archetype, built to Ola's sketch L2. Floor 2 of the campaign
is no longer the old hand-written basement.

**A route, not a siege.** You arrive on a plate in the north-west corner
and must reach the lift in the south-east. Underground and dark, which is
where the flashlight and the claustrophobia live, and which is the
contrast the whole campaign rhythm is built on.

- **The antechamber and the door.** The corner you land in has one way
  out: a sliding door you open by walking to its button and HOLDING. That
  is the "moment of standing still and defending" the design doc asks
  for, and it is the same hold-to-act interaction as repairing a wall,
  with the same prompt and the same filling ring.
- **The chasm.** A real void, not a dark texture: the character
  controller asks the level for ground and gets none. You fall six metres,
  it costs you 45 health, and you are placed back on solid floor rather
  than left falling. The pathfinder knows about it too, so the horde never
  walks in. Measured, not assumed.
- **The fence** seals the direct east route past the chasm, so the east
  side has to be reached the long way round.
- **Three visible holes**, two in the east wall and one in the south. Every
  entrance is something you can see.
- **A weapon locker** in the same room as the exit lift.

**Waves come because you ADVANCE, not because a clock ticks.** A route
level has no day, no night and no countdown: it runs its own phase, and
crossing each quarter of the room summons a push. Stand still and the
pressure stays where you left it. The game says so out loud ("They heard
you move.") so the lesson lands.

**The drone is grounded underground**, and the UI says why rather than
silently doing nothing: "No signal down here. The drone stays topside."

**Deviation from the sketch, stated:** the sketch says 10x10 m. At 10 m a
5x4 chasm leaves a walkable ring under two metres wide, which is not
enough for four players and a horde in one corridor. It ships at 13x13
with the proportions kept, and `route.size` is the dial.

### The validator earned its keep three times

Every one of these was caught at build time, before the level was ever
played:

1. The door was in the east-west wall, as a first reading of the sketch
   suggested. That sealed the antechamber on all four sides: the level
   could not be started, let alone finished. The sketch draws the door on
   the north-south wall, and it has to be there.
2. The antechamber was too small. Once every wall, crate and post is
   inflated by the agent radius, the free space collapsed to two cells.
   The failure now prints an ASCII map of what is reachable, which is
   worth more than any amount of reasoning about wall coordinates.
3. The door's own button post sat in front of the opening and narrowed it
   until nothing could path through. The button is offset along the wall
   now.

New checks that came out of it: doors are flooded OPEN when testing
routes, because a route level deliberately starts sealed; the chasm is
flooded as solid; and a route level must have a walkable path from the
arrival plate to the exit, which is the one failure that means the level
literally cannot be finished.

New `test/traverseprobe.mjs` covers all of it: the phase, the door, the
pockets, the fall and its cost, the horde staying out of the hole,
advancing summoning a push, and the exit plate completing the level.

50 draw calls / 4.7k triangles.

## v0.15.1 - 2026-08-23 - your teammates are people

Ola: "players currently render as a gas bottle with no arms or legs. In
co-op VR, seeing your teammates as people is most of the social presence,
so this matters more here than on flat."

An avatar was a capsule, a box head and two floating hand blocks. It is a
body now: torso with a collar and a strap so it has a front you can read at
a glance, head, two-bone arms, two-bone legs, and a name tag that stays
upright and faces you.

- **In VR** the head and both hands come straight from the headset and
  controllers, and the **arms are inferred from them by two-bone IK**. That
  is what makes a tracked player read as a person rather than as three
  objects floating in formation. The torso stretches to the real head
  height, so a crouching teammate reads as crouching, and an untracked
  hand rests the arm at the side instead of leaving it pointing wherever
  it last was.
- **Flat players** get a stride: arms swing and legs walk at a rate driven
  by how fast they are actually moving. Nobody tracks their feet, and a
  plausible walk beats a wrong one.
- **A name tag** in the player's own colour. The first question in co-op is
  always "who is that", and a colour alone stops answering it once there
  are four players and a horde.

One bug found by looking rather than reasoning: every limb pointed at the
sky. A segment is modelled along -Z, so rotating it +90 degrees about X
aims it up, not down. Both arms and both legs were scarecrowed.

## v0.15.0 - 2026-08-23 - objectives you can act on

Ola: "'OBJECTIVE: REPAIR WALL' tells the player nothing about how. Every
objective needs an in-world target: highlight the damaged section, show a
prompt when the player is near it, and a hold-to-act with a visible
progress ring. If an objective cannot currently be performed in VR, that
is a bug, not a missing nicety."

**Repairing and reviving are now the same interaction**, because they are
the same interaction: go to a marked thing, hold, watch it fill.

- The damaged wall section is **highlighted** with a pulsing ring on the
  floor, so "which bit?" has an answer you can see from across the base.
- A **world-space prompt** appears when you are close enough, and names
  the control you are actually holding: "HOLD E TO REPAIR" on a monitor,
  "HOLD GRIP TO REPAIR" in a headset.
- A **progress ring** fills like a clock face while you hold. Let go early
  and it drains: a hold you can tap through is a tap.
- A downed teammate gets a **marker that draws through geometry**, because
  not being able to see them is the entire problem it solves. Standing by
  them shows the revive ring, and **both players see the same progress**,
  which meant shipping revive progress in the snapshot.

All of it is world-space rather than DOM, so it works identically flat and
in VR. A DOM prompt would have been half a feature again, which is the
mistake the VR parity rule exists to stop.

New `test/interactprobe.mjs` walks the whole chain: no prompt when there
is nothing to do, no prompt from across the base, prompt on approach, ring
only while held, wall actually repaired at the end, nothing repaired if
you let go early, and the same prompt naming the grip inside VR.

## v0.14.3 - 2026-08-23 - the wrist earns its glance, and shots read in VR

**The wrist display moved and woke up.** It sat on TOP of the forearm like
a panel bolted to the arm, which is a place nobody looks and which crowded
the flashlight the same hand carries. It is on the inner forearm now at a
watch angle, so the gesture that reads it is the one you already know:
turn the wrist inward.

It also announces instead of waiting to be noticed. When the objective
changes it swells twice, edges itself in the urgency colour, holds the new
line at a larger size for a moment, and plays a soft two-note ping. The
objective itself is colour-coded: green while things are fine, amber when
something needs doing, red when something is going wrong. "THE WALL IS
FAILING" replaces "HOLD THE LINE" below 35% integrity, and "REPAIR THE
WALL" only appears when there is damage to repair. A display that never
changes teaches you not to look at it.

**Shots read in VR.** The pistol had no visible recoil at all, so firing
felt dead. Three things now happen at once, none of which touch the
player's aim: the weapon rotates back about the grip, the slide cycles
(back fast over the first third, forward over the rest, 0.09 s all in),
and the muzzle flashes with a flare quad as well as a light, because a
light alone is invisible against a bright daylight field. Every weapon has
a tagged cycling part, not just the pistol.

**A guard on the record itself.** The smoke test now fails if the version
the player can see has no matching entry in CHANGELOG.md. v0.14.0 and
v0.14.1 shipped without one, against CLAUDE.md's own rule, and they were
the same two commits that produced the newest dead code in the repo. A
rule that only holds when you are not busy is not a rule. Verified by
temporarily bumping to an undocumented version and watching it go red.

## v0.14.2 - 2026-08-23 - the dead code audit

Ola, after the VR reload gesture turned out to be dead code: "your rule
protects future edits, not the ones already made. Do a one-time audit for
siblings of that bug before moving on."

**43 things existed and never ran.** 17 functions, branches and variables
no path reached; 9 sim events built, shipped to every peer on every
snapshot, and then discarded because the client switch had no case and no
`default`; 17 config and tuning constants nothing read. 14 of them were
dead in the same commit that created them, exactly like the reload
gesture. One commit gave birth to five.

### Things the player was losing

- **The drone order that never arrived.** The affordability guard checked
  `droneDeploy`, which is 0 by design, so it could never fire. The client
  played the launch sound and announced "Drone away"; the host refused the
  order and pushed a `nofunds` event that nothing listened to. With low
  scrap you were told a drone launched and none existed. On a holdout
  level the drone is the only way to touch the field.
- **Placing a mine was silent.** A `minebeep` recipe has existed since
  v0.6.1 and was never played. It matters most in VR, where mines are
  placed by a grip squeeze and the toast standing in for feedback is an
  invisible DOM overlay.
- **The drone payload landed in silence.** `dronedrop` was written in the
  same commit as `dronefly` and only one was wired. You heard it leave and
  then nothing arrived twenty metres out.
- **A FETCH drone flew out carrying a mine crate**, because `fetch` had no
  slot in the wire's payload table and `indexOf` returned -1.
- **The flashlight reloaded with you.** A sentinel renamed from `glove` to
  `light` at three of four read sites, so the torch canted over and grew a
  charge lamp on every reload, in a headset, on the hand you hold up to
  see by.

### The one change that would have caught most of it

Every silent path now has a mouth. `handleEvents` has a `default:` that
warns on any unhandled sim event, and `audio.play` warns when a recipe is
missing. Those two lines would have caught 11 of the 43 the first time
anyone played, including all of the above.

### Deleted, because it existed and did nothing

`poseZombie` (superseded by the instanced renderer in v0.7.0 and left
behind), `makeZombieMesh` and a `groundHeight` import that fed it,
`makeGloveMesh`, `HostSim.shoot` (a back-compat alias whose callers were
deleted by the commit that added it), `HostSim.nearestDamagedSeg` (a
duplicate of the live `nearestRepairTarget`), `NavGrid.isWalkableAt`,
`WristDisplay.detach`, `meta.get`, `codeAlphabetCheck`, `magSeatFlashT`,
a `userData.lens` cache written twice and read never, and seven orphan
event pushes.

`msg.shoot` and `msg.snap` were the most dangerous: stale constructors
that no longer matched the wire. `msg.snap` emitted `z` where the sim
sends `zs`, so anyone trusting the protocol file would have produced a
snapshot whose zombies landed under the wrong key and vanished silently.
The protocol file is now an accurate description of what actually travels.

### Knobs that were not knobs

Twelve Phase 0 constants in `src/config.js` that nothing read, two of
which had drifted into *disagreeing* with the values that run: they said
the pistol held 12 rounds and reloaded in 1.0 s while the live pistol
holds 8 and reloads in 1.7. Balance lives in one place now.

Four more in tuning: `spawnDistanceFromPlayer` (superseded by the
level-authored spawn rings, and not even matching them),
`fragGrenade.friendlyFire` (the rule is welded into the blast code, which
damages only the thrower), `molotov.fuseTime` (structurally unreachable,
and honouring its 0.0 would ignite the bottle at your feet, so the live
constant is now named `airburstFuse` for what it actually is), and
`traps.lure.pull` (there is no gradient for a strength factor to act on).

### Wired up instead of deleted

- **`PROTO_VERSION` now gates the handshake, on both sides.** It had never
  been read, sent or compared: there was no compatibility check of any
  kind. Builds are served from GitHub Pages and headsets cache hard, so a
  Quest running last week's build will try to join a current host, and
  since geometry is rebuilt locally from a seed rather than sent, the join
  used to succeed and the two players then saw different worlds. It is
  refused now, with a message telling you to reload.
- **A level's data file names its own level.** The arrival card read
  `TUNING.floorHooks` and ignored the spec, while the code comment claimed
  the spec was the single source. It was true only because floor 1's hook
  happened to be byte-identical to L1's. The next sketch dropped in would
  have announced the wrong name with no error.

### One more thing the audit's own fix then caught

Tightening the spawn clearance rule to know how big each prop actually is
immediately failed L1 on every seed. Several spawns were sitting inside
the props they were meant to hide behind: a nine metre group of burnt-out
cars and a fourteen metre ruined house do not clear at "a few metres past
the middle". Two of those props also jitter with the level seed, so the
failure appeared on some seeds and not others, which is the worst kind.
Corrected, and verified on seven seeds.

### Also, the record

v0.14.0 and v0.14.1 shipped with no changelog entry at all, against
CLAUDE.md's own rule. They are the two commits that produced the newest
dead function in the repo. Entries added below.

## v0.14.1 - 2026-08-23 - being downed in VR is no longer a softlock

See the commit for detail: a world-space panel for every stopped state
(downed, game over, victory) with its actions on face buttons, because
every one of those states was a DOM overlay and DOM does not exist inside
a headset. Manual VR reload restored (it had never once run). The
flashlight no longer fires bullets. New `test/vrprobe.mjs` asserts the VR
parity list headlessly.

## v0.14.0 - 2026-08-23 - levels are DATA

`src/world/levelkit.js` (prop library and build spine),
`src/world/holdout.js` (the base frame only) and `src/world/levels/L1.js`
(the level, entirely as data). Spawns are derived from the blocker they
hide behind plus a ring distance. Validation runs at build time and fails
loudly: unknown props, a spawn inside its own blocker, a spawn in the
wrong ring band, a spawn with no route to the squad (by exact flood fill,
because a budgeted A* can report a long route as a wall), and anything
standing in the lift's boarding zone. Documented in docs/level-format.md
with L1 as the worked example.

## v0.13.0 - 2026-08-23 - VR can see, and the round can always be won

From Ola's VR playtest.

### VR was flying blind

"There is no HUD, no text and no readable state in VR at all. I do not
know if the gun is loaded, how many zombies remain, or what to do next."

**A wrist display on the left forearm.** Angled so a natural
watch-checking turn brings it square to your eyes. It carries the
objective in plain words ("GO TO THE LIFT", "REPAIR THE WALL", "HOLD THE
LINE"), zombies remaining, health, base integrity, scrap, weapon, ammo
and kit. The rule from here on: nothing important may exist only as flat
HUD text.

**An ammo counter on the weapon itself.** Ammo is the one number you need
mid-fight and you should never look away from a zombie to read it. Big,
high contrast, red at zero, and it shows a reload symbol while reloading.

Both are canvas textures redrawn only when their content changes, because
a per-frame canvas upload is a frame-rate problem on a Quest 2.

### Reload and ammo feedback

- **A hard mechanical CLICK on an empty trigger.** This is the primary
  "you are out" signal and it did not exist.
- **The reload is audible in three beats**: magazine release, empty mag
  hitting the floor, fresh one going in. In VR there is no viewmodel to
  watch, so the sound has to carry it.
- **A confirmation the moment the magazine seats**: a solid clack, a
  rising two-note tone, the weapon snapping up, and the VR charge light
  going green. Before this the reload just... ended.

### The off hand is a flashlight

It was holding a bare glove, which Ola read as "a mechanical lump that
can shoot". It is a torch now, aimed independently of the gun, with a
real beam. With dual pistols equipped it becomes an under-barrel light
instead. And it only lights on dark levels: waving a lit torch around in
bright daylight is absurd, so on a surface holdout the hand simply
carries the tool.

### Two bugs that made rounds unwinnable

**"The ramp is wonky and the player sometimes falls through it."** In
roomscale VR the player can stand two metres from the play-space origin,
and the ground was sampled under the ORIGIN. You stood on the ramp while
the game decided your feet were on the floor beside it. The character
controller now runs at the camera's ground position in VR. The ramp
geometry itself was verified solid from four approaches by the new
`test/rampprobe.mjs`.

**"A zombie spawned far away inside a house and could not be killed."**
Both fixes, as asked:
- Spawn points are snapped to open ground before the zombie exists. A
  spawn authored to sit BEHIND a house is easy to get a metre wrong and
  end up INSIDE it.
- A **stuck watchdog** as a general safety net, at the system level rather
  than per level. Moving is not the same as arriving: an enemy shut in a
  building can circle its rooms forever and never look stuck. What is
  measured is progress toward its target. Five seconds without any
  escalates through replan, unwedge, and finally relocation to a spawn
  point that demonstrably has a route. No round can be lost to one
  unreachable enemy.

### The approach is mixed, not one distance

Ola: "nearest spawn cover about 12-15 m so something is on you within
roughly ten seconds, mid ring about 25 m, far ring 40 m+ for the ones you
watch build up. Wave 1 starts from the near ring so the level opens
fast."

Three rings, and spawn positions are now DERIVED rather than typed: a
spawn is described by the thing it hides behind and how far out it sits,
and is placed on the base-to-blocker ray at that distance. It is
therefore always hidden and always in its band, which hand-placed
coordinates stop being the moment anything moves. Two close-in blockers
were added (a pipe mound and a second bus wreck) so the near ring has
somewhere to come from. Wave 1 draws entirely from the near ring; later
waves widen out.

### Loot you cannot reach is not loot

Most zombies die out in the field, which the squad is deliberately
confined out of, so drops were litter you could see and never touch. A
kill just outside the wall now drops inside it. A distant kill becomes a
FIELD CRATE with a beacon visible from the base, and fetching it is the
drone's second real job: FETCH is free, the flight time is the price, and
the crate hangs under the drone the whole way home.

### The base under attack is loud now

Three tiers chosen by how close that section is to going: a body blow
while it holds, wood splintering once it is nearly through, and a heavy
collapse when it breaks. Plus a rising alarm as the perimeter as a whole
fails, pulsing faster the closer it gets. You must feel the emergency
without looking.

## v0.12.1 - 2026-08-23 - fire rate is your trigger finger

Ola: "the fire rate should be more like a real weapon in that you CAN
shoot super quick but you will probably miss, as the recoil will offset
your aim."

**fireCooldown is now only the mechanical floor of the action**: how fast
the slide can cycle or the pump can be worked. Pistol 0.40 -> 0.10 s,
shotgun 0.90 -> 0.42 s, dual pistols 0.20 -> 0.09 s per hand. Everything
above that is your click speed.

**Recoil is the price, and it is LEARNABLE.** Each shot heats the weapon;
heat makes the next kick bigger and the shot wider, and it bleeds off
when you stop. The vertical climb is identical every burst and the
horizontal follows a fixed per-weapon pattern (the SMG climbs, pulls
right, then sweeps back left) with only a small jitter on top, so a good
player learns the shape and pulls against it. Random spread would just
feel unfair.

**Recovery is delayed and complete.** It does not start until the trigger
has been still for 0.16 s. Without that gate the sight snapped back
between shots and spamming cost nothing: the probe measured eight rapid
shots climbing LESS than five paced ones. And when it does recover it
recovers fully, because a permanent residue per shot compounds into
fourteen degrees of drift over a long fight that you never get back.

**VR keeps its own model.** The controller IS the aim, so shifting it
would fight the player's hand. In VR recoil is a visible kick on the
weapon model plus the same growing spread. Same skill curve, nothing
wrestling your arm.

Measured at 20 m by the new `test/recoilprobe.mjs`:
- pistol paced: 0 cm of climb. Pistol spammed at 10 shots/s: 321 cm, so
  you walk off a walker's head around the fifth shot.
- SMG paced: 0 cm. SMG spammed: 140 cm.
- three identical 12-shot bursts vary by 33% of one step, so the shape
  repeats and can be compensated.
- after a 20-round burst and 1.8 s of stillness the aim sits 0.0 cm from
  where it started.
- sustained damage, where magazine and reload are the real limit:
  pistol 3.2/s, shotgun 7.0/s, SMG 6.4/s, AK 7.7/s. The SMG is still
  worth twice the pistol, so it keeps its reason to exist.

**The pocket check is now a flood fill.** The bot-walker version could be
defeated by an L-shaped detour and reported false traps; pairwise
geometry over-reports on tiled walls. It now floods the playable area
with a player-sized agent from the middle and reports every unreachable
island bigger than a body. Slivers between two inflated obstacles are
ignored because nobody can stand in them.

Also: interior cover is flush against walls rather than parked 0.8 m off
them, which is exactly the width that traps a player.

## v0.12.0 - 2026-08-23 - VR hands, the lift plate, daylight waves

**VR: three weapons for two hands.** Every controller grip got a full copy
of the active weapon, and the flat-mode camera viewmodel stayed on inside
the headset. So a player with dual pistols saw one in each hand plus a
third hanging off the camera. Only akimbo arms both hands now; anything
else is the dominant hand, the free hand gets a glove so it is still
visibly a hand, and the camera viewmodel is hidden in VR.

**VR: reload by pointing the gun at the floor.** The flat-mode reload
animation is invisible in VR, so reloading had no readable trigger and no
feedback. Point the barrel straight down and hold ~0.35 s. A charge light
on the weapon fills while you hold, the gun cants over while the magazine
is worked, and it goes green when the fresh mag is in. The right grip
still reloads for anyone who prefers a button.

**Zombies no longer stand inside each other.** Separation was steering
only: a suggestion about where to walk, which loses to the pull toward
the player under crowd pressure, so bodies interpenetrated. There is now
a hard positional pass after movement that pushes overlapping pairs
apart, weighted by mass, so a brute wades through walkers instead of
being jostled by them. Worst overlap in a 20-body crowd funnelling into a
breach: 14% of contact distance, which is shoulders pressing rather than
bodies merging.

**The elevator is a plate, not a cab.** Four walls, a ceiling and sliding
doors that shut in your face, clipped through level geometry and boxed
you in inside VR. It is now what the level design actually asks for: a
metal plate you stand on with a control panel on a post beside it, open
on every side. Boarding is standing on the plate, so you keep shooting
while you board. Nothing to be shut out of and nothing to get stuck in.

**The base wall is low enough to shoot over from the ground.** Wall
1.15 -> 0.95 m, sandbags 0.95 -> 0.8 m. The snipe platform is now a
choice about sightlines, not the only place you can fight from.

**Waves happen in DAYLIGHT on the surface.** The whole art direction is
zombies in daylight, and a holdout's tension is watching them cross 40 m
of open ground. Surface levels no longer go dark for a wave; the sun just
drops lower and warmer as waves climb, capped at late afternoon. Darkness
is reserved for the underground traverse levels, which is the contrast
the campaign rhythm is built on. The HUD says WAVE, not NIGHT, on levels
that never get dark.

**New check:** `debugCrowding()` reports the worst body overlap in the
horde, wired into the holdout probe.

## v0.11.1 - 2026-08-23 - the two blockers from Ola's L1 playtest

**"Level 1 is unbeatable, a zombie spawns and cannot make it to the base."**
The navigation grid was still a 34 m box around the world ORIGIN. The
holdout base is at (-13,-11) and its spawn points reach 46 m out, so
several spawns sat entirely off the grid: those zombies never found a
route in, the night's counter stuck at "1 left", and the run could not be
finished. The holdout now declares its own nav bounds covering the whole
field, and the A* node budget scales with the grid instead of being a
fixed 4000 (which a 45 m walk-in blew through on its own).

**"Not possible to enter the elevator, there is a box in the way."** Two
causes, both fixed:
- The cab was rotated to "face the centre of the base" while its collider
  stayed axis-aligned. The visible cab stuck out past its own collision,
  poked through the south wall, and the boarding zone landed half inside
  solid geometry. The lift is now axis-aligned, flush against the west
  wall, doors facing straight east into the base.
- A crate sat squarely on the floor in front of the doors. Interior cover
  is now laid out around two lanes that must never be blocked: the ramp
  up to the platform, and the floor in front of the lift.

Also closed a pocket beside the snipe platform where a player could
squeeze into a 0.8 m slot between the ramp and the east wall.

**New checks, so none of this can come back quietly**
- `debugSpawnRoutes()` - every spawn point must land on open ground and
  have a path that actually reaches the base.
- `debugBoarding()` - nothing may stand in the lift's boarding zone, and
  you must be able to walk to it from the middle of the base.
- The holdout probe now plays night 1 to completion. If a single zombie
  is walled in anywhere, the test fails instead of the player discovering
  it twenty minutes in.

## v0.11.0 - 2026-08-23 - THE FIRST HOLDOUT LEVEL

Floor 1 is now the holdout level from Ola's L1 sketch. The old high-rise
"ground" floor still exists further up the cycle; this is the one to play.

**The field.** An 80 m open daylight field with haze that hides the far
ground. Sight blockers laid out to the sketch: a ridge to the north, a
lone dead tree east, burnt-out cars south-east, a rock field south-west,
two ruined houses. Between them, mid-ground the horde actually crosses:
crash barriers along the road, shipping containers, telegraph poles
marching into the haze, a burnt-out bus. A low ring of city silhouettes
sits inside the horizon haze band for depth.

**Nothing spawns in the open.** All seven spawn points sit behind a sight
blocker, 28 to 46 m out. The horde emerges from the haze and walks the
whole way in, which is the entire tension of the archetype.

**The base.** 8x8 m, off-centre to the north-west as sketched. A low wall
you see and shoot over, sandbags along the threat side, crates inside, a
ramp up to a snipe platform, and the elevator plate in the south-west
corner with its doors facing the middle of the base (foundation bug 5:
the lift derives from the base, it is never placed independently).

**Players cannot leave the base.** Verified from the centre in eight
directions: the wall holds every time.

**The base can be destroyed.** Every wall segment has hit points and its
own collider. Zombies that cannot reach a player attack the wall instead;
segments visibly sink and redden as they are chewed, and a broken one
becomes a real breach the pathfinder routes through. Losing the wall
loses the run. Repair costs 5 scrap a go during the day (E, or the left
grip in VR), which finally gives the prep phase a job. The whole
perimeter is one InstancedMesh, so breaking it costs zero draw calls.

**The drone is a real tool.** It is no longer a scout that hovers and
pings: it is a delivery vehicle. Launching is free, you pay for what it
carries, and you watch the payload fly out and drop.
- MINE (10) - the proximity mine, now placeable anywhere in the field
- TAR (8) - a slick that cuts them to 38% speed for 100 s
- SPIKES (12) - a caltrop field grinding 9 damage a second
- FLARE (14) - a burning lure the horde walks toward instead of you,
  which is how a squad that cannot leave the base decides WHERE the
  wave dies
The drone button on the tactical map cycles the payload and shows the
price. Mines dropped from the map fell 26 -> 12: a staple, not a luxury.

**Fixes found while building it**
- Local-to-world rotation used the wrong sign, so every rotated prop had
  its sub-parts scattered off the body (wheels beside the car, ribs
  poking out of containers as spikes).
- The pathfinder treated ANY collider with a top as walkable, so it
  routed the horde straight through low walls and sandbag stacks. Only
  ramped platforms are walkable now; anything above step-up blocks.
- Zombies attacking the wall no longer count as stuck, which used to
  teleport them away after four seconds and left the base untouchable.
- The player-only boundary ring overlapped the wall. The two pushed
  against each other and pinned the player in place, unable to move.
- The snipe ramp ran straight through the elevator cab. The firing
  position moved to the north-east corner, above the sandbags on the
  threat side, and the lift keeps the west side to itself.
- `audio.play(name, pos)` threw on array positions ("non-finite value").
- Tactical map framed a fixed box at the world origin, which put an 80 m
  field mostly off screen. It now frames the level it is looking at.

**New verification**
- `test/holdoutprobe.mjs` - spawn distance, base pockets, ramp clearance,
  confinement in eight directions, wall damage, breaching, and repair.
- `test/droneprobe.mjs` - every payload delivered, drones fly home, and
  the flare measurably pulls the horde off the base.
- `window.__zhr.debugPockets()` - stand everywhere in the base and try to
  walk back to the middle. Any start that cannot is a trap. This is what
  found both pinning bugs above; run it on every new level.

Performance on the new field: 50 draw calls, 4.5k triangles with 22
zombies, against budgets of ~100 and ~250k.

## v0.10.2 - 2026-08-23

**Foundation bug 3: VR weapon aim was 45 degrees off.** The pistol pointed up
and away from where the shots went.

- WebXR reports two poses per controller. The GRIP pose is the hand (origin at
  the palm), the TARGET RAY pose is where the user is pointing. On Oculus
  Touch these differ by a large, controller-specific angle. The gun models
  hung off the grip while shots fired along the target ray, and that gap WAS
  the bug.
- The angle is no longer guessed: the live rotation between the two poses is
  read each frame and cancelled out, so the gun sits in the hand and points
  exactly along the shot. Works on any controller, not just Touch.
- Shots, tracers and muzzle flash now leave the barrel tip instead of the
  wrist, with a per-weapon muzzle length.
- Held auto fire uses the same barrel ray, so a burst no longer drifts away
  from the first shot.
- Verified by `test/vraimprobe.mjs` with fake grip poses at +45, +60 and -30
  degrees: the gun was 47.5 / 61.5 / 34.2 degrees off the aim, now 0.00.

## v0.10.1 - 2026-08-23

**Foundation bug 2: ground and collision ignored height.** Ola: "no gravity,
absence of natural laws."

- NEW `src/game/locomotion.js`: a real character controller. `groundHeight()`
  samples terrain, ramps and the tops of solid boxes, constrained by how high
  the mover can currently reach. `moveAndCollide()` resolves horizontal
  movement axis by axis, then decides: rise within step-up climbs, a bigger
  rise is a wall, a small drop walks down, a big drop falls with gravity.
- `blockingFor()` fixes "cannot step onto its last step": a platform you are
  tall enough to step onto must not push you out horizontally. Its own
  collider used to eject the player at the exact moment they arrived at the
  edge. Players climb the full 2.4 m watchtower ramp now.
- Real falling: walk off an edge and you fall. Fall out of the world and you
  respawn at the level spawn with 45 damage and a "You fell." toast.
- Zombies use the same ground and the same steppable rule, so they can follow
  the player up a ramp instead of orbiting its base.
- Verified by `test/groundprobe.mjs`: Y goes 0, 0.2, 0.6, 1.0, 1.4, 1.8, 2.2,
  2.4 in clean steps. Smoke test green, navprobe still 0 frozen.

## v0.10.0 - 2026-08-23 - THE REBUILD begins

Direction change from Ola's v0.9.3 playtest, captured in the new
docs/level-design.md (now the authority on level structure) and his two
sketches in docs/sketches/. The high-rise concept is dropped: it never
became real fiction, and every level collapsed into wave defense in a box
because levels were generated to fit the physical play area.

Two alternating archetypes replace it:
- HOLDOUT: a small base (5x5 to 8x8 m) in a big open daylight field
  (60-80 m). Players cannot leave the base; the base itself can be
  damaged and lost. Zombies cross open ground from behind distant sight
  blockers, so you always see them coming.
- TRAVERSE: a dark underground route 10x10 to 20x20 m, spawn in one
  corner, reach the exit in the other. Moving forward is the objective.

Later: RIDE maps (the squad on a moving vehicle).

The elevator survives as the transition device only: a metal plate inside
the base that becomes the lift when the area is cleared, keeping its
three jobs (rebuild the world, run the shop, re-centre roomscale VR).

docs/vision.md and docs/projectplan.md updated to match.

## v0.9.3 - 2026-08-23 - Ola's playtest pass

Everything here comes from real playtest feedback, which outranks every
critic agent. Fixed in the order given: root causes first.

ROOT CAUSE 1 - the play area was driving the whole world (v0.9.0)
- Levels are now a fixed generous 34 m on every platform. The physical
  play area ONLY decides where the roomscale zone is painted, and
  roomscale VR re-centres onto that patch. Shoot far, walk near.
- No more square rooms. New src/world/kit.js builds every level from
  walls, chest-high cover, ramped platforms, railings and corridors:
  the ground compound has three gates, inner buildings and a watchtower;
  the basement is a boiler maze with a spine corridor and a maintenance
  deck; the upper floor is offices around a corridor ring with a
  mezzanine and a balcony; the trench has four lanes, connectors and
  firing steps; the wagon is three cars joined by gangways; the boss
  arena has a gantry ring and cover pillars.

ROOT CAUSE 2 - the day phase was dead time (v0.9.1)
- First zombie now arrives 1.6 s after START (was ~50 s).
- Daylight raids trickle in all day through the same visible entrances,
  so the game is no longer night-only and finally matches the "zombies
  in daylight" art direction.
- Day 45s->22s (first day 8s), countdown 5s->3s, plus an anti-dead-air
  guard that pulls the next beat forward when nothing is happening.
  Measured: 0 of 60 sampled seconds with nothing to fight.
- Prep made meaningful: mines 50->18 scrap, map placement 65->26, and
  players start with 2.

ROOT CAUSE 3 - upper floors had no fiction (v0.9.0)
- Enemies never appear from thin air. Every entry has a VISIBLE source:
  a stairwell head with steps going down out of sight, an open elevator
  shaft with bent doors and a dangling cable, wall breaches with rubble
  spill, facade climbs with bent railing and a hanging cable, gates and
  trench tunnel mouths.

COMBAT FEEL (v0.9.2)
- Right click aims down sights (tighter spread, narrower FOV, slower
  turn); Shift is the ADS modifier so dual pistols can still aim.
- Dual pistols alternate: left button fires the left gun, right the
  right, each with its own cooldown, kick and muzzle side.
- Headshots: real head spheres per enemy type, 2.5x damage, amber
  HEADSHOT callout, distinct sound, blood at head height.
- Reload animation on EVERY weapon.
- Elevator doors open whenever a player is near the cab, in any phase.
- Open edges that only let you walk OUT are sealed with player-only
  barriers the horde still walks through.

DIFFICULTY AND TENSION (v0.9.3)
- Steeper ramp, tighter cadence, harder bites, alive cap 20->24, depth
  roster arriving earlier.
- Every floor announces its own identity and carries a scripted twist.
- Measured with a kiting bot: night 1 survivable at full HP, night 5
  kills it in 68 s, night 9 in 54 s at the cap.

Also: interiors lit so they read, tactical map sees past ceilings and
suspends fog. Perf holds at 44 draw calls / 5.1k triangles with 24
zombies.

## v0.8.2 - 2026-08-23 (run wrap-up)

Budget-driven landing: critic loops stopped, ending shipped. Why: the
account hit its monthly spend limit; the goal became a finishable game
rather than a perfect one.

- Placeholder purge on the critical path: consistent shop labels
  (OWNED/FULL states, dot separators), readable purchase toasts instead
  of raw item keys, HUD markup defaults matching the live formats, and
  a shop status line that names the floor you are heading to.
- README rewritten for a finished project (play, deploy, develop, files).
- TEST-ON-DEVICE.md rewritten around the full 12-floor run.
- Performance gate: 61 draw calls / 3.8k triangles with 16 zombies alive
  at VR quality (budgets ~100 calls, ~250k triangles).

## v0.8.1 - 2026-08-23

- Explosive barrels: red drums near the level entrances, 2 hits to pop,
  4 m blast that chains to nearby barrels, throws corpses and hurts you
  if you stand too close. Grenades set them off too.
- FIXED: night modifiers never actually applied for the host (the
  host-side wave mirror dropped the `mod` field, so fog/blackout lighting
  and the announcement never fired). Verified: fog, frenzy, blackout and
  harvest all roll across nights 3-14.
- forceNight is now robust from any non-terminal phase (test hook).

## v0.8.0 - 2026-08-23

THE ENDING. The run can now be won.

- A run is exactly 12 floors. Floor 12 is the Butcher's arena (dawn-lit
  roof slaughteryard with cover pillars and its own barrels).
- Killing the Butcher on the final floor triggers the ROOF FINALE: a
  helicopter flies in from the west, hovers with a searchlight while the
  survivors hold the roof, then lifts away and the run is WON.
- Victory screen (EXTRACTED) with nights survived, kills and unspent
  scrap; RUN IT AGAIN starts a fresh run on a newly seeded building.
- Anyone still downed is pulled aboard at the finale (no one is left).
- Meta progression records extractions; the menu line shows them.
- Verified end to end by test/endingprobe.mjs.

## v0.7.0 - 2026-08-22 22:40

Phase 3 pass 2: the critic loops begin. Why: visual critic round 1 scored
2-3/10 everywhere; Ola added the feel-critic loop to the plan.

- Visual round 2 (from critic round 1 fix lists): procedural canvas
  textures everywhere (sand, concrete, sandbags, planks, plaster, worn
  metal, dirt) with world-space UV scaling so tiling matches across all
  wall sizes; gradient sky dome + sun glow + soft dust motes; lower warm
  sun with long shadows (desktop); ruins got broken rooflines, window
  holes and rebar; wrecked-car midground anchor; foreground debris ring
  and road tire tracks; upper floor window frames, light pools and
  baseboards; trench duckboards, support beams, rim sandbags and brighter
  flares; elevator fluorescent tube, glowing buttons, hazard sill; deep
  blue dark levels (never pure black); item pickups glow with ground
  rings; HUD skinned with amber accents and low-ammo colors.
- Performance gate work: static level geometry merges into one mesh per
  material; the entire horde renders as SEVEN instanced draw calls (any
  count) with per-instance accent colors, size variation and shadows.
  Levels now render at 11-28 draw calls.
- Feel systems (the new plan section): recoil kick with recovery, shotgun
  knockback shoves, hit markers (white tick, red on kill), screen shake
  on explosions (flat modes only, never VR), zombie limb pivots at real
  joints, corpse topple deaths.
- ?feelclip=1..6 deterministic scripted gameplay clips + capture tooling
  (test/feelcapture.mjs: Playwright video + frame strips per clip).

## v0.6.2 - 2026-08-22 21:15

Fixes from the 26-agent adversarial review of Phase 2 (21 confirmed
findings; scoreboard in QUALITY.md). Why: harden before the visual pass.

- CRITICAL: in half of all trench seeds the elevator's collider sealed the
  only lane connector, cutting the level in two; the first connector is
  now always on the east side, away from the elevator.
- Trench: connector openings now double as zombie routing waypoints (the
  horde can walk the serpentine hop by hop); SMALL/MEDIUM play areas get a
  compact straight-lane trench that actually fits the physical footprint.
- Grenades now bounce off walls instead of tunneling through them, and a
  molotov shatters on wall impact; molotov fire finally credits its
  thrower with scrap (it was the only weapon that paid nobody).
- Upper floor: everything beyond the walls now drops to street height, so
  grenades over the balcony burn down on the street instead of mid-air.
- Arrival day length is chosen from the INCOMING floor's type (the wagon
  got a 45 s day and the floor after it 10 s, reversed).
- Retry after a mid-night death no longer replays the level one night
  harder (off-by-one in the night rollback); per-attempt kill stats stop
  double-counting into the meta totals.
- Day loot now drops near player spawns on every level type (it landed
  beside the wagon and inside trench dirt).
- Client reload desync fixed (a stale snapshot could zero a freshly
  reloaded magazine and force a second reload); host now sees correct
  smoke/molotov tints in flight; fire/ping/drone/zombie visuals free
  their GPU buffers on removal (leak found in review).

## v0.6.1 - 2026-08-22 20:25

Phase 3 pass 1: soundscape + combat feel. Why: projectplan Phase 3 items
(audio, weapon feel, hit reactions).

- Full procedural WebAudio soundscape (no asset files, everything is
  synthesized): per-weapon gunshots, dry-fire, reload, machete whoosh,
  explosions, zombie hit/death/random groans (positional), player hurt
  and heal, pickups and purchases, pings, smoke hiss, molotov ignite,
  elevator doors, and minor/major synth stingers at night/day. Wind
  ambience outdoors, low drone in dark levels. Positional one-shots via
  equal-power panners; listener follows the camera; unlocks on the first
  gesture (iOS rule).
- Weapon feel: per-weapon recoil kick (flat modes), ejected shell
  casings with physics, viewmodel kick retained.
- Zombie hit reactions: torso flinch on hit; deaths now topple backward
  ragdoll-light and sink away instead of shrinking.

## v0.6.0 - 2026-08-22 19:40

Phase 2 complete: roles and depth. Why: projectplan Phase 2 items.

- Weapon roster v2: AK (heavy auto, 650 scrap), dual pistols (slot-1
  upgrade, both hands fire in VR), smoke grenades (slow cloud, 8 s),
  molotovs (burning patch, shatters on impact), night vision device
  (green light + grain overlay, 30 s battery, recharges by day; N key /
  NV button / left-stick press in VR). V / SWAP / right-stick press
  cycles the selected throwable.
- Scout drone from the tactical map (40 scrap): flies to the target,
  hovers 10 s, pings the nearest zombie every 2 s.
- New level types in a 6-floor cycle (ground, basement, upper, ground,
  trench, wagon): the TRENCH (serpentine night trench, flares, flashlight,
  tight lanes) and the WAGON (moving flatbed platform: scenery scrolls
  past, zombies vault in over the open ends, single night, no shop, the
  ride simply arrives).
- Meta progression in localStorage (versioned schema): best nights/floor,
  total kills, run count, veteran scrap bonus (+25 at 4 nights, +50 at 8)
  that each device brings to any room it joins; record line in the menu.
- Shop restyled as a two-column grid with the six new items.
- Smoke test now generates and renders all six level types.

## v0.5.1 - 2026-08-22 18:30

Fixes from the 35-agent adversarial review of Phase 1 (28 confirmed
findings, scoreboard in QUALITY.md). Why: harden the loop before Phase 2.

- CRITICAL: cross-browser desync killed: basement doors were shuffled with
  a random-comparator Array.sort (engine-defined order); doors are now
  fixed to the three non-elevator walls.
- CRITICAL: elevator boarding zones moved INSIDE the play footprint on all
  three level types (roomscale VR players could never physically reach
  them: guaranteed softlock on every ground floor). The basement cab moved
  to the solid north wall with its doors actually facing the room; cabs
  now also have colliders.
- CRITICAL: if the last standing player disconnects while teammates are
  down, the run now ends in game over instead of softlocking.
- Day loot no longer vanishes on floor arrival (it spawned against the old
  level and was wiped by the level switch).
- Upper-floor street spawns removed (they teleported to room height and
  floated at the windows, biting through the sill); street ambience
  returns as visuals in Phase 3.
- Zombies: bites now require line of sight (no chewing through walls),
  spawn jitter reduced so nobody spawns behind a wall, an 8 s stuck
  failsafe re-enters via a doorway, and the spawn timer no longer builds
  a backlog at the alive-cap that dumped the whole queue in one frame.
- Late joiners now land in the correct phase presentation (night lighting,
  open shop, gameover) via idempotent phase side effects; shop/gameover
  panels no longer pop over the connected-lobby of a client who has not
  pressed START.
- Client ammo counter no longer bounces on every shot; killed zombies no
  longer reappear as 120 ms interpolation ghosts.
- Tactical map: taps now work on touch devices (stick/look zones release
  the canvas), the map closes on level load/ride/gameover, and clicking
  during the shop no longer swallows the cursor into pointer lock.
- Entering VR while a join is connecting starts the game on welcome.
- Shop MINE button shows its real label and a FULL state; mine kills now
  pay scrap to the mine's owner.
- Photomode 2 and 6 now actually show their zombies. Zombie skin/pants
  materials shared across the horde (draw-call diet; full instancing
  lands in the Phase 3 performance pass).

## v0.5.0 - 2026-08-22 17:25

Phase 1 Pass D: mines, the tactical map and pings. Phase 1 core loop is
now feature-complete. Why: last Phase 1 projectplan items.

- Mines: buy in the shop (50 scrap, carry 3), hand-place during the day
  (T key, MINE flow on touch via the map, left grip squeeze in VR), 1 s
  arming, proximity trigger, 2.5 m blast that leaves a brute at 3 hp.
- Tactical map view (M key / MAP button, flat platforms): orthographic
  top-down live view with PING (free squad marker, 5 s) and MINE mode
  (remote placement for 65 scrap, the tactician premium).
- Ping markers render in-world for everyone (bouncing cone + ring).
- Shop is now modal (HUD hides during the ride; the overlap checker
  caught the collision on phone screens).
- HUD shows carried mines (G/P/M).

## v0.4.0 - 2026-08-22 16:40

Phase 1 Pass C: the elevator IS the shop. Why: projectplan elevator item.

- Elevator shop during the ride: shotgun, SMG, ammo refills, health packs,
  grenade pairs, priced from the tuning sheet; purchases validated by the
  host against each player's scrap; READY skips the timer when the whole
  squad readies up; downed players can still shop.
- Arriving on a new floor revives anyone still down (they rode along).
- Play-area size choice in the hosting panel (SMALL 3 m / MEDIUM 6 m /
  LARGE 12 m squares); the host's choice reaches every client, all level
  layouts adapt (clutter thins out, windows and walls rescale).
- VR re-centering on every floor arrival: the world rebuilds around the
  player's physical head position (the elevator trick).
- Smoke test now drives the full loop: two nights cleared, squad boards,
  shop on both peers, both arrive on floor 2.

## v0.3.0 - 2026-08-22 15:55

Phase 1 Pass B: the arsenal. Why: projectplan weapon roster v1 + gear.

- Weapons v1 with distinct feel from the tuning sheet: pistol (8-mag,
  infinite reserve), shotgun (6 pellets, one-shots walkers point blank),
  SMG (full auto, 30-mag), machete (one-swing walker/runner, +5 scrap
  melee bonus), frag grenades (3 s fuse, physics arc, falloff, thrower
  self-damage only).
- Host-authoritative inventories (owned weapons, mags, reserves, grenades,
  packs, scrap per player) with client-side prediction (arsenal.js).
- Reload per platform: R key, RELOAD button, VR grip squeeze. Auto weapons
  fire while trigger/button held on all platforms.
- Weapon switching: 1-4 keys + Q cycle, WEAPON button on touch, A button
  in VR; the active weapon's model shows on the flat viewmodel and both VR
  controller grips.
- Loot: day-phase supply drops and zombie drops (ammo, grenades, health
  packs) with pickup by proximity and toast feedback.
- Health packs heal 50, or instantly revive a downed teammate next to you.
- Explosion and muzzle VFX; other players' shots flash at their muzzle.
- HUD: weapon name, mag/reserve, grenade + pack counts, scrap.

## v0.2.0 - 2026-08-22 15:05

Phase 1 Pass A: the world and the loop skeleton. Why: projectplan Phase 1.

- Seeded level generator: ground (fortified base, wasteland sightlines),
  basement (dark room, pillars, doorway entries, flashlight), upper floor
  (window wall, balcony, street below). All peers build identical geometry
  from the seed in the welcome message; levels are never networked.
- Elevator cab (worn metal, sliding doors, interior lamp) on every level;
  doors open when the floor is cleared, the squad boards, the ride leads
  to the next floor.
- Horde: many zombies, three types with readable silhouettes and accents
  (walker rust, runner yellow lean, brute massive dark red).
- Wave director from the tuning sheet (game-design agent pass): threat
  budgets 1.25x per night, trickle + bursts, 2 nights per level, alive cap
  20 (Quest budget), co-op scaling.
- Day/night cycle with smooth sky/fog/sun lerp; night waves, day prep.
- Downed/revive (proximity revive, 4 s), game over + score screen, restart
  current level. Countdown and phase announcements on the HUD.
- Collision: players and zombies resolve against level colliders; hitscan
  is occluded by walls; zombies route through doorways/gaps.
- Flashlight (headlamp, F toggles, auto-on in basements).
- Tuning config in src/game/tuning.js with the design rationale inline.

## v0.1.1 - 2026-08-22 14:20

Fixes from a 33-agent adversarial review of the Phase 0 code (21 confirmed
findings, all addressed; scoreboard in QUALITY.md). Why: harden the steel
thread before real-device testing.

- Critical: the zombie froze forever after its first death (death timer
  went negative and was never reset).
- Session lifecycle: every session start now fully tears down the previous
  one; orphaned PeerJS peers from repeated HOST/JOIN, BACK from joining or
  fatal errors can no longer fire stale callbacks into a later game.
- Client LEAVE no longer shows a false "CONNECTION LOST" overlay
  (net.leave detaches callbacks before destroying the peer, and returning
  to the menu always clears the error panel).
- Broker-socket loss mid-game is no longer fatal: existing P2P connections
  keep playing, a toast explains that new joins are blocked, and the peer
  tries to reconnect to the broker.
- HOST A ROOM disables the menu and shows "contacting broker" while
  pending; double-clicks can no longer create parallel sessions or ghost
  players.
- Touchscreen laptops are desktop again (pointer:fine detection); they
  kept losing keyboard and mouse entirely.
- VR: entering VR from the lobby now starts the game (the 2D START button
  is invisible inside the headset); hand poses are mapped by actual
  handedness and only sent while tracked.
- Sim: the world only simulates while playing (no lobby bites); the zombie
  no longer melees through the sandbag wall while routing to a gap; floor
  height is consistent at the base edge.
- Photomode is now pixel-deterministic (animation no longer advances on
  wall clock) and the debug atlas leaves transparent blob shadows alone.
- Mobile: FIRE button no longer overlaps the ammo readout on notched
  phones. Join input only accepts characters the code alphabet produces.
- Client shows "connection stalled" when snapshots stop arriving
  (backgrounded host tab), per LESSONS.md.
- Smoke test: new regression check that a deliberate client LEAVE lands on
  the menu without an error overlay. All checks green.

## v0.1.0 - 2026-08-22 13:58

- Phase 0 steel thread built and smoke-tested green. Why: the project plan
  demands a playable line through everything before any polish.
- index.html with lobby state machine (boot, menu, hosting, joining,
  connected, playing; VR entry orthogonal), documented z-index scale
  (HUD 100, menus 200, overlays 300, debug 900), room code shown huge with
  copy button, locomotion choice (roomscale/stationary).
- Vendored pinned stack: Three.js r170 + PeerJS 1.5.4 in vendor/, import
  map, no CDN at runtime. Why: reproducible deploys, same-origin assets.
- PeerJS netcode: host-authoritative star, 4-char codes from the safe
  alphabet, id-collision retry, 20 Hz poses up / 15 Hz snapshots down,
  clients interpolate 120 ms behind. Protocol documented in
  src/net/protocol.js.
- One ground-level daylight world (fortified base, sandbag walls with
  firing gaps, wasteland backdrop), one zombie (walks in through gaps,
  attacks, dies, respawns), one pistol (hitscan, ammo, reload).
- Input layers: desktop WASD + pointer lock, mobile joystick + tap/FIRE
  button, WebXR entry button (local-floor, synchronous in click handler),
  stationary VR locomotion (smooth move + snap turn with head pivot),
  simple pistol models on controller grips.
- Photomode presets 1-9 incl. deterministic boot and the debug texture
  atlas (9); verified: no mirrored or flipped text.
- UI state gallery (?uistate=...) and test/smoke.mjs (Playwright: host +
  client contexts, join, two-way sync assert, VR button in hosting AND
  joined states, overlap checks at 3 viewport sizes, no console errors).

## v0.0.3 - 2026-08-22 11:33

- Added the arsenal to docs/vision.md: pistol, dual pistols, shotgun, SMG,
  AK-style rifle, machete, frag/smoke/fire grenades, health packs, night
  vision device, plus per-platform reload mechanics. Split into weapon
  roster v1 (Phase 1) and v2 (Phase 2) in the project plan. Why: Ola's
  spec of classic weapons and gear.
- Added named reference games (Arizona Sunshine, Left 4 Dead 2, CoD
  Zombies, Zero Latency style free-roam, classic rail shooters, Fallout
  for tone) to vision and wired them into the critic loop's side-by-side
  comparisons, with an explicit no-IP-copying rule. Why: named references
  make the critics far sharper than "AAA quality" alone.
- Wasteland tone added to art direction (sun-bleached ruins, scavenged
  improvised gear).

## v0.0.2 - 2026-08-22 11:17

- Renamed to ZOMBIE HIGH RISE, everything switched to English (docs, prompt,
  game UI). Why: the crew decided to run the whole project in English.
- Level design widened: the elevator now goes up AND down. Basement levels
  (claustrophobic), ground levels about every 3rd (shoot OUT of the base
  across open ground), upper floors (balconies). Why: only-indoors felt too
  claustrophobic.
- Added stationary VR mode (stick locomotion + snap turn) as a first-class
  mode; multiplayer now assumes players join from different homes. Quest 3
  explicitly supported. Why: only one headset locally, remote friends.
- Single-player VR calibration removed (not needed); co-located multi-VR
  moved to docs/TODO.md as a future mode. Why: simpler v1.
- Critic loop softened: caps per pass, QUALITY.md scoreboard,
  OPEN-QUESTIONS.md instead of stopping to ask; hard stops only at phase
  boundaries. Why: long autonomous runs must not stall waiting for Ola.
- Added lobby matrix requirement, UI state gallery (?uistate), z-index
  scale, and texture debug atlas (?photomode=9). LESSONS.md pre-seeded with
  the crew's previous real bugs (flipped textures, lobby host-vs-VR
  lockout, UI overlap). Why: these exact issues cost iterations before.

## v0.0.1 - 2026-08-22 10:42

- Kickoff package created (Ola + Claude in Cowork): vision, technical spec,
  art direction, project plan, master prompt, conventions and pre-seeded
  LESSONS.md. Why: give Claude Code a complete, unambiguous start so the
  credits go into the build, not into misunderstandings.
