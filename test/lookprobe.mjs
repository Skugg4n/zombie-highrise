// Quick look at each level from an overhead-ish angle, to sanity check
// architecture after the rewrite.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('LEVELS');
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
// The names follow the campaign: floor 2 has been the traverse level
// since v0.16.0 and this still called it "basement".
for (const [n, name] of [[1,'holdout'],[2,'traverse'],[3,'holdout'],[5,'trench'],[6,'wagon'],[12,'boss']]) {
  await page.evaluate((lv) => window.__zhr.debugGotoLevel(lv), n);
  await page.waitForTimeout(300);
  // Eye-level look
  await page.screenshot({ path: `test-artifacts/look-${n}-${name}.png` });
  // Overhead via the tactical map
  await page.evaluate(() => window.__zhr.debugMap(true));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-artifacts/map-${n}-${name}.png` });
  await page.evaluate(() => window.__zhr.debugMap(false));
  // Screenshots are for a person to look at. These are the questions a
  // screenshot cannot answer and that nobody was asking: is the floor
  // under your feet, is there anywhere to spawn, and is the level inside
  // its draw budget? Every floor gets checked, including the ones nobody
  // plays through by hand because they are eight floors in.
  const info = await page.evaluate(() => ({
    t: window.__zhr.levelType(),
    c: window.__zhr.renderInfo().calls,
    spawns: window.__zhr.debugSpawnCount(),
    groundUnderMe: window.__zhr.debugHeightAt(...[window.__zhr.myPos()[0], window.__zhr.myPos()[2]]),
    y: window.__zhr.myPos()[1],
  }));
  P.note(`level ${n} ${info.t}: ${info.c} calls, ${info.spawns} spawns`);
  P.check(Number.isFinite(info.groundUnderMe),
    `floor ${n} (${name}): there is ground where you arrive`);
  P.check(info.y > -20, `floor ${n} (${name}): you are not falling out of it`,
    `y ${info.y.toFixed(2)}`);
  P.check(info.spawns > 0, `floor ${n} (${name}): the horde has somewhere to come from`,
    `${info.spawns} spawn points`);
  // The budget in docs/technical-spec.md is 100 draw calls. A level that
  // busts it is a level that will not run on a Quest 2, and finding that
  // out in the headset is the expensive way.
  P.check(info.c <= 100, `floor ${n} (${name}): inside the draw budget`,
    `${info.c} calls, budget 100`);
}
await browser.close(); server.close();
P.finish();
