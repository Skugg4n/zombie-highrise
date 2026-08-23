// TRAVERSE PROBE (level 2, THE UNDERWORKS).
//
// A route level is only a level if you can actually get from one corner to
// the other, if the horde can actually reach you, and if the hole in the
// floor is a real hazard rather than a dark texture. This checks all
// three, plus the door you have to stop and open.
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
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
await page.goto(`http://localhost:${server.address().port}/index.html?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });
await page.evaluate(() => window.__zhr.debugGotoLevel(2));
await page.waitForTimeout(900);

let fails = 0;
const check = (ok, label, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
};

console.log('THE UNDERWORKS');
let r = await page.evaluate(() => window.__zhr.debugRoute());
check(!!r && r.level === 2, 'floor 2 is the traverse level');
check(!!r && r.phase === 'route', 'it runs its own route phase, not a day/night clock',
  r && r.phase);
check(!!r && r.doors.length === 1 && !r.doors[0].open, 'the door starts closed');

// The whole walkable area must be free of places a player can be pinned.
const pockets = await page.evaluate(() => window.__zhr.debugPockets());
check(pockets && pockets.stuck.length === 0,
  `no pockets in the room (${pockets && pockets.tested} cells flooded)`,
  pockets && pockets.stuck.length ? JSON.stringify(pockets.stuck.slice(0, 4)) : '');

// The door is a hold-to-act target, like everything else.
await page.evaluate((d) => window.__zhr.debugTeleport(d.x, d.z + 0.9), r.doors[0]);
await page.waitForTimeout(300);
let it = await page.evaluate(() => window.__zhr.debugInteraction());
check(it && it.promptVisible && /OPEN/.test(it.label),
  'walking to the button offers the door', it && it.label);
await page.evaluate(() => window.__zhr.debugRepairHold(true));
await page.waitForTimeout(2000);
await page.evaluate(() => window.__zhr.debugRepairHold(false));
r = await page.evaluate(() => window.__zhr.debugRoute());
check(r.doors[0].open, 'holding the button opens it');

// THE CHASM. Walk into it and you fall, and it is a real fall.
const fell = await page.evaluate(async () => {
  const D = window.__zhr;
  D.debugTeleport(0.2, 2.6);        // the middle of the hole
  const start = D.myPos()[1];
  await new Promise((res) => setTimeout(res, 700));
  const mid = D.myPos()[1];
  await new Promise((res) => setTimeout(res, 2600));
  return { start, mid, end: D.myPos(), hp: D.hp() };
});
check(fell.mid < fell.start - 1.0, 'stepping into the chasm is a real fall',
  `y ${fell.start.toFixed(1)} -> ${fell.mid.toFixed(1)}`);
check(fell.hp < 100, 'and it costs you', `hp ${fell.hp}`);
check(fell.end[1] > -5, 'and you are put back on solid ground, not left falling',
  `y ${fell.end[1].toFixed(1)}`);

// The horde must not path into it. They fight for real now, so the
// observer is kept alive: this measures where they WALK, not whether one
// stationary player survives them.
let worstInChasm = 0;
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(1400);
  const st = await page.evaluate(() => {
    window.__zhr.debugHeal();
    return window.__zhr.debugRoute();
  });
  worstInChasm = Math.max(worstInChasm, st.inChasm);
}
check(worstInChasm === 0, 'the horde never walks into the chasm',
  `worst ${worstInChasm} inside it`);

// Advancing is what summons them.
// Measured from a FRESH route: `reached` is a high-water mark, so a
// level already walked end to end can never push again.
await page.evaluate(() => window.__zhr.debugGotoLevel(2));
await page.waitForTimeout(900);
const pushed = await page.evaluate(async () => {
  const D = window.__zhr;
  D.debugHeal();
  const before = D.debugRoute().pushed;
  const e = D.debugRoute().exit;
  D.debugTeleport(e.x, e.z - 2.5);      // most of the way across
  await new Promise((res) => setTimeout(res, 1600));
  return { before, after: D.debugRoute().pushed };
});
check(pushed.after > pushed.before, 'pushing forward brings them',
  `${pushed.before} -> ${pushed.after} pushes`);

// And standing on the exit plate finishes the level.
const done = await page.evaluate(async () => {
  const D = window.__zhr;
  const e = D.debugRoute().exit;
  D.debugKillAll();
  for (let i = 0; i < 40; i++) {
    D.debugKillAll();
    D.debugTeleport(e.x, e.z);
    D.debugHeal();
    await new Promise((res) => setTimeout(res, 100));
    if (D.wave()?.ph !== 'route') break;
  }
  return D.wave()?.ph;
});
check(done && done !== 'route', 'standing on the exit plate completes the level',
  `phase ${done}`);

console.log(fails === 0 ? '\nTHE UNDERWORKS GREEN' : `\nTHE UNDERWORKS: ${fails} FAILURES`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
