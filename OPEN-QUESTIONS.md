# OPEN-QUESTIONS - decisions made while Ola was away

Decisions taken to keep moving (per the never-stall rule). Each one is
reversible; say the word and I change it.

## 2026-08-22 (Phase 0)

1. **Pinned versions:** Three.js r170 and PeerJS 1.5.4, vendored into
   `vendor/` and served same-origin (no CDN at runtime). Rationale:
   reproducible deploys and no third-party outage can break the game.
2. **Git:** the folder was not a git repository, so I ran `git init`
   (branch `main`) and commit locally. You still need to create the GitHub
   repo, add it as `origin` and push to deploy (README steps 1-3).
3. **Solo practice mode:** added a PRACTICE SOLO button in the lobby. It
   runs the host simulation without networking. Not in the spec, but it
   makes testing (and playing alone) possible; remove it if unwanted.
4. **Snap turn only in stationary mode:** the spec gives stick locomotion
   to stationary VR only, so roomscale currently has no snap turn. If
   roomscale players want snap turn too (common comfort option), it is a
   two-line change.
5. **Player names:** no name entry field yet; players are "Player" (or
   `?name=` in the URL). A name field in the lobby is parked for Phase 1.
6. **Zombie melee:** damage ticks once per second at close range, 10 HP
   per hit; no player death/game-over flow yet (game over screen exists as
   a UI state only). Death/downed logic is Phase 1 (countdown, game over).
7. **Test dependency:** Playwright is a devDependency in package.json
   (node_modules is gitignored). The game itself still has no build step
   and no runtime dependencies beyond the vendored libs.
8. **Entering VR from the lobby starts the game:** the 2D lobby is
   invisible inside the headset, so ENTER VR while hosting/connected now
   also starts playing, and ENTER VR from the bare menu starts solo
   practice. Alternative would be an in-VR menu (Phase 2+ material).
9. **Broker loss mid-game:** treated as non-fatal (current players keep
   playing, new joins blocked, auto-reconnect attempts). Fatal errors only
   before a session is established.
10. **Mines are no longer restricted to prep phases (v0.18.2):** hand
   placement required the day or countdown phase, which meant a mine could
   not be laid on a traverse level at all, because a route has neither. I
   removed the phase gate rather than adding 'route' to it: the
   one-second arming delay already stops a mine being used as a grenade,
   and laying one in the corridor ahead of you is the tactic underground.
   Balance effect: you can now drop a mine mid-fight on a holdout too. If
   that turns out to trivialise a night, the fix is a placement cooldown
   rather than a phase list.
11. **Your own mine hurts you (v0.18.2):** it did not before, while
   barrels always did. Now it does, inside 70% of the blast radius, which
   matches the barrel rule. Roughly 3 to 7 damage at close range, so it
   stings without being a death sentence.
12. **The wrist display's default angle (v0.22.2):** Ola asked for it
   "angled so a natural turn of the forearm brings it to the eyes", which
   describes a watch: the face lies flat on the arm and you turn the whole
   forearm to read it. But flat is 19.5 degrees from straight up, and
   reading that means holding the forearm level in front of you and
   bending your neck down at it, which is a worse movement than the one he
   described. I have defaulted to angle C, which tips the face 60 degrees
   back toward the eyes: you still turn the forearm, just less far. The
   dial reaches A through E in a couple of presses if C is wrong.
13. **Hand tracking is no longer requested (v0.22.2):** it was in
   `optionalFeatures` while nothing in the game supports it. It also
   breaks the wrist mount: with controllers the grip pose and the
   target-ray pose are two fixed frames on one piece of plastic, so the
   arm frame is rigid; with tracked hands the ray comes from a finger and
   the display would swim along the forearm as you point. If hand
   tracking is ever wanted, the arm frame needs locking to the grip plus a
   constant sampled from the controllers.
14. **Holstering is a HOLD (v0.22.2):** a quick squeeze at the hip
   reloads, holding for a third of a second stows or draws. Proximity
   alone cannot work: a holster sits at the hip and a relaxed arm hangs at
   the hip, about 18 cm apart, so any radius large enough to find by feel
   also catches the reload. The hold is the same vocabulary the wall
   repair and the door already use.
