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

// ---- 2a2. The wrist display is on the ARM, not under the hand ----
// Ola, twice: "det sitter på handens undersida, upp och ner." Then:
// "om du kan lista ut var fan pistolen pekar och vad som är upp och ner
// på den lär du ju fan kunna lista ut var displayen ska sitta."
//
// So this checks the display against the WEAPON's frame, which is the one
// known to be right, instead of against numbers I typed. In grip space
// the barrel is -Z and the top of the gun is +Y. A watch therefore sits
// at +Z (toward the elbow) and +Y (on top of the arm), with its face
// pointing +Y. Both previous versions had both signs wrong.
{
  // POSE THE CONTROLLERS FIRST. Headless controllers sit at identity, so
  // the grip pose and the target-ray pose coincide and the ~47 degrees
  // that separate them on real Touch hardware simply is not there. The
  // first version of this check measured the display in a world where
  // the bug it exists to catch cannot occur, and passed whichever frame
  // the display was mounted on. debugVRAim fabricates the real tilt.
  await page.evaluate(() => window.__zhr.debugVRAim(45));
  const f = await page.evaluate(() => window.__zhr.debugWristFrame());
  check(!!f, 'there is a wrist display to measure', JSON.stringify(f));
  // THE SKETCH IS THE SPEC (docs/sketches/wrist-side.jpg): the display
  // sits along the arm on the BACK-OF-HAND side, "handryggens sida -
  // ovansidan av armen". Two previous versions asserted "on top", which
  // was a correct derivation from the wrong premise: the back of the
  // hand faces OUTWARD when you hold a controller, roughly the weapon
  // frame's -X for the left arm, perpendicular to the weapon's up.
  check(f && f.onBackOfHandSide > 0.01,
    'it sits on the BACK-OF-HAND side of the arm, per the sketch',
    f ? `local -x ${f.onBackOfHandSide}` : '');
  check(f && f.towardElbow > 0.05,
    'and back toward the elbow, not out over the hand',
    f ? `local z ${f.towardElbow}` : '');
  check(f && f.agreesWithBackOfHand > 0.5,
    'and its face points out through the back of the hand',
    f ? `dot ${f.agreesWithBackOfHand}, want > 0.5` : '');
  check(f && Math.abs(f.agreesWithGunUp) < 0.5,
    'and NOT up the way the gun points up, which was the old wrong guess',
    f ? `dot with gun-up ${f.agreesWithGunUp}` : '');
  check(f && f.alongBarrel < -0.3,
    'and it is tipped back toward your eyes, not forward down the barrel',
    f ? `dot with the barrel ${f.alongBarrel}` : '');
}

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

  // THE MAP ON A DARK LEVEL, which is where Ola actually judged it:
  // "den kartan är SÅ MÖRK så man ser NÄSTAN [ingenting]". A map lit by
  // the level's own lighting is dark when the level is, so the pass adds
  // its own flat diagram light. Measured where the complaint was made.
  const darkMap = await dark.evaluate(async () => {
    const D = window.__zhr;
    D.debugStrategyOpen(true);
    for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
    return { px: D.debugStrategyPixels(), size: D.debugStrategySize() };
  });
  // 80, not 45. At mean 74 the number passed while the screenshot still
  // showed murk; at 103 it reads as a plan drawing. The threshold is set
  // from looking at the picture, and the picture is saved on every run
  // so a human can keep checking the number's honesty.
  check(darkMap.px && darkMap.px.meanBrightness > 80,
    'the map is READABLE even on a dark underground level',
    darkMap.px ? `mean brightness ${darkMap.px.meanBrightness} of 255` : 'no pixels');
  check(darkMap.size && darkMap.size.wDeg < 40,
    'and it does not fill the whole view',
    darkMap.size ? `${darkMap.size.wDeg} x ${darkMap.size.hDeg} degrees at ${darkMap.size.dist} m` : '');
  // A picture for a person to look at, because "did you even look at it"
  // is a fair question with a bad answer.
  await dark.screenshot({ path: 'test-artifacts/strategy-dark-level.png' });
  await dark.evaluate(() => window.__zhr.debugStrategyOpen(false));

  // ---- NOSE AGAINST A WALL, where walls are actually TALL. ----
  // The panel wants 1.05 m of room. Placed blindly with your face near an
  // underground wall it spawns inside the wall, invisible with depth
  // testing on, while still owning the trigger: "I looked at my watch
  // and now the gun does not fire" with nothing on screen to explain.
  // The distance is clamped to the free space, and under half a metre
  // the panel draws over the wall instead of vanishing.
  //
  // Tested underground on purpose: the first version tried it against
  // floor 1's base wall, which is LOW so you can shoot over it, and the
  // panel at eye height is legitimately visible above it. The trap only
  // exists where walls are taller than your eyes.
  {
    const wall = await dark.evaluate(async () => {
      const D = window.__zhr;
      const b = D.debugPlayBounds();
      const me0 = D.playerPos();
      D.debugTeleport(b.minX + 0.7, me0[2]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const me = D.playerPos();
      D.debugLook(b.minX - 2, me[2]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      D.debugStrategyOpen(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { size: D.debugStrategySize(), st: D.debugStrategy(),
        wallDist: +(me[0] - b.minX).toFixed(2) };
    });
    check(wall.size && wall.size.dist < 1.0,
      'facing an underground wall, the panel does not spawn at full distance inside it',
      wall.size ? `placed at ${wall.size.dist} m, wall about ${wall.wallDist} m away` : '');
    check(wall.st && (wall.st.xray === true
      || (wall.size && wall.size.dist <= wall.wallDist)),
      'and it is either in front of the wall or drawn over it, never invisible',
      JSON.stringify({ xray: wall.st && wall.st.xray, dist: wall.size && wall.size.dist, wallDist: wall.wallDist }));
    await dark.evaluate(() => window.__zhr.debugStrategyOpen(false));
  }
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

  // ---- IS IT BLACK? ----
  // Ola: "den är HELT svart." Inside a WebXR session, render(scene, cam)
  // ignores the camera it is given and draws the session's own view into
  // the session's own framebuffer, so the map pass produced nothing. This
  // reads pixels back off the panel rather than trusting that a draw call
  // was issued.
  const pix = await page.evaluate(async () => {
    const D = window.__zhr;
    D.debugStrategyOpen(true);
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    return D.debugStrategyPixels();
  });
  check(!!pix, 'the panel can be sampled', JSON.stringify(pix));
  check(pix && pix.litFraction > 0.5,
    'the map on the panel is not black',
    pix ? `${(pix.litFraction * 100).toFixed(0)}% of sampled pixels lit` : '');
  check(pix && pix.xrRestored === true,
    'and the pass puts the headset renderer back the way it found it',
    pix ? `xr.enabled ${pix.xrRestored}` : '');
  // AND NOT BLOWN OUT EITHER. This page is floor 1, daylight. Render
  // target passes skip tone mapping, so the diagram light that makes a
  // dark level readable would clip a sunlit one to a whiteboard with
  // dots on it. The light scales with the level's darkness; this is the
  // ceiling that keeps it that way.
  check(pix && pix.meanBrightness < 230,
    'the DAYLIGHT map is not clipped to white',
    pix ? `mean ${pix.meanBrightness}, ceiling 230` : '');
  await page.evaluate(() => window.__zhr.debugStrategyOpen(false));

  // ---- THE WAY OUT. Ola: "den går inte att ta bort igen! Så man måste
  // DÖ för att få bort den!" Nothing in this game may require dying to
  // dismiss, so every face button closes it, and each one is checked.
  // Y is the payload cycler while the panel is open, and the panel says
  // so on itself, so it is checked separately below. Every OTHER face
  // button closes.
  for (const [hand, btn, name] of [['right', 4, 'A'], ['right', 5, 'B'],
    ['left', 4, 'X']]) {
    const closed = await page.evaluate(async ([h, b]) => {
      const D = window.__zhr;
      D.debugStrategyOpen(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const wasOpen = D.debugStrategy().open;
      D.debugVrFaceButton(h, b);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { wasOpen, nowOpen: D.debugStrategy().open };
    }, [hand, btn]);
    check(closed.wasOpen === true, `${name}: the panel was open to close`);
    check(closed.nowOpen === false, `${name} closes the strategy panel`);
  }

  // Y is the one button that does something else, and it must do that
  // something rather than nothing: a button advertised on the panel that
  // does not work is how you end up mashing everything.
  const cycled = await page.evaluate(async () => {
    const D = window.__zhr;
    D.debugStrategyOpen(true);
    await new Promise((r) => requestAnimationFrame(r));
    D.debugStrategyPointAt(0.5, 0.5);
    const before = D.debugStrategy().label;
    D.debugVrFaceButton('left', 5);
    await new Promise((r) => requestAnimationFrame(r));
    D.debugStrategyPointAt(0.5, 0.5);
    return { before, after: D.debugStrategy().label, open: D.debugStrategy().open };
  });
  check(cycled.open === true, 'Y leaves the panel open, as the panel says');
  check(cycled.before !== cycled.after, 'and cycles the drone payload',
    `${cycled.before} -> ${cycled.after}`);

  // Looking away must close it too, since that is how it opens.
  const lookedAway = await page.evaluate(async () => {
    const D = window.__zhr;
    D.debugStrategyOpen(true);
    await new Promise((r) => requestAnimationFrame(r));
    const before = D.debugStrategy().open;
    D.debugLookAway();
    for (let i = 0; i < 90; i++) await new Promise((r) => requestAnimationFrame(r));
    return { before, after: D.debugStrategy().open };
  });
  check(lookedAway.before && !lookedAway.after,
    'and turning away from it folds it', JSON.stringify(lookedAway));

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
    'holding at the hip stows the weapon, and it is visibly on the hip',
    JSON.stringify(h.after));
  check(h.fired && h.fired.armed === false,
    'a stowed weapon does not fire');
  check(h.drawn.stowed === false && h.drawn.onHip === false,
    'holding there again draws it back', JSON.stringify(h.drawn));
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

// ---- 2f. Akimbo is one gun per hand, not two ----
// Ola: "köper man 2 pistoler i VR så får man två i varje hand!" The
// akimbo MESH is two pistols side by side, because a flat viewmodel has
// to show both in one object. Handing that to each hand is four guns.
{
  const akimbo = await page.evaluate(() => {
    const D = window.__zhr;
    D.debugGrant('akimbo');
    D.debugSwitch('akimbo');
    D.debugRedressHands();
    return { hands: D.debugHands(), barrels: D.debugBarrelCount() };
  });
  check(akimbo.hands.filter((h) => h && h !== 'light').length === 2,
    'akimbo arms both hands', JSON.stringify(akimbo.hands));
  check(akimbo.barrels === 2,
    'with exactly two guns in total, not four',
    `${akimbo.barrels} pistols on the controllers`);
  await page.evaluate(() => { window.__zhr.debugSwitch('pistol'); window.__zhr.debugRedressHands(); });
}

// ---- 2g. The holster is where a hip is ----
// It used to be pinned near the RIG ORIGIN, and in roomscale the player
// walks away from that: the camera moves, the rig does not. So it sat
// wherever the level started, often metres behind, and reaching for your
// own hip found nothing. Ola: "det går inte att sätta fast någon pistol i
// hölster."
{
  const at = await page.evaluate(() => window.__zhr.debugHolsterPlace());
  check(!!at, 'the holster can be located', JSON.stringify(at));
  check(at && at.horizontal < 0.4,
    'it is beside your body, not across the room',
    at ? `${at.horizontal} m from the head, horizontally` : '');
  // WHICH SIDE. A holster on the left hip is exactly the same DISTANCE
  // away as one on the right, so the scalar check above passed while the
  // thing sat behind the player's left side, out of reach of the hand
  // that uses it. A 180-degree yaw error is invisible to a magnitude.
  check(at && at.right > 0.12,
    'and on your RIGHT, where the gun hand is',
    at ? `${at.right} m to the right (negative is the wrong hip)` : '');
  check(at && Math.abs(at.forward) < 0.15,
    'and beside you rather than behind you',
    at ? `${at.forward} m forward` : '');
  check(at && at.heightFraction > 0.4 && at.heightFraction < 0.75,
    'and at hip height for whoever is wearing it',
    at ? `${(at.heightFraction * 100).toFixed(0)}% of eye height` : '');

  // And it follows you. This is the actual bug: walk, and check the hip
  // came too.
  const moved = await page.evaluate(async () => {
    const D = window.__zhr;
    const p = D.playerPos();
    D.debugTeleport(p[0] + 6, p[2] + 6);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return D.debugHolsterPlace();
  });
  check(moved && moved.horizontal < 0.4,
    'and it comes with you when you move',
    moved ? `${moved.horizontal} m from the head after walking 8 m` : '');

  // THE GESTURE IT MUST NOT STEAL.
  //
  // The right grip is the reload, and lowering the gun and squeezing is
  // the most natural way anyone does it. The holster check runs first, so
  // a grab radius that reaches a hand hanging by its owner's side turns
  // the reload into "your pistol vanishes", mid-wave. This exact bug was
  // just removed from the LEFT hand and then inherited on the right,
  // because the radius had been widened to compensate for the holster
  // being in the wrong place to begin with.
  //
  // No existing probe could see it: the holster seam teleports the hand
  // ONTO the holster before measuring, so any radius passes.
  // A relaxed arm hangs at hip height, so it is genuinely near the
  // holster and no radius can tell them apart. The distinction is the
  // HOLD: a quick squeeze reloads wherever you are, a held one at the hip
  // stows. This checks the quick squeeze right ON the holster, which is
  // the hardest case for the rule.
  const quick = await page.evaluate(async () => {
    const D = window.__zhr;
    D.debugRefill();
    D.debugFireOnce(true);
    await new Promise((r) => setTimeout(r, 60));
    const h = D.debugHolsterLocal();
    const ammoBefore = D.ammo();
    const r = D.debugSqueezeAt('right', h[0], h[1], h[2], 0.10);
    // A pistol reload is 1.4 s. 900 ms measured the middle of it.
    await new Promise((r2) => setTimeout(r2, 1800));
    return { holsterAt: h, ...r, ammoBefore, ammoAfter: D.ammo() };
  });
  check(quick && quick.atHolster === true,
    'the hand is right on the holster for this test', JSON.stringify(quick.holsterAt));
  check(quick && quick.holstered === false,
    'a QUICK squeeze at the hip does not make your pistol vanish',
    JSON.stringify(quick));
  check(quick && quick.ammoAfter > quick.ammoBefore,
    'it reloads, which is what the right grip has always meant',
    `${quick && quick.ammoBefore} -> ${quick && quick.ammoAfter} rounds`);

  // And holding there stows it.
  const held = await page.evaluate(() => {
    const D = window.__zhr;
    const h = D.debugHolsterLocal();
    return D.debugSqueezeAt('right', h[0], h[1], h[2], 0.5);
  });
  check(held && held.holstered === true,
    'while HOLDING at the hip stows the weapon', JSON.stringify(held));
  const drawn = await page.evaluate(() => {
    const D = window.__zhr;
    const h = D.debugHolsterLocal();
    return D.debugSqueezeAt('right', h[0], h[1], h[2], 0.5);
  });
  check(drawn && drawn.holstered === false, 'and holding again draws it back');
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

// ---- LAST: dying must not trap you behind the map ----
// This is the literal thing Ola had to do to escape the panel, and the
// downed panel appears in the same space, so the map must be gone before
// it arrives. Run last, because it ends the run.
{
  const onDeath = await page.evaluate(async () => {
    const D = window.__zhr;
    D.debugHeal();
    D.debugStrategyOpen(true);
    await new Promise((r) => requestAnimationFrame(r));
    const before = D.debugStrategy().open;
    D.debugHurt(999);
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return { before, after: D.debugStrategy().open, downed: D.debugDown() };
  });
  check(onDeath.before && onDeath.downed && !onDeath.after,
    'going down closes the map instead of burying you behind it',
    JSON.stringify(onDeath));
}

console.log(fails === 0 ? '\nVR PARITY GREEN' : `\nVR PARITY: ${fails} FAILURES`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
