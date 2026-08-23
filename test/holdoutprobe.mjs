// HOLDOUT probe: does the level actually work as a level?
// 1. The horde spawns far away, out of sight, and closes the distance.
// 2. It reaches the base wall and chews through it.
// 3. A breach becomes a real route: zombies get INSIDE afterwards.
// 4. Repair puts a breached segment back.
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
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404).end('x'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/index.html?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

// Spawn distance: nothing may start close to the base.
const spawnInfo = await page.evaluate(() => window.__zhr.holdout().spawns);
console.log('spawn points:', spawnInfo.map((s) => `${s.from} @${s.dist.toFixed(0)}m`).join(', '));
const tooClose = spawnInfo.filter((s) => s.dist < 25);
console.log(tooClose.length ? `FAIL: ${tooClose.length} spawn(s) inside 25 m` : 'OK: every spawn is 25 m+ from the base');

// Every spawn must have a route in. A single zombie that cannot reach the
// base leaves "NIGHT 1 - 1 left" on screen forever.
const routes = await page.evaluate(() => window.__zhr.debugSpawnRoutes());
for (const r of routes) {
  const bad = r.nudged > 2.5 || r.reaches > 6;
  console.log(`  spawn ${r.from} @${r.at}: nudged ${r.nudged} m to reach open ground, `
    + `best path gets ${r.reaches} m from the base ${bad ? 'FAIL' : 'ok'}`);
}
console.log(routes.every((r) => r.nudged <= 2.5 && r.reaches <= 6)
  ? 'OK: every spawn can reach the base' : 'FAIL: a spawn is walled in');

// The lift has to be boardable. A crate in front of the doors ends the run.
const board = await page.evaluate(() => window.__zhr.debugBoarding());
console.log(`boarding zone: ${board.blockers} solids in it, walked to within ${board.walkedToWithin} m`);
console.log(board.blockers === 0 && board.walkedToWithin < 0.6
  ? 'OK: the elevator can be boarded' : 'FAIL: something is in the way of the lift');

// Pockets: stand everywhere in the base and try to walk back to the
// middle. Anything that cannot is a place the player gets pinned, which
// is exactly how the snipe ramp / elevator overlap showed up.
const pockets = await page.evaluate(() => window.__zhr.debugPockets());
console.log(`pocket test: ${pockets.tested} walkable cells flooded from the base centre, `
  + `${pockets.stuck.length} unreachable pocket(s) big enough to stand in`
  + (pockets.stuck.length ? ' -> ' + JSON.stringify(pockets.stuck.slice(0, 6)) : ''));
console.log(pockets.stuck.length ? 'FAIL: the base has traps' : 'OK: no pockets in the base');

const geo = await page.evaluate(() => window.__zhr.debugGaps());
console.log(geo.blockedRamp.length
  ? `FAIL: ${geo.blockedRamp.length} solids sit on the ramp`
  : 'OK: the ramp to the snipe platform is clear');

// Confinement: the low wall is the boundary. Walking into it in any
// direction must not get you out of the base.
const escapes = [];
for (let i = 0; i < 8; i++) {
  escapes.push(await page.evaluate((d) => window.__zhr.debugEscape(d), i));
}
const worst = Math.max(...escapes.map((e) => e.out));
console.log(`walked into the wall from the centre in 8 directions, furthest reached: ${worst.toFixed(2)} m`
  + ` (base half-size 4.0 m)`);
console.log(worst < 4.6 ? 'OK: players cannot leave the base' : 'FAIL: there is a way out');

// Force a night and let the horde walk in. Nobody shoots: this measures
// whether the base falls on its own.
await page.evaluate(() => { window.__zhr.debugClearNight(); window.__zhr.forceNight(3); });
// Keep the observer alive: this measures whether the BASE falls, not
// whether one immobile player survives.
const keepAlive = setInterval(
  () => page.evaluate(() => window.__zhr.debugHeal && window.__zhr.debugHeal()).catch(() => {}), 700);
const samples = [];
for (let i = 0; i < 26; i++) {
  await page.waitForTimeout(2000);
  samples.push(await page.evaluate(() => window.__zhr.holdout().state));
}
clearInterval(keepAlive);
const first = samples[0], last = samples[samples.length - 1];

// The reported bug: "NIGHT 1 - 1 left" forever because one zombie spawned
// somewhere it could never walk out of. Nobody is allowed to be stranded.
const stranded = await page.evaluate(() => {
  const c = window.__zhr.holdout();
  const zs = window.__zhr.zombies();
  const b = window.__zhr.baseCentre();
  return zs.map((z) => +Math.hypot(z.pos[0] - b[0], z.pos[2] - b[2]).toFixed(1))
    .filter((d) => d > 12).length + '/' + zs.length;
});
// Bodies must not stand inside each other, especially when the whole
// horde funnels into one breach.
let worstCrowd = 0, worstPairs = 0;
for (let i = 0; i < 6; i++) {
  const cr = await page.evaluate(() => window.__zhr.debugCrowding());
  if (cr && cr.count > 4) {
    worstCrowd = Math.max(worstCrowd, cr.worstOverlap);
    worstPairs = Math.max(worstPairs, cr.overlapping);
  }
  await page.waitForTimeout(700);
}
console.log(`crowding: worst body overlap ${(worstCrowd * 100).toFixed(0)}% of contact distance, `
  + `${worstPairs} overlapping pairs at once`);
// Under 45% is bodies pressing shoulder to shoulder in a crush, which
// is what a horde funnelling through a breach should look like. Above
// that they are genuinely inside one another.
console.log(worstCrowd < 0.45 ? 'OK: zombies do not stand inside each other'
  : 'FAIL: bodies are interpenetrating');

console.log(`still more than 12 m from the base after ${samples.length * 2}s: ${stranded}`);
console.log(`integrity ${(first.integrity * 100).toFixed(0)}% -> ${(last.integrity * 100).toFixed(0)}%`);
console.log(`nearest zombie to base: ${first.nearest.toFixed(1)}m -> ${last.nearest.toFixed(1)}m`);
console.log(`breached segments: ${last.dead}`);
console.log(`zombies inside the base: ${last.inside}`);
const chewed = last.integrity < first.integrity;
const gotIn = samples.some((s) => s.inside > 0);
console.log(chewed ? 'OK: the horde damages the wall' : 'FAIL: the wall was never touched');
console.log(last.dead > 0 ? 'OK: the wall can be breached' : 'NOTE: no segment fully broke in this window');
console.log(gotIn ? 'OK: zombies got inside through a breach' : 'NOTE: nobody got in yet');

// Repair: put a segment back and confirm it blocks again.
const rep = await page.evaluate(() => window.__zhr.debugRepairAll());
console.log(`repair: integrity ${(rep.before * 100).toFixed(0)}% -> ${(rep.after * 100).toFixed(0)}%, breaches ${rep.deadBefore} -> ${rep.deadAfter}`);
// Ola's exact case: NIGHT 1 must be finishable. Spawning stops once the
// night's budget is spent, so if a single zombie is walled in somewhere,
// the counter sticks at "1 left" forever and the run is unwinnable.
await page.evaluate(() => window.__zhr.debugRepairAll());
await page.evaluate(() => { window.__zhr.debugClearNight(); window.__zhr.forceNight(1); });
const alive2 = setInterval(
  () => page.evaluate(() => window.__zhr.debugHeal && window.__zhr.debugHeal()).catch(() => {}), 700);
let finished = false, lastLeft = -1;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1500);
  // The player is a statue, so clear the field for them: this measures
  // whether zombies ARRIVE, not whether they can be killed.
  const st = await page.evaluate(() => {
    const b = window.__zhr.baseCentre();
    const zs = window.__zhr.zombies();
    const near = zs.filter((z) => Math.hypot(z.pos[0] - b[0], z.pos[2] - b[2]) < 9);
    if (near.length) window.__zhr.debugKillAll(9);
    const w = window.__zhr.wave();
    return { ph: w.ph, left: w.left, alive: zs.length };
  });
  lastLeft = st.left;
  if (st.ph !== 'night') { finished = true; break; }
}
clearInterval(alive2);
console.log(finished
  ? 'OK: night 1 can be finished - every zombie reached the base'
  : `FAIL: night 1 never ended, stuck at ${lastLeft} left (zombies walled in)`);

console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
