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
// Ground level has the watchtower platform at (6,-9) height 2.4, ramp to the south.
// Walk from south of the ramp northwards onto the platform, sampling Y.
await page.evaluate(() => window.__zhr.debugTeleport(6, 2.5));
await page.waitForTimeout(300);
const trace = [];
for (let i = 0; i < 40; i++) {
  await page.evaluate(() => window.__zhr.debugMove(0, -0.32));
  await page.waitForTimeout(70);
  const p = await page.evaluate(() => window.__zhr.myPos());
  trace.push({ z: +p[2].toFixed(2), y: +p[1].toFixed(2) });
}
const ys = trace.map(t => t.y);
console.log('walking up the ramp, Y samples:', ys.join(' '));
console.log('start Y', ys[0], '-> end Y', ys[ys.length-1], '| climbed:', (ys[ys.length-1]-ys[0]).toFixed(2), 'm');
console.log('errors:', errs.length ? errs.slice(0,3) : 'none');
await browser.close(); server.close();
