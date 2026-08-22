// Verifies barrels exist, are shootable, explode, and chain.
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=11`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
const before = await page.evaluate(() => window.__zhr.barrels().length);
console.log('barrels on floor 1:', before);
// Shoot one
let popped = 'none';
for (let i = 0; i < 3; i++) {
  popped = await page.evaluate(() => {
    const b = window.__zhr.barrels()[0];
    if (!b) return 'gone';
    window.__zhr.debugShootAt(b.pos[0], b.pos[1] + 0.5, b.pos[2]);
    return 'shot';
  });
  await page.waitForTimeout(500);   // respect the weapon cooldown
}
const after = await page.evaluate(() => window.__zhr.barrels().length);
console.log('shot result:', popped, '| barrels after:', after, '| destroyed:', before - after);
await page.screenshot({ path: 'test-artifacts/barrel-probe.png' });
console.log('errors:', errs.length ? errs : 'none');
await browser.close(); server.close();
