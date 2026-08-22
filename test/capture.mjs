// Critic-loop capture: screenshots ALL photomode views (1-9) at 1920x1080
// and 800x600, and all ?uistate views at phone/laptop/desktop sizes, into
// test-artifacts/critic/<label>/. Usage: node test/capture.mjs <label>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const label = process.argv[2] || 'round';
const OUT = join(ROOT, 'test-artifacts', 'critic', label);
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = resolve(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(ROOT + sep)) throw new Error('traversal');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(`Object.defineProperty(navigator, 'xr', {
  value: { isSessionSupported: async (m) => m === 'immersive-vr',
           requestSession: async () => { throw new Error('no XR'); } },
  configurable: true });`);
const page = await ctx.newPage();

for (const [w, h] of [[1920, 1080], [800, 600]]) {
  await page.setViewportSize({ width: w, height: h });
  for (let n = 1; n <= 9; n++) {
    await page.goto(`${BASE}/?photomode=${n}`);
    await page.waitForFunction(() => !!window.__zhr, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `photo-${n}-${w}x${h}.png`) });
  }
}
for (const [name, w, h] of [['phone', 390, 844], ['laptop', 1280, 720], ['desktop', 1920, 1080]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const state of ['lobby', 'hosting', 'joining', 'connected', 'hud', 'shop', 'gameover', 'victory']) {
    await page.goto(`${BASE}/?uistate=${state}`);
    await page.waitForFunction(() => !!window.__zhr, null, { timeout: 15000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, `ui-${state}-${name}.png`) });
  }
}
await browser.close();
server.close();
console.log('captured to ' + OUT);
