# QUALITY - scoreboard and open flaws

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
