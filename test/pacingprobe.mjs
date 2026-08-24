// Measures dead air: how long the player has nothing to shoot at.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('PACING');
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=9`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
const t0 = Date.now();
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
// How long until the first zombie exists?
const sawOne = await page.waitForFunction(() => window.__zhr.zombies().length > 0, null, { timeout: 30000 })
  .then(() => true).catch(() => false);
const firstAt = (Date.now() - t0) / 1000;
// Ola's spawn plan: "wave 1 starts from the near ring so the level opens
// fast." A minute of walking around an empty field before anything
// happens is the difference between a game and a screensaver.
P.check(sawOne && firstAt < 25, 'something to shoot at turns up promptly',
  `first zombie after ${firstAt.toFixed(1)} s, limit 25`);
// Sample for 60 s: how much of it had zero zombies alive?
let empty = 0, samples = 0;
const phases = new Set();
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({ n: window.__zhr.zombies().length, ph: window.__zhr.wave()?.ph }));
  samples++; if (st.n === 0) empty++;
  phases.add(st.ph);
  await page.waitForTimeout(1000);
}
P.note(`dead air: ${empty}/${samples} sampled seconds with nothing alive`);
P.note(`phases seen: ${[...phases].join(', ')}`);
// Dead air is the thing this probe exists to measure, and it measured it
// into a log line nobody read. Some quiet is the day phase doing its job
// (shop, repair, breathe); most of a minute of it is the level failing to
// produce a game.
P.check(empty / samples < 0.6, 'the level is not mostly empty',
  `${empty}/${samples} sampled seconds with nothing alive, limit 60%`);
P.check(phases.size > 1, 'the phase machine is actually moving',
  [...phases].join(', '));
await browser.close(); server.close();
P.finish();
