# VR parity

**The rule, from Ola (v0.13.x playtest):**

> VR is being treated as a rendering mode, not as its own interface.
> Features are built flat-first and only partly ported. A feature is NOT
> done until it is usable in VR. Every piece of state a flat player can see
> must be visible in VR, and every action a flat player can take must be
> performable in VR.

This is not advice. It is the definition of done. A feature that works on a
monitor and not in a headset is an unfinished feature, not a ported one.

## Why this document exists

Being downed in VR was a **softlock**: no text, no explanation, no way to
restart or quit. The game simply stopped. The cause was structural rather
than an oversight: every stopped state (downed, game over, victory) was a
DOM overlay, and **DOM does not exist inside a headset**. So the player
could neither see their state nor act on it.

The same structural gap produced the rest: the HUD was DOM, prompts were
DOM, the score was DOM. Each one was invisible in VR for the same reason,
and each was found separately, in the headset, one playtest at a time.

## The two failure modes

1. **State that only exists as DOM.** If the only place something is
   written is `index.html`, a VR player never sees it. Every readout has to
   reach the wrist display or a world-space surface.
2. **Actions that need a mouse, a keyboard or a DOM button.** If the only
   way to do something is to click, a VR player cannot do it. Every action
   needs a controller route: a face button, a grip, a trigger, or a
   hold-to-act on a world-space target.

## The checklist

Every row must be **visible** (a VR player can perceive the state) and
**actionable** (a VR player can do the thing). `n/a` means the row has no
action.

| # | Feature | Visible in VR | Actionable in VR | Verified by |
|---|---|---|---|---|
| 1 | Objective, in plain words | wrist display, inner forearm, pulses and pings on change | n/a | `vrprobe` |
| 2 | Wave / zombies remaining | wrist display | n/a | `vrprobe` |
| 3 | Health | wrist display | n/a | `vrprobe` |
| 4 | Base integrity | wrist display | n/a | `vrprobe` |
| 5 | Scrap | wrist display | n/a | `vrprobe` |
| 6 | Weapon and ammo | wrist display **and** a counter on the gun | n/a | `vrprobe` |
| 7 | Reload | gun cants over, charge light fills, three-beat sound | point the barrel at the floor and hold; right grip also works | `vrprobe` |
| 8 | Out of ammo | red zero on the gun, hard mechanical click | n/a | headset |
| 9 | Magazine seated | charge light turns green, clack and rising tone | n/a | headset |
| 10 | Recoil | weapon kicks about the grip, slide cycles, muzzle flashes; aim is never moved | n/a | headset |
| 11 | Flashlight | the off hand carries it, lit only on dark levels | aimed with the off hand; Y toggles | `vrprobe` |
| 12 | Downed | world panel: "YOU ARE DOWN" plus what happens next | face button quits to menu | `vrprobe` |
| 13 | Game over | world panel: "GAME OVER" plus the floor reached | A retries the floor, B quits | `vrprobe` |
| 14 | Victory and score | world panel: "EXTRACTED" plus the run stats | A runs it again, B quits | `vrprobe` |
| 15 | Repair the wall | highlighted section, world-space prompt, filling ring | walk up and hold the left grip | `interactprobe` |
| 16 | Revive a teammate | marker drawn through geometry, prompt, ring both players see | stand next to them | `interactprobe` |
| 17 | Elevator shop | **PENDING** the shop is a DOM panel | **PENDING** | |
| 18 | Level transitions | arrival card is DOM only; the wrist carries the objective | board by standing on the plate | partial |
| 19 | Tactical map and drone | **PENDING** the map is DOM and disabled in VR | **PENDING** | |
| 20 | Teammate presence | head and both hands from the headset and controllers, arms solved by IK, name tag, own colour | n/a | headset |

Rows marked **PENDING** are known gaps, listed here so they are tracked
rather than rediscovered. A pending row is an unfinished feature.

## Testing VR without a headset

A real WebXR session cannot be created in a headless browser, but nearly
all VR logic can run without one: three.js creates the controller and grip
groups on demand.

`test/vrprobe.mjs` uses a test seam, `debugForceActive`, which flips the
session flag and supplies a session object with no input sources. Every
pose-driven path then runs for real: weapon alignment, the reload gesture,
recoil, the wrist display, the modal panel.

Two things to know when writing such a test:

- Fake controller poses must be written to `.matrix` and then decomposed,
  because three sets `matrixAutoUpdate = false` on those groups. Setting
  `.quaternion` alone does nothing.
- Assert that the code actually **runs**, not just that it exists. The
  reload gesture was written, shipped in a changelog, and never called: the
  edit meant to wire it in matched nothing and passed silently. A test that
  only checked the function existed would have passed too.

## When adding a feature

1. Build it.
2. Ask both questions: can a VR player **see** this, and can a VR player
   **do** this?
3. Add a row to the table above and a case to `test/vrprobe.mjs`.
4. Only then is it done.

## The drone, and what "performable in VR" costs (v0.19.0)

The drone was the clearest failure of the rule on this list. It was fully
built, load-bearing on holdout levels (it is the only way to collect loot
that lands where the squad cannot walk), and completely unusable in a
headset, because sending it needs a POINT on a map and VR had no way to
give one. The flat player clicked. The VR player had nothing.

What it took to fix, which is the useful part of the story:

1. **A surface big enough to aim at.** The wrist display is a watch face.
   You can read three numbers off it; you cannot pick a spot on a level
   from it. So the wrist became the TRIGGER: look at it for half a second
   and a large panel unfolds in front of you.
2. **A way to point.** Two, without a mode switch: with the pistol in
   hand you point along the barrel, and if you stow the pistol on your
   hip the free hand points instead. What you are holding decides.
3. **A reason to trust it.** The panel is a render of the same
   orthographic camera the flat map uses, markers and all. It is not a
   second drawing of the level, so it cannot disagree with the first.
4. **Arithmetic that is actually checked.** Turning a point on the panel
   back into a place on the ground is the one bit of maths in the
   feature, and the first version had the vertical axis mirrored: every
   drone would have flown to the wrong side of the level with nothing on
   screen to say so. It is now checked against the camera's own
   projection matrix at off-centre points. Checking the centre alone
   proved nothing, because a symmetric frustum maps the centre to the
   centre no matter which signs are wrong.

**The lesson for the next feature:** "usable in VR" is rarely a matter of
drawing the same thing on a panel. It usually means finding the physical
gesture that replaces the click. Here that was a glance and a reach.
