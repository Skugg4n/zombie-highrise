// The drone must be a real tool: it flies OUT to where the squad cannot
// go, it drops what you sent it with, and the effect is visible.
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('DRONE');
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
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = P.errors;
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

const DROPS = [['mine', 6, -18], ['tar', 14, 2], ['spike', -14, 10], ['lure', 4, -30]];
for (const [k, x, z] of DROPS) {
  await page.evaluate(([kk, xx, zz]) => window.__zhr.debugDrone(kk, xx, zz), [k, x, z]);
  await page.waitForTimeout(400);
}
const inFlight = await page.evaluate(() => window.__zhr.debugField());
P.note(`in flight: ${inFlight.drones.map((d) => `${d.k}(${d.ph})`).join(', ') || 'none'}`);
P.check(inFlight.drones.length > 0, 'ordering a drone puts one in the air',
  `${inFlight.drones.length} out`);
await page.waitForTimeout(9000);
const after = await page.evaluate(() => window.__zhr.debugField());
P.note(`traps on the field: ${after.traps.map((t) => `${t.k}@${t.x},${t.z}`).join(', ') || 'none'}`);
const kinds = new Set(after.traps.map((t) => t.k));
for (const k of ['tar', 'spike', 'lure']) {
  P.check(kinds.has(k), `the ${k} payload lands on the field`);
}
P.check(after.mines.length > 0, 'the mine payload lands on the field',
  `${after.mines.length} mines`);
// A trap in the simulation that nobody can see is a trap that does not
// exist as far as the player is concerned: they will walk into their own
// tar patch because nothing marks it.
P.check(after.trapMeshes >= kinds.size,
  'and every trap on the field has something to look at',
  `${after.trapMeshes} meshes for ${kinds.size} kinds`);
P.check(after.drones.length === 0, 'the drone flies home when it is done',
  `${after.drones.length} still out`);

// A lure must actually pull the horde off the base.
await page.evaluate(() => { window.__zhr.debugClearNight(); window.__zhr.forceNight(4); });
await page.waitForTimeout(9000);
// Fresh flare, dropped on the ridge approach once the horde is walking.
await page.evaluate(() => window.__zhr.debugDrone('lure', 2, -26));
await page.waitForTimeout(11000);
const pull = await page.evaluate(() => {
  const f = window.__zhr.debugField();
  const lure = f.traps.find((t) => t.k === 'lure');
  const zs = window.__zhr.zombies();
  if (!lure || !zs.length) return null;
  const near = zs.filter((z) => Math.hypot(z.pos[0] - lure.x, z.pos[2] - lure.z) < 12).length;
  return { lure, total: zs.length, near };
});
P.note(pull
  ? `lure at ${pull.lure.x},${pull.lure.z}: ${pull.near}/${pull.total} zombies within 12 m of it`
  : 'lure expired or no zombies to measure');
// The flare's entire job is deciding WHERE the fight happens. If it does
// not visibly pull part of the horde, it is 14 scrap for a light show,
// and the only evidence either way was a printed fraction.
P.check(!!pull, 'there is a lure and a horde to measure');
P.check(!pull || pull.near > 0, 'the flare pulls part of the horde to it',
  pull ? `${pull.near}/${pull.total} within 12 m` : 'nothing to measure');
await browser.close();
server.close();
P.finish();
