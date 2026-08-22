# HANDOFF - ZOMBIE HIGH RISE

State as of v0.8.2 (2026-08-23). This run ended on a budget decision, not
on a natural finish line: the account hit its monthly spend limit, so the
last session was spent landing the plane (shipping an ending) rather than
continuing the quality loops. Read this first in the next session.

## What the game is right now

A complete, playable, winnable co-op zombie wave-defense game running from
GitHub Pages at https://skugg4n.github.io/zombie-highrise/ on desktop,
mobile and Quest browsers, with 4-character room codes over PeerJS and no
server of any kind.

A run is **12 floors**. Each floor is 2 nights (wagon and boss floors are
1). Between floors the elevator doubles as the shop. Floor 12 is the
Butcher's arena; killing him triggers the roof extraction and the victory
screen. The run can be won, lost, and replayed.

## What is done

- **Phase 0-3 complete.** Lobby state machine (host/join x flat/VR never
  regresses), host-authoritative netcode with interpolation, three input
  layers (keyboard/mouse, touch, WebXR), six level types plus the boss
  arena, day/night cycle, wave director, elevator shop, tactical map with
  pings/mines/drone, meta progression in localStorage.
- **Ending shipped** (v0.8.0): boss floor, roof finale with helicopter,
  victory screen, fresh-run flow.
- **Content depth** (v0.8.1): seven enemy types (walker, runner, brute,
  spitter, crawler, screamer, butcher), five night modifiers (fog,
  frenzy, blackout, swarm, harvest), surge nights every third night with
  a richer day after, explosive barrels that chain.
- **Arsenal**: pistol, dual pistols, shotgun, SMG, AK, machete, frag /
  smoke / molotov, mines, health packs, night vision, drone.
- **Audio**: 100% procedural WebAudio, no asset downloads at all.
- **Feel systems**: recoil with recovery, muzzle flashes, tracers, shell
  casings, blood puffs and decals, hit markers, flinch/stagger/knockback,
  corpse topple with persistence, screen shake (never in VR), damage
  vignette, downed slump.
- **Performance**: 61 draw calls / 3.8k triangles with 16 zombies alive
  at VR quality. Budgets are ~100 calls and ~250k triangles, so there is
  large headroom. The horde renders as 7 instanced draw calls at any
  count; static level geometry merges to one mesh per material.
- **Tests**: `node test/smoke.mjs` is the always-green gate and is green.
  Also `endingprobe`, `barrelprobe`, `modprobe`, `perfprobe`, `capture`,
  `feelcapture`, `shotprobe`.

## What is NOT done

1. **Never tested on real hardware.** This is the single biggest gap.
   Everything was verified in headless Chromium. Quest 2 frame rate,
   real WebXR controller behavior, iOS Safari touch quirks and
   cross-network P2P are all unverified. TEST-ON-DEVICE.md is the
   checklist; start there.
2. **Visual quality stopped mid-loop.** The harsh critic scored the
   photomode views around 4-5/10 against commercial titles when the loops
   were stopped. Its three standing asks: fill the empty midground in
   exterior shots, a grounding/shadow pass (contact shadows, AO), and a
   hero-asset material pass (the pistol viewmodel is the weakest asset in
   the game and is on screen constantly). QUALITY.md has the full
   round-by-round scoreboards and fix lists.
3. **Feel loop stopped at ~4.5/10.** Same story; the last critic round
   asked for a shared shot-impact contract across all guns, a bigger
   explosion spectacle, and afterimages that survive two sampled frames.
   Several of those landed in v0.7.2-0.7.3 but were never re-scored.
4. **Phase 3.5 leftovers** (all specced in docs/projectplan.md):
   day-phase events (supply drop, generator), weapon tier upgrades and
   armor as late-game scrap sinks, the weapon role audit, and the
   autoplay playtest critic (`?autoplay=1`) that was meant to catch
   boredom.
5. **The 45-minute replayability goal is unproven.** Floors 6-12 differ
   structurally now (modifiers, new enemies, boss), but nobody has
   actually played a full session to check whether it holds.

## What the next session should pick up first

1. **Have Ola run TEST-ON-DEVICE.md** and fix whatever real hardware
   surfaces. Nothing else matters until the game is known to work on a
   Quest and a phone.
2. **Play one full run yourself** (or build the autoplay bot) and fix the
   pacing problems that surface. Boredom is the stated bug bar.
3. **Then** resume the visual loop with the critic's three standing asks,
   in this order: midground content, grounding/shadows, the pistol.

## Known rough edges

- The high-rise facade's lit windows were split into a night-only
  emissive layer; the critic judged the daytime tower "a dead black
  monolith". Worth a look: `MATS.facade` in `src/world/levelgen.js`.
- Photomode 4 (tactical) and 5 (horde) were the weakest views throughout.
- The elevator interior is still thin compared to what the art direction
  promises for the game's signature set piece.
- Client-side scrap and inventory are host-authoritative and sync at
  15 Hz; there is a visible tick of latency in shop feedback on a laggy
  connection.
- `test/` contains several one-off probes written during debugging. They
  are useful, but only `smoke.mjs` is the gate.

## House rules that still apply

Read `CLAUDE.md` and `LESSONS.md` before touching anything. Run
`node test/smoke.mjs` after every change; a red smoke test stops all
other work. Bump the version in `src/config.js` on every change, log it
in `CHANGELOG.md`, and push to `main` (that is the deploy).
