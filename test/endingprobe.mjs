// Verifies the run has a real ending: jump to the final floor, kill the
// boss, watch the finale play out, and confirm the victory screen.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('ENDING');
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
const errs = P.errors;
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=7`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
await page.evaluate(() => window.__zhr.debugGotoFinal());
await page.waitForTimeout(500);
const lvl = await page.evaluate(() => ({ lv: window.__zhr.levelIndex(), type: window.__zhr.levelType(), wave: window.__zhr.wave() }));
P.note('at final floor: ' + JSON.stringify(lvl));

// A run that cannot END is not a game, it is a treadmill, and every step
// below is a thing the player has to actually see happen. These were
// waitForFunction calls whose only failure mode was an uncaught timeout,
// which crashes with a stack trace instead of saying which beat is
// missing.
const wait = (fn, ms) => page.waitForFunction(fn, null, { timeout: ms })
  .then(() => true).catch(() => false);

P.check(await wait(() => window.__zhr.zombies().some((z) => z.type === 'butcher'), 20000),
  'the boss turns up on the final floor');
await page.evaluate(() => window.__zhr.debugKillAll());
P.check(await wait(() => window.__zhr.wave()?.ph === 'finale', 10000),
  'killing it starts the finale');
await page.screenshot({ path: 'test-artifacts/ending-finale.png' });
P.check(await wait(() => window.__zhr.wave()?.ph === 'victory', 25000),
  'and the finale plays through to victory');
await page.waitForTimeout(400);
const winVisible = await page.evaluate(() => !document.getElementById('panel-victory').classList.contains('hidden'));
P.check(winVisible, 'the victory screen is actually on screen');
const stats = await page.locator('#win-stats').innerText().catch(() => '');
P.check(stats.trim().length > 0, 'and it tells you what you did', stats.replace(/\n/g, ' | '));
await page.screenshot({ path: 'test-artifacts/ending-victory.png' });

await browser.close(); server.close();
P.finish();
