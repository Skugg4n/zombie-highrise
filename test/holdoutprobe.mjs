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

// Pockets: stand everywhere in the base and try to walk back to the
// middle. Anything that cannot is a place the player gets pinned, which
// is exactly how the snipe ramp / elevator overlap showed up.
const pockets = await page.evaluate(() => window.__zhr.debugPockets());
console.log(`pocket test: ${pockets.stuck.length}/${pockets.tested} start points could not walk back to the middle`
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
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
