// Measures dead air: how long the player has nothing to shoot at.
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=9`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
const t0 = Date.now();
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
// How long until the first zombie exists?
await page.waitForFunction(() => window.__zhr.zombies().length > 0, null, { timeout: 30000 });
console.log('seconds from START to first zombie:', ((Date.now() - t0) / 1000).toFixed(1));
// Sample for 60 s: how much of it had zero zombies alive?
let empty = 0, samples = 0;
const phases = new Set();
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({ n: window.__zhr.zombies().length, ph: window.__zhr.wave()?.ph }));
  samples++; if (st.n === 0) empty++;
  phases.add(st.ph);
  await page.waitForTimeout(1000);
}
console.log(`dead air: ${empty}/${samples} sampled seconds with nothing alive`);
console.log('phases seen:', [...phases].join(', '));
console.log('errors:', errs.length ? errs.slice(0,2) : 'none');
await browser.close(); server.close();
