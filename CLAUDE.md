# CLAUDE.md - Conventions for ZOMBIE HIGH RISE

Claude Code reads this file automatically. These rules apply every session.

## Documentation

- Read the RELEVANT docs before working: docs/vision.md,
  docs/technical-spec.md, docs/art-direction.md, docs/projectplan.md,
  docs/TODO.md
- Check LESSONS.md BEFORE debugging. Known problems and solutions live there.
- Add every newly solved bug/pitfall to LESSONS.md (symptom, cause, solution).
- Log every change in CHANGELOG.md: version, date, time, what and why.
- Check off completed items in docs/projectplan.md.
- New ideas that pop up: park them in docs/TODO.md, do not build them
  spontaneously.
- Questions for Ola go into OPEN-QUESTIONS.md; make a reasonable choice,
  note it, and keep working. Never stall waiting for input mid-run.

## Code and text

- The version number is shown discreetly in the UI (corner of lobby/HUD).
  Bump it on EVERY change. Format: v0.MINOR.PATCH.
- All game text in English. Code comments in English. Comment complex logic
  (netcode protocol, level generator, VR rig math).
- Never use em-dash in any text, UI, docs or commits.
- No build step, no frameworks beyond Three.js and PeerJS, versions pinned
  via import map in index.html. The stack is fixed by docs/technical-spec.md.

## Working method

- Steel thread first (Phase 0 in the project plan), polish last.
- Run test/smoke.mjs after every change. A red smoke test stops everything
  else. `node test/all.mjs` runs the full probe suite and exits non-zero on
  any failure; `node test/all.mjs nav ramp` runs a subset by name.
- Every new probe assertion must be able to FAIL: break the feature on
  purpose and watch it go red before believing it. See QUALITY.md.
- The performance budgets in docs/technical-spec.md are hard requirements.
  Quest 2 is the floor platform.
- The lobby matrix {host, join} x {flat, VR} must never regress.
- Never stop to wait for real-device tests: maintain TEST-ON-DEVICE.md
  with exact per-device checks, keep building, and let Ola test
  asynchronously against the live Pages build.
- Deploy: git push to main, GitHub Pages serves from the repo root.
