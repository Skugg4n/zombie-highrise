# ZOMBIE HIGH RISE - Kickoff package

Co-op zombie wave defense in Three.js for Quest 2/3 (WebXR, room scale or
stationary), mobile and desktop. Multiplayer via 4-character room codes,
no server, GitHub Pages.

## Getting started

1. Create a new empty repo on GitHub (e.g. `zombie-high-rise`).
2. Put the contents of this folder in the repo root and push to `main`.
3. Enable GitHub Pages: Settings, Pages, Deploy from branch, `main`, `/ (root)`.
4. Open a terminal in the repo folder and start `claude` (Claude Code reads
   CLAUDE.md automatically).
5. Paste the contents of KICKOFF-PROMPT.md (everything below the line).
6. Claude Code builds Phase 0 and tells you when it is time to test on real
   devices. Test on a Quest, a phone and a desktop before moving on. This
   matters: polishing before the foundation works burns credits for nothing.

## The files

- KICKOFF-PROMPT.md: the master prompt (sub-agent fan-out, critic loop, photo mode)
- CLAUDE.md: conventions applied to every Claude Code session
- docs/vision.md: the game idea, the elevator trick, the pillars
- docs/technical-spec.md: architecture, PeerJS, WebXR, locomotion modes, budgets
- docs/art-direction.md: "zombies in daylight", palette, the quality bar
- docs/projectplan.md: phases with checkboxes, Phase 0 first
- docs/TODO.md: parked ideas (co-located VR, night travel, train levels, PvP)
- LESSONS.md: pre-seeded with known pitfalls, including the crew's previous
  classics (flipped textures, the lobby that could not both host and enter
  VR, UI elements rendering under each other)
- CHANGELOG.md: version log

## Credits tips

- Claude Code is instructed to never stall waiting for you: it caps critic
  loops per pass, writes scores to QUALITY.md, parks questions in
  OPEN-QUESTIONS.md and keeps working. The only hard stops are phase
  boundaries where real devices must be tested.
- Keep it honest about phase order. If it starts polishing before Phase 0
  is verified on real devices, tell it to stop.
- If something gets stuck: tell it to re-read LESSONS.md and add what it
  learns.
