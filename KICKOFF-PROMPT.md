# ZOMBIE HIGH RISE - Master prompt

Copy everything below the line and paste into Claude Code, in the repo root.
Preferably run `claude` inside the repo folder so CLAUDE.md is read
automatically.

---

Read CLAUDE.md, LESSONS.md, docs/vision.md, docs/technical-spec.md,
docs/art-direction.md and docs/projectplan.md before writing any code.
They define the game, the architecture, the art bar and the conventions.
Follow them. When they conflict with your instincts, the docs win.

You are building ZOMBIE HIGH RISE: a co-op zombie wave defense game in
Three.js that runs from GitHub Pages on three platforms simultaneously:
Meta Quest 2/3 browser (WebXR, room scale AND stationary), mobile browsers
(touch), and desktop (mouse and keyboard). Players host a room and friends
join with a 4-character code via PeerJS, usually from different homes.
No custom server, ever. The stack in docs/technical-spec.md is fixed; your
creative freedom is in the game and the code architecture, not the tooling.

It should be utterly perfect: visually beautiful, with every single thing
done at the highest quality the web platform allows on a Quest 2. Textures,
lighting, physics feel, sound, UI, netcode smoothness. Everything.

## Build order (non-negotiable)

Work through docs/projectplan.md phase by phase, checking off items as you
complete them. Phase 0 (the steel thread) must be COMPLETE and smoke-tested
before any visual polish work begins. Polish on a broken foundation is
wasted effort. Do not stop at phase boundaries: real-device testing is
asynchronous, not a gate. Maintain TEST-ON-DEVICE.md with everything that
needs human verification per device; Ola tests while you keep building and
reports breakage as it comes.

## Sub-agent fan-out

Spawn sub-agents and have them tackle domains individually so the game is
utterly perfect. The domains:

1. WORLD: level generator (basement/ground/upper), props, elevator, platforms
2. LIGHTING/ATMOSPHERE: day/night, haze, flashlight, "zombies in daylight"
3. ZOMBIES: models, animation, AI, hit reactions, horde performance
4. WEAPONS/FEEL: the arsenal in docs/vision.md (pistols, shotgun, SMG,
   AK, machete, grenades, smoke/fire, health packs, night vision),
   reload mechanics per platform, recoil, muzzle flash, sound, pickup
5. NETCODE: PeerJS rooms, host-authoritative sync, interpolation, rejoin
6. VR INTERACTION: WebXR session, controllers, roomscale + stationary, comfort
7. INPUT: touch layer, keyboard/mouse layer, tactical map view
8. UI/HUD: lobby state machine, room codes, elevator shop, HUD, English text
9. AUDIO: positional WebAudio, ambience, stingers, gesture unlock
10. PERFORMANCE: 72 fps on Quest 2, draw call and triangle budgets

Run independent domains in parallel where possible. Each domain owns its
files; NETCODE owns the protocol and everyone else conforms to it.

## The harsh critic loop

For every visual domain, loop with a separate critic sub-agent:

1. The builder agent implements or improves the domain.
2. Start a local web server and use Playwright with the bundled Chromium to
   capture screenshots of ALL photomode views (?photomode=1 through 9) at
   1920x1080 and 800x600, and ALL UI states (?uistate=...) at 390x844,
   1280x720 and 1920x1080.
3. Spawn a SEPARATE critic sub-agent that has not seen the code. The critic
   views the screenshots and is a really harsh critic. For world views it
   scores 1 to 10 against docs/art-direction.md and the reference games in
   docs/vision.md (Arizona Sunshine for daylight zombie VR, Left 4 Dead 2
   for co-op horde feel, CoD Zombies for the wave loop, Zero Latency style
   free-roam for the physical mode, classic rail shooters for platform
   sections, Fallout for wasteland tone): would this hold up next to your
   memory of those titles, or is it programmer art? Compare feel, light and
   composition; never copy their assets, names, characters or UI. It must name
   concrete flaws: flat lighting, missing depth layers, unreadable
   silhouettes, dead surfaces, bad composition. For UI states it hunts
   overlapping elements, text under other text, clipped labels, broken
   layouts at phone size, and missing states. For photomode 9 it checks the
   debug texture: ANY mirrored or upside-down text is an automatic fail.
4. Any view below 9: the critic writes a specific fix list, the builder
   fixes, and you loop. Do a blind side-by-side: put the previous
   iteration's screenshot next to the new one and have the critic say which
   is better and why. If the new one is not clearly better, the change was
   noise; revert and try a different approach.
5. Do not stop until the critic is wowed by every view, with the explicit
   caveat that the target is "best-in-class stylized web game on Quest 2
   hardware", not offline AAA rendering.

## Never stall, never wait

You are expected to run long and autonomously. Therefore:

- Cap the critic loop at 6 rounds per domain PER PASS. When the cap is hit,
  write the scores and remaining flaws to QUALITY.md and MOVE ON to the
  next domain. Come back for another pass on a later rotation. Never sit
  idle waiting for me mid-run.
- Collect questions and decisions in an OPEN-QUESTIONS.md instead of
  stopping to ask. Make the most reasonable choice, note it, and continue.
  I will answer when I check in.
- There are NO hard stops. The run is finished only when every
  projectplan item that does not require a human on a device is checked
  off, the critics score 9+ on all photomode views, and the performance
  gate passes. Then write the final TEST-ON-DEVICE.md and summarize.
- Push to main after every completed projectplan item so the latest build
  is always live on GitHub Pages for asynchronous device testing.

## Always-green rules

- After EVERY change, run test/smoke.mjs (Playwright: one host context and
  one client context, create room, join with code, assert state syncs, no
  console errors on either side, and every ?uistate renders with its key
  elements visible and non-overlapping - including that the "Enter VR"
  button exists and is enabled in both hosting and joined states). If it
  fails, fix before anything else.
- The multiplayer join flow is sacred. A beautiful game nobody can join is
  worthless. The lobby matrix {host, join} x {flat, VR} must never regress.
- Performance gate before ending any session: report draw calls and
  triangle counts for the worst photomode scene against the budgets in
  docs/technical-spec.md.
- Bump the visible version number in the UI on every change. Log every
  change in CHANGELOG.md (version, date, time, what, why). Check LESSONS.md
  before debugging anything; add every new solved problem to it. Check off
  completed items in docs/projectplan.md.

## What I will do

I will test on the real devices whenever you reach a phase boundary, and
deploy by pushing to GitHub Pages. Tell me clearly what to check and on
which device.

Start now with Phase 0. /loop until it's utterly perfect. Fan out
sub-agents and ultracode.
