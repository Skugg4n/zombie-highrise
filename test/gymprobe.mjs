// THE MOVEMENT REGRESSION SUITE.
//
// Ola's diagnosis: clipping through a ramp from the side, falling through
// it, walking up its flank, ground sampled at the wrong place, getting
// stuck, staying short after a fall. One missing system, now built, and
// this is what keeps it built.
//
// Every assertion here is an OBSERVABLE OUTCOME: did the player get up the
// ramp, did the wall stop them, did they land, could they always continue.
// None of it checks a variable for its own sake.
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
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
await page.goto(`http://localhost:${server.address().port}/index.html?gym=1`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

let fails = 0;
const check = (ok, label, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
};
const walk = (a, b, c, d, s, sp) =>
  page.evaluate(([p0, p1, p2, p3, p4, p5]) => window.__zhr.debugWalk(p0, p1, p2, p3, p4, p5),
    [a, b, c, d, s, sp]);

console.log('THE GYM');

// ---- 1. Ramps ----
console.log(' ramps');
// Started from the open floor BEYOND each ramp's foot, and judged on the
// height actually reached, since every ramp tops out at 2.0 m.
let r = await walk(-17, 7, -17, -3, 4.0);
check(r.peakY > 1.8, 'a 15 degree ramp is walkable from the bottom',
  `reached y ${r.peakY} of 2.0`);
r = await walk(-13, 5, -13, -3, 4.0);
check(r.peakY > 1.8, 'a 30 degree ramp is walkable from the bottom',
  `reached y ${r.peakY} of 2.0`);
r = await walk(-9, 4, -9, -3, 4.0);
check(r.peakY < 0.7, 'a 50 degree ramp is NOT walkable: it is a wall',
  `reached only y ${r.peakY}`);

// THE BUG THAT STARTED THIS. Walking at a ramp from its high flank used to
// put the player inside it.
r = await walk(-20, -1, -13, -1, 3.0);
check(r.peakClimb < 0.6 && r.blockedFrames > 0,
  'a ramp cannot be entered from the side: you are stopped, not absorbed',
  `reached ${r.peakClimb} m, blocked on ${r.blockedFrames} frames`);

// ---- 2. Stairs ----
console.log(' stairs');
r = await walk(-4.5, 4, -4.5, -3.0, 3.5);
check(r.peakClimb > 1.6, 'stairs at the step-up limit are climbable to the top',
  `reached ${r.peakClimb} of 1.76 m`);

// ---- 3. The thin wall ----
console.log(' the thin wall');
r = await walk(0, 3, 0, -3, 2.5, 8.0);   // fast, to try to tunnel it
check(r.to[2] > -0.4, 'a 6 cm wall stops you even at 8 m/s: no tunnelling',
  `ended at z ${r.to[2]}`);
check(r.blockedFrames > 0, 'and it registers as a wall, not as nothing');

// ---- 4. The pit ----
console.log(' the pit');
r = await walk(5.5, 4.5, 5.5, 0, 3.5);
check(r.lowestY < -1.5, 'walking into the pit is a real fall',
  `lowest y ${r.lowestY}`);
check(!r.outOfWorld, 'and it is a pit, not the end of the world');
check(r.grounded, 'and you land at the bottom of it');
// Out of the shallow end.
r = await walk(5.5, -1.7, 5.5, 3.5, 4.0);
check(r.to[1] > -0.3, 'the climbable end gets you back out of the pit',
  `ended at y ${r.to[1]}, having started at ${r.from[1]}`);

// ---- 5. The ledge ----
console.log(' the ledge');
r = await walk(11, -2, 11, -6, 3.0);
check(r.landedAt > 2, 'walking off the ledge is a fall with a landing',
  `impact ${r.landedAt} m/s`);
check(r.grounded, 'and you end up on your feet');

// ---- 6. The narrow gap ----
console.log(' the narrow gap');
r = await walk(16, 4, 16, -4, 3.0);
check(r.to[2] < -1.5, 'a narrow gap can be walked all the way through',
  `ended at z ${r.to[2]}, gap is at z 0`);
check(r.recoveredFrames === 0, 'without ever getting wedged');

// ---- 7. The moving platform ----
console.log(' the moving platform');
r = await walk(-13, 14, -13, 10, 3.0);
check(r.peakClimb >= 0.35, 'you can step onto the moving platform',
  `reached ${r.peakClimb} m onto a 0.4 m deck`);

// ---- 8. The low ceiling ----
console.log(' the low ceiling');
r = await walk(-4, 14, -4, 10, 3.0);
check(!r.outOfWorld && r.recoveredFrames === 0,
  'the low ceiling does not trap you');

// ---- Height is derived, not stored ----
console.log(' eye height');
const heights = await page.evaluate(async () => {
  const D = window.__zhr;
  const before = (await D.debugWalk(0, 8, 0, 8, 0.2)).eyeHeight;
  await D.debugWalk(11, -2, 11, 5, 2.0);          // fall off the ledge
  const after = (await D.debugWalk(0, 8, 0, 8, 0.3)).eyeHeight;
  return { before, after };
});
check(heights.after === heights.before,
  'eye height is the same after a fall as before it',
  `${heights.before} -> ${heights.after}`);

// ---- Nothing is ever stuck ----
console.log(' recovery');
const stuck = await page.evaluate(async () => {
  const D = window.__zhr;
  // Drop the player inside the thin wall on purpose.
  D.debugTeleport(0, 0);
  const r1 = await D.debugWalk(0, 0, 3, 0, 1.5);
  return r1;
});
check(stuck.travelled > 1.0, 'a player placed inside geometry can walk out of it',
  `travelled ${stuck.travelled} m`);

console.log(fails === 0 ? '\nGYM GREEN' : `\nGYM: ${fails} FAILURES`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
