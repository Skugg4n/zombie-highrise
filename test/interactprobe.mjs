// HOLD-TO-ACT PROBE.
//
// Ola: "'OBJECTIVE: REPAIR WALL' tells the player nothing about how. Every
// objective needs an in-world target: highlight the damaged section, show
// a prompt when the player is near it, and a hold-to-act with a visible
// progress ring. If an objective cannot currently be performed in VR, that
// is a bug, not a missing nicety."
//
// So this checks the whole chain, not just that the code exists: walk to a
// damaged section, see the prompt, hold, watch the ring fill, and confirm
// the wall is actually repaired at the end.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  try {
    const b = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/html' });
    res.end(b);
  } catch { res.writeHead(404).end('x'); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

let fails = 0;
const check = (ok, label, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
};

console.log('HOLD TO ACT');

// Nothing damaged: nothing offered. A prompt that is always up is noise.
await page.evaluate(() => window.__zhr.debugRepairAll());
await page.waitForTimeout(300);
let s = await page.evaluate(() => window.__zhr.debugInteraction());
check(s && !s.promptVisible, 'no prompt when there is nothing to do');

// Damage a section, stand at it.
const seg = await page.evaluate(() => {
  window.__zhr.debugDamageWall(2, 60);
  return window.__zhr.debugWallSeg(2);
});
check(seg && seg.hp < seg.maxHp, 'a wall section is damaged',
  seg && `${seg.hp}/${seg.maxHp}`);

// Stand away from it first: the prompt is proximity-gated.
await page.evaluate((sg) => window.__zhr.debugTeleport(sg.x + 6, sg.z + 6), seg);
await page.waitForTimeout(250);
s = await page.evaluate(() => window.__zhr.debugInteraction());
check(s && !s.promptVisible, 'no prompt from across the base');

await page.evaluate((sg) => window.__zhr.debugTeleport(sg.x, sg.z + 1.2), seg);
await page.waitForTimeout(300);
s = await page.evaluate(() => window.__zhr.debugInteraction());
check(s && s.promptVisible, 'the prompt appears when you walk up to it');
check(s && /REPAIR/.test(s.label), 'it says how to do it', s && s.label);
check(s && s.highlightVisible, 'the damaged section is highlighted');
check(s && !s.ringVisible, 'the ring is not filling before you hold');

// Hold, and watch the ring.
await page.evaluate(() => window.__zhr.debugRepairHold(true));
await page.waitForTimeout(300);
const mid = await page.evaluate(() => window.__zhr.debugInteraction());
check(mid && mid.ringVisible, 'the ring fills while you hold');

await page.waitForTimeout(900);
await page.evaluate(() => window.__zhr.debugRepairHold(false));
const after = await page.evaluate(() => window.__zhr.debugWallSeg(2));
check(after && after.hp > seg.hp, 'holding actually repairs the wall',
  `${seg.hp} -> ${after && after.hp}`);

// Releasing early must not repair: a hold you can tap through is a tap.
const seg2 = await page.evaluate(() => {
  window.__zhr.debugRepairAll();
  window.__zhr.debugDamageWall(4, 60);
  return window.__zhr.debugWallSeg(4);
});
await page.evaluate((sg) => window.__zhr.debugTeleport(sg.x, sg.z + 1.2), seg2);
await page.waitForTimeout(250);
await page.evaluate(() => window.__zhr.debugRepairHold(true));
await page.waitForTimeout(200);
await page.evaluate(() => window.__zhr.debugRepairHold(false));
await page.waitForTimeout(400);
const seg2After = await page.evaluate(() => window.__zhr.debugWallSeg(4));
check(seg2After && seg2After.hp === seg2.hp, 'letting go early does not repair',
  `${seg2.hp} -> ${seg2After && seg2After.hp}`);

// And it works the same inside a headset, because it is world-space.
await page.evaluate(() => window.__zhr.debugEnterVR(true));
await page.waitForTimeout(400);
const inVr = await page.evaluate(() => window.__zhr.debugInteraction());
check(inVr && inVr.promptVisible, 'the prompt is there in VR too');
check(inVr && /GRIP/.test(inVr.label), 'and it names the VR control',
  inVr && inVr.label);

console.log(fails === 0 ? '\nHOLD TO ACT GREEN' : `\nHOLD TO ACT: ${fails} FAILURES`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
