import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('PERF');
const ROOT = '/Users/olabelin/Projects/zombie-high-rise';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = resolve(join(ROOT, p === '/' ? 'index.html' : p));
    if (!f.startsWith(ROOT + sep)) throw 0;
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => P.errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?q=vr`);   // VR quality tier
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
// Force night 8 (heavy mix) and let the horde fill to the cap
await page.evaluate(() => { window.__zhr.forceNight(12); });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1000);
  const n = await page.evaluate(() => window.__zhr.zombies().length);
  if (n >= 18) break;
}
const res = await page.evaluate(() => ({
  zombies: window.__zhr.zombies().length,
  info: window.__zhr.renderInfo(),
  wave: window.__zhr.wave(),
}));
P.note(JSON.stringify(res));
// The budgets in docs/technical-spec.md are hard requirements with Quest 2
// as the floor, and this printed a JSON blob and exited 0 whatever was in
// it. Measured at the VR quality tier on the boss floor with the horde
// filled, which is the worst frame the game has.
P.check(res.zombies >= 12, 'the horde actually filled up to measure',
  `${res.zombies} alive`);
P.check(res.info.calls <= 100, 'inside the draw call budget',
  `${res.info.calls} calls, budget 100`);
P.check(res.info.triangles <= 250000, 'inside the triangle budget',
  `${res.info.triangles} triangles, budget 250000`);
await browser.close(); server.close();
P.finish();
