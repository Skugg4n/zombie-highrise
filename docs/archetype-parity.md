# Archetype parity

**The rule, from Ola (2026-08-23):**

> Three of those four bugs are the same organisational failure we have now
> hit three times: something built for the first variant is only partly
> ported to the second. Flat was built first and VR got a partial port.
> Holdout was built first and traverse is now getting a partial port.

This is the same document as `docs/vr-parity.md`, for a different axis. A
behaviour is not finished when it works in the archetype it was born in.

**Do this before every new archetype.** Ride maps are next, and without
this they will repeat the mistake a fourth time.

## The archetypes

| | HOLDOUT | TRAVERSE | RIDE |
|---|---|---|---|
| Shape | a small base in a big open field | a route from corner to corner | a vehicle carrying you along a path |
| Objective | survive waves, then board the lift | reach the exit plate | survive the journey |
| Light | daylight, always | dark, always | *(not built)* |
| Squad may leave the start | no, the wall is the boundary | yes, that is the point | *(not built)* |
| Pressure comes from | a clock | your own advance | *(not built)* |
| Example | L1 THE FIELD | L2 THE UNDERWORKS | *(none yet)* |

## The checklist

| # | Behaviour | Holdout | Traverse | Verified by |
|---|---|---|---|---|
| 1 | Enemies move at all | yes | yes | `traverseprobe`, `_diag` |
| 2 | Enemies aggro and bite players | yes | yes | `holdoutprobe`, `traverseprobe` |
| 3 | Enemies attack the base | yes | n/a, no base | `holdoutprobe` |
| 4 | Enemies come from visible sources | sight blockers at three ring distances | recesses cut into the walls | both probes |
| 5 | No enemy spawns on top of a player | yes, 6 m safe radius | yes, same code | shared |
| 6 | Arrival point cleared before placement | yes | yes | shared |
| 7 | Enemies path around hazards | around cover | around the chasm | `traverseprobe` |
| 8 | Every spawn has a route to the squad | build-time check | build-time check, doors treated as open | `levelkit` |
| 9 | Starting supplies on the floor | yes, each day | yes, on arrival | see note A |
| 10 | Kill drops are collectable | inside the base, or a field crate for the drone | anywhere: the whole room is walkable | see note B |
| 11 | Pickup prompt and confirmation | yes | yes | `interactprobe` |
| 12 | The objective is stated in words | yes | yes | `vrprobe` |
| 13 | The objective is actionable in world | repair: highlight, prompt, hold | door: same three | `interactprobe` |
| 14 | Downed and revive | yes | yes, same code | `vrprobe` |
| 15 | Level completion | board the lift after N waves | stand on the exit plate | both probes |
| 16 | The shop, on completion | yes | yes, same ride phase | `smoke` |
| 17 | Audio: ambience | day | dark | shared, driven by `lighting.dark` |
| 18 | Audio: base under attack | yes, three tiers | n/a, no base | `holdoutprobe` |
| 19 | The wave director | runs | **must not run** | see note C |
| 20 | The drone | enabled, and load-bearing | disabled, and the UI says why | `droneprobe` |
| 21 | The tactical map frames the level | yes | yes, `mapExtent` | shared |
| 22 | Player movement | one controller | one controller | `gymprobe` |
| 23 | Falling has a floor and a consequence | field is flat | the chasm | `traverseprobe` |

## Notes on what was actually broken

These are the parity failures found by walking this list, all fixed in
v0.17.1. Each is the same shape: something written for the holdout that a
traverse silently inherited or silently missed.

**A. A route level got no supplies at all.** Loot is handed out by
`_enterDay`, and a route level has no day. You started a traverse with
whatever you walked in with and found nothing on the floor. `_enterRoute`
now hands out the same supplies.

**B. Loot on a traverse became uncollectable.** A drop outside the
"reachable" area becomes a FIELD CRATE, which only a drone can fetch, and
the drone cannot fly underground. But "reachable" was answered from
`baseCentre` and `playableHalf`, which a traverse also sets, so a kill in
a corner of the room dropped a crate that no one could ever collect and
nothing explained why. Only a level that CONFINES the squad has
unreachable ground, and only a holdout does. There is a `level.confined`
flag now, and it is what the question asks.

**C. A traverse ran the wave director.** It is a route from A to B where
you clear what stands in the way, not a siege you survive. Fixed in
v0.17.0.

**D. Enemies never moved on a traverse at all.** `_stepZombies` ran only
in the `night` and `elevator` phases. The route phase was never added, and
daylight raiders on holdouts had been frozen for the same reason since the
day trickle was introduced. Fixed in v0.16.1, and the phase list is now an
allow-list of phases in which the world is RUNNING, because a list of
combat phases is a list that gets forgotten.

## When adding an archetype

1. Build it.
2. Walk this table row by row and answer for the new archetype. "It
   inherits that" is not an answer until you have checked what it
   inherits: three of the four bugs above were things a traverse
   inherited from a holdout and should not have.
3. Add a column, and probe assertions where they are cheap.
4. Only then is the archetype done.
