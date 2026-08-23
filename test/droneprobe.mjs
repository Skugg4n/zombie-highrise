// The drone must be a real tool: it flies OUT to where the squad cannot
// go, it drops what you sent it with, and the effect is visible.
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
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
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
console.log('in flight:', inFlight.drones.map((d) => `${d.k}(${d.ph})`).join(', ') || 'none');
await page.waitForTimeout(9000);
const after = await page.evaluate(() => window.__zhr.debugField());
console.log('traps on the field:', after.traps.map((t) => `${t.k}@${t.x},${t.z}`).join(', ') || 'none');
console.log('mines on the field:', after.mines.length);
console.log('trap meshes rendered:', after.trapMeshes);
console.log('drones still out:', after.drones.length, '(should be 0: they fly home)');
const kinds = new Set(after.traps.map((t) => t.k));
const ok = kinds.has('tar') && kinds.has('spike') && kinds.has('lure') && after.mines.length > 0;
console.log(ok ? 'OK: every payload was delivered' : 'FAIL: a payload never landed');

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
console.log(pull
  ? `lure at ${pull.lure.x},${pull.lure.z}: ${pull.near}/${pull.total} zombies within 12 m of it`
  : 'lure expired or no zombies to measure');
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
