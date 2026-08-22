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
await page.goto(`http://127.0.0.1:${server.address().port}/?feelclip=1`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
// Freeze right at the first shot: poll ammo until it drops, shoot immediately after
await page.waitForFunction(() => window.__zhr.ammo() < 8, null, { timeout: 8000, polling: 16 });
await page.screenshot({ path: 'test-artifacts/shotprobe.png' });
await browser.close(); server.close();
console.log('probe saved');
