// Foundation bug 3 probe: the VR weapon must point where the shot goes.
// Runs the real VRInput alignment against a deliberately tilted grip pose.
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('VR AIM');
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
const errors = P.errors;
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/index.html?solo=1&seed=7`);
await page.waitForFunction(() => window.__zhr && window.__zhr.debugVRAim, null, { timeout: 20000 });

// THE 45-DEGREE BUG. Ola, in the headset: the gun pointed one way and the
// bullets went another, because the model rode the GRIP pose and the shot
// ran along the TARGET RAY pose, and those differ by the controller's
// natural tilt. It printed OK or FAIL at the end of a line and exited 0
// either way, so the regression it guards had no guard.
let measured = 0;
for (const tilt of [45, 60, -30]) {
  const r = await page.evaluate((t) => window.__zhr.debugVRAim(t), tilt);
  if (!r) { P.note(`tilt ${tilt}: no VR rig (grips not created headless)`); continue; }
  measured++;
  P.note(`tilt ${tilt}deg: gun off aim ${r.offBy.toFixed(2)}deg, `
    + `shot off ${r.shotOffBy.toFixed(2)}deg (raw grip was ${r.wasOffBy.toFixed(1)}deg off)`);
  // Half a degree is under the width of the front sight at any range you
  // would take the shot at, so this is "you cannot see it", not "it is
  // small".
  P.check(r.offBy < 0.5, `at ${tilt}deg the gun points where you aim`,
    `off by ${r.offBy.toFixed(2)}deg, limit 0.5`);
  P.check(r.shotOffBy < 0.5, `and at ${tilt}deg the bullet goes there too`,
    `off by ${r.shotOffBy.toFixed(2)}deg, limit 0.5`);
}
P.check(measured > 0, 'the VR rig existed to be measured at all',
  `${measured} of 3 tilts measured`);
await browser.close();
server.close();
P.finish();
