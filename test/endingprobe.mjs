// Verifies the run has a real ending: jump to the final floor, kill the
// boss, watch the finale play out, and confirm the victory screen.
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=7`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
await page.evaluate(() => window.__zhr.debugGotoFinal());
await page.waitForTimeout(500);
const lvl = await page.evaluate(() => ({ lv: window.__zhr.levelIndex(), type: window.__zhr.levelType(), wave: window.__zhr.wave() }));
console.log('at final floor:', JSON.stringify(lvl));
// Let the boss spawn, then kill everything.
await page.waitForFunction(() => window.__zhr.zombies().some((z) => z.type === 'butcher'), null, { timeout: 20000 })
  .then(() => console.log('butcher spawned: yes'))
  .catch(() => console.log('butcher spawned: NO'));
await page.evaluate(() => window.__zhr.debugKillAll());
await page.waitForFunction(() => window.__zhr.wave()?.ph === 'finale', null, { timeout: 10000 });
console.log('finale phase reached');
await page.screenshot({ path: 'test-artifacts/ending-finale.png' });
await page.waitForFunction(() => window.__zhr.wave()?.ph === 'victory', null, { timeout: 25000 });
console.log('victory phase reached');
await page.waitForTimeout(400);
const winVisible = await page.evaluate(() => !document.getElementById('panel-victory').classList.contains('hidden'));
console.log('victory panel visible:', winVisible);
console.log('victory text:', await page.locator('#win-stats').innerText());
await page.screenshot({ path: 'test-artifacts/ending-victory.png' });
console.log('page errors:', errs.length ? errs : 'none');
await browser.close(); server.close();
