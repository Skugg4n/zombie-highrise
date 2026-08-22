// Verifies night modifiers roll and reach the client-visible wave block.
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
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=3`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
const seen = new Set();
for (let n = 3; n <= 14; n++) {
  await page.evaluate((nn) => { window.__zhr.debugClearNight(); window.__zhr.forceNight(nn); }, n);
  await page.waitForTimeout(180);
  const w = await page.evaluate(() => window.__zhr.wave());
  if (w && w.mod) seen.add(w.mod);
}
console.log('modifiers observed across nights 3-14:', [...seen].join(', ') || 'NONE');
// Enemy roster check at a late night
await page.evaluate(() => { window.__zhr.debugClearNight(); window.__zhr.forceNight(9); });
await page.waitForTimeout(3500);
const types = await page.evaluate(() => [...new Set(window.__zhr.zombies().map((z) => z.type))]);
console.log('enemy types spawned on night 9:', types.join(', ') || 'none yet');
console.log('errors:', errs.length ? errs : 'none');
await browser.close(); server.close();
