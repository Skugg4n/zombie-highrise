// EXPLOSIVES: barrels and mines, asserted the way a player experiences
// them. Every check below is something you could see happen on screen:
// a drum disappears, a trap you shot at goes off, a chain runs through a
// row of them, standing in your own blast hurts.
//
// The previous version of this file printed numbers and exited 0 no
// matter what they were, which is not a test.
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
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
function note(ok, what) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

const browser = await chromium.launch();
const errs = [];

async function open(query = '?seed=11') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + query);
  await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
  await page.click('#btn-solo');
  await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
  return page;
}

// Mines arm over one second. Everything here waits it out, because an
// unarmed mine is deliberately inert and testing it before then would be
// testing the arming delay by accident.
const ARM_MS = 1300;

// Placing a mine is an ACTION: it goes to the host and comes back in a
// snapshot, so the thing on the ground appears a frame or two later. A
// probe that reads the count on the next line is measuring network
// latency, not gameplay. Wait for what the player would see.
async function minesOnGround(page, expect, ms = 2000) {
  try {
    await page.waitForFunction(
      (n) => window.__zhr.mines().length === n, expect, { timeout: ms });
  } catch { /* fall through and report what is actually there */ }
  return page.evaluate(() => window.__zhr.mines().length);
}

console.log('BARRELS');
{
  const page = await open();
  const before = await page.evaluate(() => window.__zhr.barrels().length);
  note(before > 0, `floor 1 has explosive barrels to shoot (${before})`);

  const target = await page.evaluate(() => window.__zhr.barrels()[0]);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(([x, y, z]) => window.__zhr.debugShootAt(x, y + 0.5, z), target.pos);
    await page.waitForTimeout(420);
  }
  const gone = await page.evaluate((id) => !window.__zhr.barrels().some((b) => b.id === id), target.id);
  note(gone, 'a barrel you shoot disappears');
  await page.close();
}

console.log('MINES');
{
  const page = await open();
  // A place to work: out in front of the player, on flat ground.
  const spot = await page.evaluate(() => {
    window.__zhr.debugGiveMines(6);
    const p = window.__zhr.debugWalk ? null : null;
    void p;
    return window.__zhr.playerPos ? window.__zhr.playerPos() : null;
  });

  // 1. A mine can be placed at all, and you can see it.
  await page.evaluate((s) => {
    const [px, , pz] = s || [0, 0, 0];
    window.__zhr.debugPlaceMineAt(px + 4, pz);
  }, spot);
  const placed = await minesOnGround(page, 1);
  note(placed === 1, `placing a mine puts one on the ground (${placed})`);
  await page.waitForTimeout(ARM_MS);

  // 2. Shooting it sets it off.
  const mine = await page.evaluate(() => window.__zhr.mines()[0]);
  if (mine) {
    await page.evaluate(([x, y, z]) => window.__zhr.debugShootAt(x, y + 0.14, z), mine.pos);
    await page.waitForTimeout(350);
  }
  const blown = await page.evaluate(() => window.__zhr.mines().length);
  note(!!mine && blown === 0, 'shooting an armed mine detonates it');

  // 3. Mines chain into each other.
  await page.evaluate((s) => {
    const [px, , pz] = s || [0, 0, 0];
    for (let i = 0; i < 3; i++) window.__zhr.debugPlaceMineAt(px + 4 + i * 1.4, pz + 3);
  }, spot);
  const chained = await minesOnGround(page, 3);
  note(chained === 3, `three mines laid in a row (${chained})`);
  await page.waitForTimeout(ARM_MS);
  const first = await page.evaluate(() => window.__zhr.mines()[0]);
  await page.evaluate(([x, y, z]) => window.__zhr.debugShootAt(x, y + 0.14, z), first.pos);
  await page.waitForTimeout(400);
  const leftAfterChain = await page.evaluate(() => window.__zhr.mines().length);
  note(leftAfterChain === 0, `shooting one mine sets off the whole row (${leftAfterChain} left)`);

  // 4. Your own blast hurts you. Laid at your feet, shot from where you
  //    stand: this is the mistake a player makes, so it must have a cost.
  const hurt = await page.evaluate(async (s) => {
    const [px, , pz] = s || [0, 0, 0];
    const hp0 = window.__zhr.debugHealth();
    window.__zhr.debugPlaceMineAt(px + 1.0, pz);
    await new Promise((r) => setTimeout(r, 1600));
    const m = window.__zhr.mines()[0];
    if (!m) return { hp0, hp1: hp0, fired: false };
    window.__zhr.debugShootAt(m.pos[0], m.pos[1] + 0.14, m.pos[2]);
    await new Promise((r) => setTimeout(r, 350));
    return { hp0, hp1: window.__zhr.debugHealth(), fired: true };
  }, spot);
  note(hurt.fired && hurt.hp1 < hurt.hp0,
    `standing in your own mine blast costs health (${hurt.hp0} -> ${hurt.hp1})`);

  // 5. A barrel going off takes the minefield with it.
  const both = await page.evaluate(() => {
    const b = window.__zhr.barrels()[0];
    if (!b) return null;
    window.__zhr.debugPlaceMineAt(b.pos[0] + 1.5, b.pos[2]);
    return b;
  });
  if (both) {
    await page.waitForTimeout(ARM_MS);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(([x, y, z]) => window.__zhr.debugShootAt(x, y + 0.5, z), both.pos);
      await page.waitForTimeout(420);
    }
    const minesLeft = await page.evaluate(() => window.__zhr.mines().length);
    note(minesLeft === 0, `a barrel blast sets off mines beside it (${minesLeft} left)`);
  } else {
    note(false, 'a barrel was available to chain into a mine');
  }
  await page.close();
}

// A mine that cannot be laid underground is an item that does nothing on
// half the campaign, which is exactly what the phase gate used to do.
console.log('MINES UNDERGROUND');
{
  const page = await open('?seed=11');
  // No ?level= parameter exists. The first version of this asked for one,
  // got floor 1, and cheerfully reported that mines work underground.
  await page.evaluate(() => window.__zhr.debugGotoLevel(2));
  await page.waitForTimeout(600);
  const arch = await page.evaluate(() => window.__zhr.debugArchetype());
  note(arch === 'traverse', `this check is on a traverse level (${arch})`);
  await page.evaluate(() => {
    window.__zhr.debugGiveMines(3);
    const p = window.__zhr.playerPos();
    window.__zhr.debugPlaceMineAt(p[0] + 1.5, p[2]);
  });
  const laid = await minesOnGround(page, 1);
  note(laid === 1, `a mine can be laid on a traverse level (${laid})`);
  await page.close();
}

console.log('errors:', errs.length ? errs : 'none');
if (errs.length) failures += errs.length;
await browser.close();
server.close();
console.log(failures ? `\nEXPLOSIVES RED (${failures})` : '\nEXPLOSIVES GREEN');
process.exit(failures ? 1 : 0);
