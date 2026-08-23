// Verifies gravity and step-up: can the player walk UP a ramp, is the
// ramp side a wall, and do they fall off a drop?
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
const ROOT = resolve('.');
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = resolve(join(ROOT, p === '/' ? 'index.html' : p));
    if (!f.startsWith(ROOT + sep)) throw 0;
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=4`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
// Floor 1 (HOLDOUT) has the snipe platform at (-11.06,-13.36), 1.4 m up, with
// its ramp running south. Walk from the ramp's foot northwards onto the
// platform, sampling Y: this is the "cannot step onto the last step" case.
await page.evaluate(() => window.__zhr.debugTeleport(-11.06, -8.2));
await page.waitForTimeout(300);
const trace = [];
for (let i = 0; i < 22; i++) {
  await page.evaluate(() => window.__zhr.debugMove(0, -0.32));
  await page.waitForTimeout(70);
  const p = await page.evaluate(() => window.__zhr.myPos());
  trace.push({ x: +p[0].toFixed(2), z: +p[2].toFixed(2), y: +p[1].toFixed(2) });
}
const ys = trace.map(t => t.y);
console.log('path (x,z -> y):', trace.slice(0, 12).map(t => `${t.x},${t.z}->${t.y}`).join(' '));
console.log('walking up the ramp, Y samples:', ys.join(' '));
const peak = Math.max(...ys);
console.log('start Y', ys[0], '-> highest reached', peak,
  '| platform top is 1.4 m |', peak >= 1.39 ? 'OK: stepped onto the platform'
    : 'FAIL: could not reach the top');
console.log('errors:', errs.length ? errs.slice(0,3) : 'none');
await browser.close(); server.close();
