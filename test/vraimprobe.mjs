// Foundation bug 3 probe: the VR weapon must point where the shot goes.
// Runs the real VRInput alignment against a deliberately tilted grip pose.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  try {
    const body = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/index.html?solo=1&seed=7`);
await page.waitForFunction(() => window.__zhr && window.__zhr.debugVRAim, null, { timeout: 20000 });

for (const tilt of [45, 60, -30]) {
  const r = await page.evaluate((t) => window.__zhr.debugVRAim(t), tilt);
  if (!r) { console.log(`tilt ${tilt}: no VR rig (grips not created headless)`); continue; }
  const ok = r.offBy < 0.5 && r.shotOffBy < 0.5;
  console.log(`tilt ${tilt}deg -> gun off aim by ${r.offBy.toFixed(2)}deg, `
    + `shot off by ${r.shotOffBy.toFixed(2)}deg (raw grip was ${r.wasOffBy.toFixed(1)}deg off) ${ok ? 'OK' : 'FAIL'}`);
}
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
server.close();
