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

// Nothing damaged and nothing to pick up: nothing offered. A prompt that
// is always up is noise. (Loot is cleared too, because a med kit on the
// floor is legitimately something to do and now says so.)
await page.evaluate(() => { window.__zhr.debugRepairAll(); window.__zhr.debugClearItems(); });
await page.waitForTimeout(400);
let s = await page.evaluate(() => window.__zhr.debugInteraction());
check(s && !s.promptVisible, 'no prompt when there is nothing to do',
  s && s.label ? `offered "${s.label}"` : '');

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

// ---- And on a phone, where there is no E key and no grip -------------
// Ola's list: "mobile has no repair control." TouchInput bound seven
// buttons and none of them was the one that repairs the wall or opens a
// door, so on a phone those interactions did not exist and the prompt
// told you to hold a key you do not have. Done on a real touch device
// profile, through the real button, because the whole point is that the
// button is reachable.
{
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const p = await phone.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://localhost:${server.address().port}/index.html?seed=5`);
  await p.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
  await p.click('#btn-solo');
  await p.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

  const before = await p.evaluate(async () => {
    const D = window.__zhr;
    D.debugDamageWall(2, 70);
    const sg = D.debugWallSeg(2);
    D.debugTeleport(sg.x, sg.z + 1.2);
    await new Promise((r) => setTimeout(r, 300));
    const btn = document.getElementById('btn-act');
    return { hp: sg.hp, shown: btn && !btn.classList.contains('hidden'),
      label: btn && btn.textContent,
      prompt: D.debugInteraction() };
  });
  check(before.shown === true, 'a phone gets a HOLD button when there is something to hold');
  check(before.label === 'REPAIR', 'and it says what it will do', before.label);
  check(before.prompt && /BUTTON/.test(before.prompt.label),
    'and the prompt names the button, not a key you do not have',
    before.prompt && before.prompt.label);

  // Press it the way a thumb does.
  await p.dispatchEvent('#btn-act', 'touchstart');
  await p.waitForTimeout(1100);
  await p.dispatchEvent('#btn-act', 'touchend');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => window.__zhr.debugWallSeg(2));
  check(after && after.hp > before.hp,
    `holding it actually repairs the wall (${before.hp} -> ${after && after.hp})`);

  // And it goes away when there is nothing to act on.
  const gone = await p.evaluate(async () => {
    const D = window.__zhr;
    const c = D.baseCentre();
    D.debugTeleport(c[0], c[2]);
    await new Promise((r) => setTimeout(r, 400));
    const btn = document.getElementById('btn-act');
    return btn.classList.contains('hidden');
  });
  check(gone, 'and it hides again when there is nothing to hold');
  await phone.close();
}

console.log(fails === 0 ? '\nHOLD TO ACT GREEN' : `\nHOLD TO ACT: ${fails} FAILURES`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
