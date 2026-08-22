import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
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
await page.goto(`http://127.0.0.1:${server.address().port}/?q=vr`);   // VR quality tier
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
// Force night 8 (heavy mix) and let the horde fill to the cap
await page.evaluate(() => { window.__zhr.forceNight(9); });
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
console.log(JSON.stringify(res));
await browser.close(); server.close();
