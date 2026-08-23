# Sketching a level: what is cheap and what is expensive

Ola: *"I want to know before I draw, so I can stay on the cheap side by
choice."*

This is the practical answer. It is not about effort in the abstract, it
is about which parts of a sketch turn into a data file and which parts
turn into new code.

---

## The one-line rule

**If your sketch is made of things that already exist, arranged
differently, it is free. If it needs a thing that does not exist, it costs
about an afternoon per thing.**

Everything below is that rule with names attached.

---

## FREE: numbers in a data file

These cost minutes. A new floor made only of these is a data file and
nothing else.

- **Where anything is.** Every position, size, rotation and count is a
  number in the spec. Move the base, widen the field, turn a ridge, make
  the room 20 x 30 instead of 13 x 13.
- **How many of anything.** More cover, fewer rocks, ten spawns instead of
  six.
- **Which existing prop.** The library today:

  | Prop | What it is | The numbers it takes |
  |---|---|---|
  | `road` | flat strip, pure decoration | x, z, width, length, rot |
  | `ridge` | a line of hills, blocks sight and bullets | x, z, len, height, rot, gapAt, gapW |
  | `loneTree` | a dead tree | x, z |
  | `bigRock` | a boulder | x, z |
  | `burntCars` | a small pile of wrecks | x, z |
  | `busWreck` | one big wreck | x, z, rot |
  | `ruinedHouse` | a shell you can hide behind | x, z, rot |
  | `container` | a shipping container | x, z, rot, colour |
  | `crashBarrier` | a guard rail | x, z, len, rot |
  | `pipeMound` | heaped pipes | x, z, rot |
  | `pylons` | a line of pylons into the distance | x, z, dx, dz, count |
  | `skyline` | the city on the horizon | count, radius, jitter, h, w |
  | `scatter` | small rubble, sprinkled | count, around, minR, maxR, size |
  | `platform` | a raised deck with a ramp | x, z, w, d, height, ramp |
  | `railing` | a rail around a drop | x, z, w, d |
  | `cover` | a chest-high block | x, z, w, d, height |
  | `sandbags` | a line of sandbags | x, z, count, step, w, d, height, along |

- **Spawn rings and what each spawn hides behind.** `{ x, z, from: 'ridge' }`.
- **Explosive barrels.** A list of positions.
- **Frame settings.** Base size, wall segments, how many waves, where the
  lift is; or for a traverse: the chasm, the doors, the holes in the
  walls, where the exit plate goes.
- **Lighting and mood.** Day or dark, fog distance, sun and sky colours.
- **Names and the one-line hook** on the arrival card.

**How to tell:** if you can describe the change as "the same things, moved
or resized or recoloured", it is free.

---

## CHEAP: one new prop (about half a day)

A new *object* that sits there and blocks things. About thirty lines plus
a row in the parameter table, and after that it is free forever, for every
level.

Good candidates: a water tower, a wrecked helicopter, a fuel depot, a
market stall row, a collapsed bridge section, a fence line, a bunker
entrance.

**How to tell:** it is furniture. It has a shape and it either blocks
movement or it does not. Nothing about it changes over time, and nothing
about it changes the rules.

---

## EXPENSIVE: a new mechanism (days, and it needs discussion first)

Anything that MOVES, has STATE, or changes how the game is played.

- A thing that opens and closes (the door on floor 2 was this)
- A thing that carries you (the lift, a train, a wagon)
- A thing with health that can be destroyed (the base wall was this)
- A thing you interact with by holding a button
- A hazard that hurts on a timer (fire, gas, electricity)
- Water, or anything you can be in rather than on
- Weather that changes during a level
- A new enemy behaviour, or a new enemy

**How to tell:** if describing it needs the word "when" or "until", it is
a mechanism.

---

## MOST EXPENSIVE: a new archetype (a week, and it is a design decision)

A level whose SHAPE is not "hold a base" or "get from A to B". The ride
level is the one in the plan and it is not built. Each archetype needs its
own frame, its own objective, its own pacing rules, and a walk through
`docs/archetype-parity.md` to find everything it silently inherited that
it should not have.

---

## Practical advice for the sketch itself

**Say the SHAPE, not the coordinates.** "The base is in the north-west, a
long open approach from the south-east, one ridge across the middle with a
gap in it" is enough. Numbers get tuned in the game anyway.

**Say what the player should FEEL at three moments:** when they arrive,
halfway, and at the end. That decides more than the layout does.

**Say where the enemies come from and what hides them.** This is the part
of a sketch that is hardest to invent afterwards and easiest for you to
decide.

**Mark anything that moves.** Circle it and say so. That is the line
between "a data file this afternoon" and "a conversation first".

**Reuse a shape on purpose.** Floor 3 being floor 1 with worse odds is not
laziness, it is how a campaign builds tension. A variant of an existing
sketch is the cheapest good level there is.

---

## Seeing it without playing it

- `?levelpreview=N` boots straight into a labelled top-down diagram of
  floor N: the base, every spawn ring with its distance, what each one
  hides behind, the exit, the chasm, and a scale bar. Five seconds instead
  of five minutes.
- `?hot=1` watches the data files and rebuilds the level when one changes,
  without restarting the run. Same phase, same scrap, and you keep
  standing where you were standing.
- `?levelpreview=N&hot=1` is the two together: a diagram that redraws
  itself while the file is edited. This is the loop to use when tuning a
  layout.
- A broken file is reported and the last good level keeps standing, so
  editing with the game running is safe.
