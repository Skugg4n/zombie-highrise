// VR PARITY PROBE.
//
// Ola's rule, v0.13.x: "a feature is NOT done until it is usable in VR.
// Every piece of state a flat player can see must be visible in VR, and
// every action a flat player can take must be performable in VR."
//
// This asserts the parity list. It exists because "downed in VR is a
// softlock" shipped: the downed state, game over and victory were all DOM
// overlays, and DOM does not exist inside a headset, so the player saw
// nothing and could do nothing.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  try {
    const b = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/html' });
    res.end(b);
  } catch { res.writeHead(404).end('x'); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

let fails = 0;
function check(ok, label, detail = '') {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
}

console.log('VR PARITY');
const entered = await page.evaluate(() => window.__zhr.debugEnterVR(true));
check(entered, 'the VR interface can be driven');
await page.waitForTimeout(400);

// ---- 1. State is visible: the wrist carries the whole HUD ----
const wrist = await page.evaluate(() => window.__zhr.debugVrWrist());
check(!!wrist && wrist.attached, 'wrist display is attached to a hand');
check(!!wrist && wrist.key.length > 0, 'wrist display has drawn its content');

// ---- 2. The off hand holds a torch, not a second gun ----
const hands = await page.evaluate(() => window.__zhr.debugHands());
check(hands && hands.includes('light'), 'the off hand carries the flashlight',
  JSON.stringify(hands));
check(hands && hands.filter((h) => h === 'light').length === 1,
  'exactly one hand carries the flashlight');

// ---- 2b. The torch has a switch, and it is not on your face ----
// Ola in the headset: "the flashlight in the hand does not toggle on the
// trigger" and "there is also a headlamp that should not exist yet."
// Both are things you can SEE: whether the beam changes when you squeeze,
// and whether a light is mounted on the camera.
{
  const torch = await page.evaluate(() => {
    const D = window.__zhr;
    // Whichever hand is actually carrying the torch. Grip 0 is the main
    // hand, so a torch in slot 0 means the hands are swapped.
    const which = D.debugHands().indexOf('light') === 0 ? 'right' : 'left';
    const before = D.debugTorch();
    const pull = D.debugVrTrigger(which);
    const after = D.debugTorch();
    const ammoBefore = D.ammo();
    D.debugVrTrigger(which);              // and back again
    return { which, before, after, pull, ammoBefore, ammoAfter: D.ammo(),
      back: D.debugTorch() };
  });
  check(torch.pull && torch.pull.armed === false,
    'the torch hand is not holding a gun');
  check(torch.after.toggle !== torch.before.toggle,
    'pulling the torch hand trigger changes the light',
    JSON.stringify([torch.before, torch.after]));
  check(torch.back.toggle === torch.before.toggle,
    'pulling it again puts the light back');
  check(torch.ammoAfter === torch.ammoBefore,
    'the torch trigger never spends a round',
    `${torch.ammoBefore} -> ${torch.ammoAfter}`);
  check(torch.before.head === false && torch.after.head === false,
    'no headlamp: nothing is shining from the camera in VR',
    JSON.stringify([torch.before.head, torch.after.head]));

  // Floor 1 is daylight, where a lit torch would be absurd, so the switch
  // flipping there proves the wiring and nothing more. The thing a player
  // actually cares about is the beam, and the only place a beam matters
  // is underground. Same trigger, dark level, watch the light itself.
  const dark = await browser.newPage();
  dark.on('pageerror', (e) => errors.push(e.message));
  await dark.goto(`http://localhost:${server.address().port}/index.html?seed=5`);
  await dark.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
  await dark.click('#btn-solo');
  await dark.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });
  // There is no ?level= URL parameter. Asking for one loads floor 1 and
  // says nothing, which is how the first version of this check "passed"
  // a daylight level while claiming to test a dark one.
  await dark.evaluate(() => window.__zhr.debugGotoLevel(2));
  await dark.waitForTimeout(500);
  const isDark = await dark.evaluate(() => window.__zhr.debugTorch().dark);
  check(isDark === true, 'the underground check is actually underground');
  await dark.evaluate(() => window.__zhr.debugEnterVR(true));
  await dark.waitForTimeout(400);
  const beam = await dark.evaluate(async () => {
    const D = window.__zhr;
    // The beam is set once per rendered frame from the toggle, so a read
    // on the line after the trigger is a read of the previous frame.
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const which = D.debugHands().indexOf('light') === 0 ? 'right' : 'left';
    const lit = D.debugTorch();
    D.debugVrTrigger(which);
    await frame();
    const off = D.debugTorch();
    D.debugVrTrigger(which);
    await frame();
    return { lit, off, back: D.debugTorch() };
  });
  check(beam.lit.hand === true,
    'underground the torch is lit when you arrive', JSON.stringify(beam.lit));
  check(beam.off.hand === false,
    'and the trigger can turn it OFF down there', JSON.stringify(beam.off));
  check(beam.back.hand === true, 'and on again');
  check(beam.lit.head === false && beam.off.head === false,
    'still no headlamp on a dark level');
  await dark.close();
}

// ---- 2c. The strategy view: the drone is usable in a headset ----
// Ola: "the wrist is the TRIGGER, not the whole surface... big enough to
// read the map and place a drone target precisely." Before this the drone
// needed a click on a 2D map, so in VR it could not be sent at all. The
// test is the whole errand: unfold the panel, point at a spot, send the
// drone, and check that a drone is in the air heading there.
{
  const s = await page.evaluate(async () => {
    const D = window.__zhr;
    const closed = D.debugStrategy();
    D.debugStrategyOpen(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const open = D.debugStrategy();
    const pointed = D.debugStrategyPointAt(0.5, 0.5);
    const aimed = D.debugStrategy();
    return { closed, open, pointed, aimed, centre: D.debugPanelToWorld(0.5, 0.5) };
  });
  check(s.closed.open === false, 'the panel starts folded');
  check(s.open.open === true, 'glancing at the wrist unfolds the panel');
  check(!!s.pointed, 'the panel can be pointed at', JSON.stringify(s.pointed));
  check(s.aimed.cursor !== null, 'and the cursor lands where you point',
    JSON.stringify(s.aimed.cursor));
  check(s.aimed.label && s.aimed.label.length > 0,
    'and it says what the trigger will do', s.aimed.label);

  // The middle of the panel must be the middle of the level, or every
  // point placed on it lands somewhere else. This is the one bit of maths
  // in the feature and the one that will be silently wrong.
  // Does the panel's coordinate maths agree with the camera's own
  // projection? Checking the CENTRE alone proves nothing: the frustum is
  // symmetric, so the middle maps to the middle whatever the signs are.
  // Off-centre points are where a flipped axis shows up, and a flipped
  // axis means every drone lands on the wrong side of the level with
  // nothing on screen to say so.
  const mapping = await page.evaluate(() => {
    const D = window.__zhr;
    let worst = 0, detail = '';
    for (const [u, v] of [[0.2, 0.3], [0.8, 0.25], [0.35, 0.9], [0.95, 0.55]]) {
      const w = D.debugPanelToWorld(u, v);
      const back = D.debugProjectToPanel(w.x, w.z);
      const err = Math.hypot(back.u - u, back.v - v);
      if (err > worst) { worst = err; detail = `(${u},${v}) -> ${w.x.toFixed(1)},${w.z.toFixed(1)} -> (${back.u.toFixed(3)},${back.v.toFixed(3)})`; }
    }
    return { worst, detail };
  });
  check(mapping.worst < 0.005,
    'a point on the panel is the ground it is drawn over',
    `worst error ${mapping.worst.toFixed(4)} ${mapping.detail}`);

  const centreOk = await page.evaluate((c) => {
    // baseCentre() is [x, y, z], not {x, z}. Reading .x off an array
    // gives undefined and Math.hypot(NaN) is NaN, which is how the first
    // version of this reported "off by NaN" instead of failing loudly.
    const b = window.__zhr.baseCentre ? window.__zhr.baseCentre() : null;
    if (!b) return null;
    return { c, b, off: Math.hypot(c.x - b[0], c.z - b[2]) };
  }, s.centre);
  check(centreOk && centreOk.off < 1.5,
    'the middle of the panel is the middle of the level',
    centreOk ? `off by ${centreOk.off.toFixed(2)} m` : 'no base centre');

  const sent = await page.evaluate(async () => {
    const D = window.__zhr;
    D.debugScrap(200);
    D.debugStrategyPointAt(0.62, 0.42);
    const before = D.debugField().drones.length;
    const ok = D.debugStrategyClick();
    await new Promise((r) => setTimeout(r, 350));
    return { ok, before, after: D.debugField().drones.length,
      st: D.debugStrategy() };
  });
  check(sent.ok === true, 'the trigger sends the drone');
  check(sent.after > sent.before,
    `a drone is actually in the air (${sent.before} -> ${sent.after})`);
  check(sent.st.target !== null, 'and the panel marks where it was sent',
    JSON.stringify(sent.st.target));

  await page.evaluate(() => window.__zhr.debugStrategyOpen(false));
}

// ---- 2d. The holster: a real object you reach for ----
// Ola: "the holster is a real object visible on the hip. Move the hand to
// it and press the hand button to stow or draw."
{
  const h = await page.evaluate(() => {
    const D = window.__zhr;
    const before = D.debugHolster();
    const reach = D.debugReachHolster();
    const after = D.debugHolster();
    const fired = D.debugVrTrigger('right');
    const back = D.debugReachHolster();
    return { before, reach, after, fired, drawn: D.debugHolster(), back };
  });
  check(h.before && h.before.exists && h.before.visible,
    'there is a holster on the hip you can see');
  check(h.before.stowed === false, 'you start with the weapon in hand');
  check(h.reach && h.reach.near === true,
    'the hand can reach it', JSON.stringify(h.reach));
  check(h.after.stowed === true && h.after.onHip === true,
    'squeezing at the hip stows the weapon, and it is visibly on the hip',
    JSON.stringify(h.after));
  check(h.fired && h.fired.armed === false,
    'a stowed weapon does not fire');
  check(h.drawn.stowed === false && h.drawn.onHip === false,
    'squeezing there again draws it back', JSON.stringify(h.drawn));
}

// ---- 2e. The reload READS as a reload ----
// Ola: "the reload animation in VR is a slow quarter turn left and back,
// and it is not readable as a reload." A reload is legible when you see
// the magazine leave and a new one arrive, so that is what this samples:
// the actual position of the actual magazine mesh, all the way through.
{
  const film = await page.evaluate(async () => {
    const D = window.__zhr;
    D.debugRefill();
    D.debugFireOnce(true);
    D.debugReload();
    // A reload is 1.4 s. Sampling 40 frames caught two thirds of it and
    // then complained that the magazine was not back yet.
    const frames = [];
    for (let i = 0; i < 110; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = D.debugReloadPose();
      if (p) frames.push(p);
    }
    return frames;
  });
  const magFrames = film.filter((f) => f.magY !== null);
  check(magFrames.length > 5, `the weapon has a magazine to move (${magFrames.length} frames)`);
  const gone = magFrames.some((f) => f.magIn === false);
  const dropped = Math.max(...magFrames.map((f) => -f.magY), 0);
  const back = magFrames.length && magFrames[magFrames.length - 1].magIn === true
    && Math.abs(magFrames[magFrames.length - 1].magY) < 0.01;
  check(dropped > 0.05, `the magazine visibly leaves the gun (${dropped.toFixed(3)} m)`);
  check(gone, 'there is a beat where the well is empty');
  check(back, 'and a fresh magazine ends up seated',
    JSON.stringify(magFrames[magFrames.length - 1]));
  // Not just a slow turn: the cant must arrive fast and leave fast rather
  // than sweeping across the whole reload. Measured over the ANIMATION,
  // not the sampling window: idle frames after the reload finished were
  // diluting the ratio and making a correct animation look like a slow
  // one.
  const all = film.map((f) => f.roll);
  const first = Math.max(0, all.findIndex((r) => r > 0.001));
  let last = all.length - 1;
  while (last > first && all[last] <= 0.001) last--;
  const rolls = all.slice(first, last + 1);
  const peak = Math.max(...rolls);
  const atPeak = rolls.filter((r) => r > peak * 0.9).length / (rolls.length || 1);
  // A sweep spends its time in transit; this should spend its time held
  // over, with two short sharp moves at the ends.
  check(peak > 0.3 && atPeak > 0.45 && atPeak < 0.9,
    `the gun snaps over and holds rather than sweeping (peak ${peak.toFixed(2)}, held ${(atPeak * 100).toFixed(0)}% of frames)`);
}

// ---- 3. Manual reload works in VR (regression guard) ----
// Point the barrel at the floor and hold: this is the whole gesture, and
// it silently stopped working once before.
const reloaded = await page.evaluate(async () => {
  const D = window.__zhr;
  D.debugRefill();
  D.debugFireOnce(true);                 // spend a round so a reload is real
  const before = D.ammo();
  D.debugVrPointDown(true);
  await new Promise((r) => setTimeout(r, 900));
  const reloading = D.reloading ? D.reloading() : null;
  D.debugVrPointDown(false);
  await new Promise((r) => setTimeout(r, 2200));
  return { before, after: D.ammo(), reloading };
});
check(reloaded.after > reloaded.before,
  'pointing the barrel down reloads the weapon',
  `${reloaded.before} -> ${reloaded.after} rounds`);

// ---- 4. Being downed is legible AND actionable ----
await page.evaluate(() => window.__zhr.debugSetDowned(true));
await page.waitForTimeout(300);
const downPanel = await page.evaluate(() => window.__zhr.debugVrPanel());
check(!!downPanel && downPanel.open && downPanel.visible,
  'a panel appears when you are downed');
check(!!downPanel && /DOWN/.test(downPanel.title),
  'it says what has happened', downPanel && downPanel.title);
check(!!downPanel && downPanel.actions.length > 0,
  'it offers at least one way forward', JSON.stringify(downPanel && downPanel.actions));
await page.evaluate(() => window.__zhr.debugSetDowned(false));

// ---- 5. Game over is legible AND actionable ----
// DIED FOR REAL, not ended with a debug shortcut. Ola reports that A and
// B leave him dead in the headset while this test was green, which means
// the test was reaching game over by a route no player can take.
await page.evaluate(async () => {
  const D = window.__zhr;
  for (let i = 0; i < 40 && D.hp() > 0; i++) {
    D.debugHurt(20);
    await new Promise((r) => setTimeout(r, 60));
  }
});
await page.waitForFunction(() => window.__zhr.wave()?.ph === 'gameover',
  null, { timeout: 12000 }).catch(() => {});
await page.waitForTimeout(600);
const overPanel = await page.evaluate(() => window.__zhr.debugVrPanel());
check(!!overPanel && overPanel.open, 'a panel appears on game over');
check(!!overPanel && /GAME OVER/.test(overPanel.title), 'it says the run is over',
  overPanel && overPanel.title);
const acts = (overPanel && overPanel.actions) || [];
check(acts.some((a) => /AGAIN/i.test(a)), 'you can restart from inside the headset',
  JSON.stringify(acts));
check(acts.some((a) => /QUIT/i.test(a)), 'you can quit from inside the headset');

// The action must leave the player ABLE TO PLAY.
//
// This assertion used to read `after !== 'gameover'` and was green while
// TRY AGAIN left the player lying on the floor, unable to move or shoot,
// with the run effectively over. It measured a phase name instead of a
// player. What follows is what a person would actually check.
const acted = await page.evaluate(async () => {
  const before = window.__zhr.wave()?.ph;
  // Pressed through the GAMEPAD LOOP, the only route a player has. The
  // previous version called the panel handler directly and so proved
  // nothing about whether the button reaches it.
  const consumed = window.__zhr.debugVrButtonA();
  await new Promise((r) => setTimeout(r, 900));
  const play = await window.__zhr.debugCanPlay();
  return { consumed, before, after: window.__zhr.wave()?.ph, play };
});
check(acted.consumed, 'the face button is consumed by the panel');
check(!acted.play.downed, 'after TRY AGAIN the player is no longer downed');
check(acted.play.hp >= 100, 'and has full health', `hp ${acted.play.hp}`);
check(acted.play.canMove, 'and can move');
check(acted.play.canShoot, 'and can shoot',
  `ammo ${acted.play.ammoBefore} -> ${acted.play.ammoAfter}`);
check(acted.after !== 'gameover', 'and the run is running again',
  `${acted.before} -> ${acted.after}`);

// ---- 6. The debug menu, reachable from inside the headset ----
// Ola asked for it so he can reach everything the game has. It is also the
// diagnostic: it prints live state, so a fault in a headset can be read
// out loud instead of guessed at.
const menu = await page.evaluate(async () => {
  const D = window.__zhr;
  const opened = D.debugMenuState().open;
  D.debugVrButtonY();                       // Y opens it
  const afterOpen = D.debugMenuState();
  return { before: opened, after: afterOpen };
});
check(!menu.before && menu.after.open, 'Y opens the debug menu in VR');
check(menu.after.actions > 10, 'and it offers everything the game has',
  `${menu.after.actions} actions`);
check(menu.after.status.length > 3, 'and it prints live state to read out loud',
  JSON.stringify(menu.after.status));

const gave = await page.evaluate(async () => {
  const D = window.__zhr;
  const before = D.weapon();
  D.debugMenuPickLabel('Give SHOTGUN');
  await new Promise((r) => setTimeout(r, 300));
  return { before, after: D.weapon() };
});
check(gave.after !== gave.before, 'and picking an action actually does it',
  `${gave.before} -> ${gave.after}`);

console.log(fails === 0 ? '\nVR PARITY GREEN' : `\nVR PARITY: ${fails} FAILURES`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
