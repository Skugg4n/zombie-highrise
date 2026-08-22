// Quick look at each level from an overhead-ish angle, to sanity check
// architecture after the rewrite.
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
for (const [n, name] of [[1,'ground'],[2,'basement'],[3,'upper'],[5,'trench'],[6,'wagon'],[12,'boss']]) {
  await page.evaluate((lv) => window.__zhr.debugGotoLevel(lv), n);
  await page.waitForTimeout(300);
  // Eye-level look
  await page.screenshot({ path: `test-artifacts/look-${n}-${name}.png` });
  // Overhead via the tactical map
  await page.evaluate(() => window.__zhr.debugMap(true));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-artifacts/map-${n}-${name}.png` });
  await page.evaluate(() => window.__zhr.debugMap(false));
  const info = await page.evaluate(() => ({ t: window.__zhr.levelType(), c: window.__zhr.renderInfo().calls }));
  console.log(`level ${n} ${info.t}: ${info.c} calls`);
}
console.log('errors:', errs.length ? errs.slice(0,3) : 'none');
await browser.close(); server.close();
