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
| 1 | Objective, in plain words | wrist display | n/a | `vrprobe` |
| 2 | Wave / zombies remaining | wrist display | n/a | `vrprobe` |
| 3 | Health | wrist display | n/a | `vrprobe` |
| 4 | Base integrity | wrist display | n/a | `vrprobe` |
| 5 | Scrap | wrist display | n/a | `vrprobe` |
| 6 | Weapon and ammo | wrist display **and** a counter on the gun | n/a | `vrprobe` |
| 7 | Reload | gun cants over, charge light fills, three-beat sound | point the barrel at the floor and hold; right grip also works | `vrprobe` |
| 8 | Out of ammo | red zero on the gun, hard mechanical click | n/a | headset |
| 9 | Magazine seated | charge light turns green, clack and rising tone | n/a | headset |
| 10 | Recoil | weapon model kicks; aim is never moved for the player | n/a | headset |
| 11 | Flashlight | the off hand carries it, lit only on dark levels | aimed with the off hand; Y toggles | `vrprobe` |
| 12 | Downed | world panel: "YOU ARE DOWN" plus what happens next | face button quits to menu | `vrprobe` |
| 13 | Game over | world panel: "GAME OVER" plus the floor reached | A retries the floor, B quits | `vrprobe` |
| 14 | Victory and score | world panel: "EXTRACTED" plus the run stats | A runs it again, B quits | `vrprobe` |
| 15 | Repair the wall | **PENDING** highlighted section, proximity prompt, hold-to-act ring | **PENDING** | |
| 16 | Revive a teammate | **PENDING** marker through geometry, proximity prompt, shared progress ring | **PENDING** | |
| 17 | Elevator shop | **PENDING** the shop is a DOM panel | **PENDING** | |
| 18 | Level transitions | arrival card is DOM only; the wrist carries the objective | board by standing on the plate | partial |
| 19 | Tactical map and drone | **PENDING** the map is DOM and disabled in VR | **PENDING** | |
| 20 | Teammate presence | **PENDING** avatars are a gas bottle with no arms | n/a | |

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
