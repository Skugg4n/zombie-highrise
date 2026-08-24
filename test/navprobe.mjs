// Verifies the horde can actually navigate: do they close distance on a
// player behind geometry, and does anyone freeze?
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('NAV');
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

// The names follow the campaign, not the old hand-built level types:
// floor 2 has been the traverse level since v0.16.0 and this still called
// it "basement".
for (const [lvl, name] of [[1, 'floor 1 holdout'], [2, 'floor 2 traverse'], [3, 'floor 3 holdout']]) {
  await page.evaluate((l) => window.__zhr.debugGotoLevel(l), lvl);
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.__zhr.debugClearNight(); window.__zhr.forceNight(6); });
  // Let them spawn and walk for a while. Player does not shoot.
  await page.waitForFunction(() => window.__zhr.zombies().length >= 4, null, { timeout: 20000 }).catch(()=>{});
  // Keep the observer alive so we measure navigation, not survival.
  const keepAlive = setInterval(() => page.evaluate(() => window.__zhr.debugHeal && window.__zhr.debugHeal()).catch(()=>{}), 700);
  const first = await page.evaluate(() => {
    const me = window.__zhr.myPos();
    return window.__zhr.zombies().map((z) => ({
      id: z.id, d: Math.hypot(z.pos[0]-me[0], z.pos[2]-me[2]), p: z.pos.slice(),
    }));
  });
  await page.waitForTimeout(9000);
  clearInterval(keepAlive);
  const second = await page.evaluate(() => {
    const me = window.__zhr.myPos();
    return window.__zhr.zombies().map((z) => ({
      id: z.id, d: Math.hypot(z.pos[0]-me[0], z.pos[2]-me[2]), p: z.pos.slice(),
    }));
  });
  const byId = new Map(first.map((z) => [z.id, z]));
  let closed = 0, stranded = 0, tracked = 0, gone = 0, arrived = 0;
  for (const z of second) {
    const a = byId.get(z.id);
    if (!a) continue;
    tracked++;
    const moved = Math.hypot(z.p[0]-a.p[0], z.p[2]-a.p[2]);
    if (z.d < 2.5) arrived++;
    // STRANDED is not "did not move". A zombie standing still on top of
    // you is biting you, which is the system working. The bug that has
    // actually shipped is "NIGHT 1 - 1 left" forever: something a long
    // way off that is not getting any closer. That is both conditions
    // together, and the first version of this check only had the first
    // one, so it failed the game for zombies that were mid-bite.
    if (moved < 0.5 && z.d > 6) stranded++;
    if (z.d < a.d - 1.0) closed++;
  }
  gone = first.length - tracked;
  const ph = await page.evaluate(() => window.__zhr.wave()?.ph);
  P.note(`${name}: [phase ${ph}] tracked ${tracked} | closed ${closed} | `
    + `arrived ${arrived} | stranded ${stranded} | gone ${gone}`);

  // What a player would notice, in order of how badly it ruins the game:
  //
  //   Nothing arrives            -> the level cannot be finished.
  //   Something stands still     -> "1 left" forever, which has happened.
  //   Nobody gets closer         -> the horde is decoration.
  //
  // These were printed as three numbers and read by eye, which means they
  // were checked exactly as often as somebody happened to look.
  P.check(tracked > 0, `${name}: there is a horde to navigate at all`,
    `${tracked} tracked`);
  P.check(tracked === 0 || closed > 0 || arrived > 0,
    `${name}: the horde reaches you`,
    `${closed} closed, ${arrived} already on top of you`);
  P.check(stranded === 0,
    `${name}: nobody is stranded out of reach`,
    `${stranded} sat still more than 6 m away for 9 s`);
}
await browser.close(); server.close();
P.finish();
