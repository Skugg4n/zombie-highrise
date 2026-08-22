# QUALITY - scoreboard and open flaws

## Critic loop scoreboard

Visual critic (photomode views, target 9+):
- Round 1 (v0.6.2 art): V1 3, V2 3, V3 3, V4 2, V5 3, V6 2, V7 3, V8 3,
  V9 PASS. UI: hud 7, shop 6, lobby 7. Verdict: programmer art; top
  moves: real sun shadows + AO grounding, kill pure black, posed varied
  zombies.
- Round 2 (v0.7.0): captured, scoring in progress.

Feel critic (feel clips, target 9+):
- Round 1 (v0.7.0): captured, scoring in progress.

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
