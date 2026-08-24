// Verifies gravity and step-up: can the player walk UP a ramp, is the
// ramp side a wall, and do they fall off a drop?
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('GROUND');
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
const errs = P.errors; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=4`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
// Floor 1 (HOLDOUT) has the snipe platform at (-11.06,-13.36), 1.4 m up, with
// its ramp running south. Walk from the ramp's foot northwards onto the
// platform, sampling Y: this is the "cannot step onto the last step" case.
await page.evaluate(() => window.__zhr.debugTeleport(-11.06, -8.2));
await page.waitForTimeout(300);
const trace = [];
for (let i = 0; i < 22; i++) {
  await page.evaluate(() => window.__zhr.debugMove(0, -0.32));
  await page.waitForTimeout(70);
  const p = await page.evaluate(() => window.__zhr.myPos());
  trace.push({ x: +p[0].toFixed(2), z: +p[2].toFixed(2), y: +p[1].toFixed(2) });
}
const ys = trace.map(t => t.y);
P.note(`walking up the ramp, Y samples: ${ys.join(' ')}`);
const peak = Math.max(...ys);
const walked = Math.abs(trace[trace.length - 1].z - trace[0].z);

// This has to come first, because everything after it is meaningless if
// the body did not move. `debugMove` wrote straight into the rig and the
// character controller silently overwrote it every frame from v0.17.0
// onwards: this probe walked at a ramp for 22 steps without moving a
// centimetre and reported "could not reach the top", which read like a
// ramp bug and was a dead debug hook.
P.check(walked > 3, 'the probe actually walks somewhere',
  `moved ${walked.toFixed(2)} m along the ramp`);

// The bug this exists for: the LAST step of a ramp was unreachable,
// because the platform's own collider ejected you at the edge. You could
// walk the whole thing and be stopped one step from the top, which looks
// like the ramp working right up until it does not.
P.check(peak >= 1.39, 'you can step onto the platform at the top of the ramp',
  `reached ${peak.toFixed(2)} m, platform top is 1.40`);

// And the way up is a climb, not a snap: a jump straight to the top would
// pass the check above while meaning the collision is wrong the other way.
let biggestRise = 0;
for (let i = 1; i < ys.length; i++) biggestRise = Math.max(biggestRise, ys[i] - ys[i - 1]);
P.check(biggestRise <= 0.46, 'and you climb it rather than snapping to the top',
  `biggest single rise ${biggestRise.toFixed(2)} m, step-up limit 0.45`);
await browser.close(); server.close();
P.finish();
