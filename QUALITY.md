# QUALITY - scoreboard and open flaws

## Probe assertion overhaul (DONE, v0.18.2 to v0.21.0)

Ola: "probes must assert what a PLAYER would notice, not what a variable
does." Three probes had already passed while the thing they claimed to
check was broken, so this is a pass over the whole suite. Each probe gets
rewritten once, listed here with what was wrong and what it asserts now.

A probe is done when it satisfies three rules:

1. **It fails.** Break the feature on purpose and watch the probe go red
   before believing it. Every entry below has been falsified this way.
2. **It goes through the real path.** No calling handlers directly, no
   setting flags the sim owns, no debug shortcut into the state under
   test.
3. **It asserts the visible thing.** The mesh on the ground, the number on
   the HUD, the health that dropped. Not the simulation's bookkeeping,
   which can be right while the screen is wrong.

| Probe | Was | Is |
|---|---|---|
| `barrelprobe` (now EXPLOSIVES) | Printed counts and exited 0 whatever they were. It could not fail. | 9 assertions on visible outcomes: a shot barrel disappears, a shot mine detonates, a row of mines chains, a barrel blast takes the minefield with it, your own blast costs you health, and a mine can be laid underground. Falsified by disabling the chain: goes red. |
| `smoke` HUD layout | No layout check existed; the overlap was found by eye in a headset. | Every visible HUD box checked against every other at five window sizes, with normally-hidden boxes forced visible first. The first version passed on a screen the base bar was not even on, which found nothing; with the boxes visible it immediately found two unreported collisions. |
| `vrprobe` game over | Reached game over by a debug shortcut and pressed A by calling the handler. | Dies the way a player dies and presses A through the real gamepad loop. (v0.18.0) |
| `gymprobe` | Written this way from the start: asserts arrival, not intent. | Found 7 real movement bugs on its first run. (v0.17.0) |
| `holdoutprobe` | Printed OK and FAIL strings and exited 0 either way, so a red run and a green run looked identical to anything reading the exit code. | Every pass/fail line goes through one `note()`, and the process exits non-zero. Plus a new check that the horde VISIBLY attacks the base and does not swing in lockstep, which found that the host had fallen a column behind its own clients. |
| `hotprobe` (new) | Nothing: the feature did not exist. | Edits a real level data file on disk while the game is running, and checks the level changed, the run survived (same phase, same scrap, still alive), a broken file is reported without taking the game down, and fixing it recovers. It found the bug on its first run: `fetch` and `import()` resolve relative paths against different bases. |
| `vrprobe` reload |  No check existed; Ola read the animation in the headset and said it was unreadable. | Films 110 frames of a real reload and asserts what you would see: the magazine leaves, there is a beat where the well is empty, a fresh one seats, and the gun snaps over and HOLDS rather than sweeping. The held fraction is measured over the animation, not the sampling window, because trailing idle frames were making a correct animation look slow. |
| `vrprobe` torch | No check existed; Ola found the dead switch in the headset. | Pulls the real trigger through the real listener, on a dark level, and watches the beam rather than the flag. Both new checks first ran on the WRONG LEVEL (see LESSONS.md) and now assert they arrived before asserting anything else. |

All 21 probes converted. `node test/all.mjs` runs the suite and exits
non-zero if anything is red; a green run is twenty lines, a red one prints
the failing assertions.

**Twelve of the twenty-one could not fail at all.** They printed numbers,
sometimes with the word FAIL in the string, and exited 0 regardless. A red
run and a green run were indistinguishable to anything reading an exit
code, which includes a person scrolling past.

| Probe | Was | Is |
|---|---|---|
| `navprobe` | Printed "tracked / closed / frozen" per level. | Asserts the horde reaches you and that nobody is STRANDED. The first version checked "did not move", which failed the game for zombies that were standing still because they were biting the player. Stranded is not-moving AND far away, which is the "1 left forever" bug that has actually shipped. |
| `groundprobe` | Printed Y samples and an OK/FAIL string. | Asserts the probe walked at all (see below), that the top step is reachable, and that the way up is a climb rather than a snap. |
| `rampprobe` | Two OK/FAIL strings. | Same two claims, now able to fail. |
| `recoilprobe` | Four OK/FAIL strings among the numbers. | Spamming costs you the shot, the pattern repeats, the sight comes home, and the SMG still beats the pistol on sustained damage (Ola asked for that last one directly). |
| `endingprobe` | A chain of `waitForFunction` calls whose only failure was an uncaught timeout and a stack trace. | Each beat of the ending is its own named check, so a missing one says which. |
| `pacingprobe` | Printed "dead air: N/60". | Asserts something to shoot at turns up within 25 s and that the level is not mostly empty. |
| `lookprobe` | Screenshots plus a draw-call count per level. | Screenshots stay (a person has to look at those), plus four checks per floor: ground under your feet, not falling out of the world, somewhere for the horde to come from, inside the draw budget. 24 checks across six floors, including ones nobody plays by hand. |
| `modprobe` | Printed which modifiers rolled and which enemies spawned. | Asserts modifiers actually roll and that a late night is not still walkers and runners. It skips the roster question on a `swarm` night, because swarm is all walkers by design and asking anyway made the probe fail at random. |
| `pressureprobe` | Printed survival time, peak alive and lowest HP. | The bot has perfect aim, perfect kiting and infinite ammo, so asserting on its health was measuring the instrument. It now asserts REACHABILITY with the trigger held: can the horde catch a player running away. Stable at 0.0 to 0.1 m against a 2.5 m threshold. |
| `vraimprobe` | Printed the angle and appended OK or FAIL. | Six checks: at three controller tilts the gun points where you aim and the bullet goes there. This guards the 45-degree bug and had no guard. |
| `droneprobe` | Printed what landed and one OK/FAIL. | Nine checks: a drone goes up, each of the four payloads lands, every trap has a mesh to look at, the drone flies home, and the flare pulls part of the horde. |
| `perfprobe` | Printed a JSON blob. | Asserts the horde filled up to measure, and that draw calls and triangles are inside the budgets from technical-spec.md. Those are hard requirements and nothing was checking them. |
| `shotprobe` | Saved a screenshot. | Still a capture (a muzzle flash is a judgement call), but it now asserts a shot was actually fired, so the screenshot cannot be a picture of a gun not going off. |

### What the overhaul found

Four real bugs, none of which any probe had reported:

1. **`debugMove` had been dead since v0.17.0.** It wrote straight into
   `rig.group.position`, and the character controller has copied its own
   position over the rig every frame since it took ownership of the body.
   Every write was silently undone. `groundprobe` walked at a ramp for 22
   steps without moving a centimetre and reported "could not reach the
   top", which reads like a ramp bug; and the pressure bot's kiting, the
   thing that probe exists to simulate, had not happened for four
   versions.
2. **The enemy mix went negative from night 7.** Walker is the remainder
   after the other five caps, and those caps add up to more than 1 from
   night 7 on. Walkers vanished entirely and the spawn budget was
   over-allocated by the overflow. Clamped and normalised.
3. **The host ran a column behind its own clients** (v0.19.1), found by
   the new base-attack check.
4. **Two probes were testing floor 1 while claiming to test floor 2**
   (v0.18.3), because `?level=2` is not a parameter that exists.

### The three rules, restated

Every check written from here on:

1. **Must be able to fail.** Break the feature on purpose and watch it go
   red before believing it.
2. **Goes through the real path.** No calling handlers directly, no
   setting flags the sim owns, no debug shortcut into the state under
   test.
3. **Asserts the visible thing.** The mesh on the ground, the number on
   the HUD, the health that dropped. And it must be a claim about the
   GAME, not about the instrument: the pressure bot's health was the
   clearest example of measuring the wrong body.

## Critic loop scoreboard

Visual critic (photomode views, target 9+):
- Round 1 (v0.6.2 art): V1 3, V2 3, V3 3, V4 2, V5 3, V6 2, V7 3, V8 3,
  V9 PASS. UI: hud 7, shop 6, lobby 7. Verdict: programmer art; top
  moves: real sun shadows + AO grounding, kill pure black, posed varied
  zombies.
- Round 2 (v0.7.0 textures/sky/dressing): V1 3, V2 4, V3 4, V4 2, V5 3,
  V6 4, V7 4, V8 4, V9 PASS-with-notes. Side-by-side: 1/5/7 better,
  2 noise. Top moves: kill the T-pose, dress the hero building,
  atmosphere + depth floor.
- Round 3 (v0.7.1 high-rise/markers/luminance): V1 5, V2 5, V3 5, V4 5,
  V5 4, V6 5, V7 5, V8 5, V9 PASS. Side-by-side: 1/4/6/7 better, 2/5
  noise. Verdict: "structure fixed; gap is content density and material
  finish". Top moves: midground kit, grounding/shadow pass, hero-asset
  materials (pistol, zombie accents, one brick family).
- Round 4 (v0.7.2): captured, scoring in progress.

Feel critic (feel clips, target 9+):
- Round 1 (v0.7.0): clips 2,3,3,2,1,2. Muzzle flash detached (casings at
  camera origin bug, fixed), no explosion visible (spawned behind the
  elevator; clip scenarios moved), no pain feedback (vignette added).
- Round 2 (v0.7.1): clips 4,4.5,3.5,3,2,5. Fixed: targets, hit markers,
  corpses, vignette. Still dead: muzzle flash/tracers invisible (they
  spawned ON the camera axis, hidden behind the crosshair - found via a
  probe screenshot and moved to the true muzzle offset), shotgun no-sell
  (stun added), grenade dud (cluster now walks INTO the blast).
- Round 3 (v0.7.2): captured, scoring in progress.

## Phase 2 adversarial code review - 2026-08-22 (v0.6.2)

26 agents, 21 confirmed findings (1 critical: trench connector sealed by
the elevator collider in half of all seeds), 1 refuted. All confirmed
findings fixed in v0.6.2.

## Phase 1 adversarial code review - 2026-08-22 (v0.5.1)

Method: 5 domain reviewers (sim, netcode, levels, input/UI, spec audit) +
one adversarial verifier per finding, 35 agents. 30 findings raised, 28
confirmed, 2 refuted. All confirmed findings fixed in v0.5.1 except the
two deliberately deferred items below. Smoke green after fixes.

Deferred (tracked, not forgotten):
- Draw-call budget: 20 zombies x 7 meshes still exceeds the ~100 draw
  call budget on paper (~190 with a level). v0.5.1 shares skin/pants
  materials as a stopgap; the real fix (instancing/merging) is the
  Phase 3 performance pass. Measured photomode scenes stay under budget
  because photomode dresses fewer zombies; the live night must be
  re-measured on Quest 2.
- Elevator boarding is "stand in front of the open doors" rather than
  physically inside the cab (the cab is solid). Revisit in Phase 3 if the
  boarding fantasy needs the interior.

## Phase 0 adversarial code review - 2026-08-22 (v0.1.1)

Method: 5 domain reviewer agents (netcode, VR, input/UI, spec audit, sim)
plus one adversarial verifier per finding, 33 agents total. 28 findings
raised, 21 confirmed, 7 refuted. All 21 confirmed findings fixed in
v0.1.1 (see CHANGELOG.md). Smoke test green after fixes.

Refuted (no action, kept for the record):
- Player death/respawn/game-over missing: intentional Phase 1 scope.
- VR grip-reload and flashlight buttons missing: Phase 1 scope
  (projectplan.md weapon roster item).
- Client auto-retry reconnect missing: spec documents manual rejoin with
  the same code as the v1 strategy; works today.
- #btn-vr z-index 250: inside the menus layer's own stacking context, so
  the documented global scale is not violated.
- Zombie could walk out through walls when chasing an outside player:
  cannot occur in practice (players inside the base, single zombie spawns
  outside).
- Hitscan ignores wall occlusion: accepted for Phase 0's single open base;
  becomes real work in Phase 1 level generator.

## Visual quality (critic loop starts in Phase 3)

Not yet scored. Phase 0 art is intentionally placeholder; the harsh critic
loop with photomode captures begins after real-device verification and the
Phase 1 core loop.

Performance snapshot (photomode 1, worst current scene):
32 draw calls, 618 triangles. Budgets: max ~100 draw calls, ~250k
triangles. Enormous headroom; will be re-measured every session.
