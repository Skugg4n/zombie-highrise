// Verifies night modifiers roll and reach the client-visible wave block.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('MODIFIERS');
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=3`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
const seen = new Set();
for (let n = 3; n <= 14; n++) {
  await page.evaluate((nn) => { window.__zhr.debugClearNight(); window.__zhr.forceNight(nn); }, n);
  await page.waitForTimeout(180);
  const w = await page.evaluate(() => window.__zhr.wave());
  if (w && w.mod) seen.add(w.mod);
}
// Night modifiers are the thing that makes floor 9 not feel like floor 2.
// If none ever roll, the whole system is dead code and the only evidence
// was a log line saying NONE that exited 0.
P.note(`modifiers observed across nights 3-14: ${[...seen].join(', ') || 'NONE'}`);
P.check(seen.size >= 2, 'night modifiers actually roll',
  `${seen.size} distinct across 12 nights: ${[...seen].join(', ') || 'none'}`);
// Enemy roster check at a late night
// Roll a late night that is NOT swarm, since swarm is all walkers by
// design and would make the roster question meaningless. Skipping on a
// swarm night is honest but means the check runs on a coin flip; trying
// a few nights means it almost always runs.
let lateNight = 9;
for (const n of [9, 10, 11, 13]) {
  await page.evaluate((nn) => { window.__zhr.debugClearNight(); window.__zhr.forceNight(nn); }, n);
  await page.waitForTimeout(300);
  const mod = await page.evaluate(() => window.__zhr.wave()?.mod || null);
  lateNight = n;
  if (mod !== 'swarm') break;
}
await page.waitForTimeout(3500);
const roster = await page.evaluate(() => ({
  types: [...new Set(window.__zhr.zombies().map((z) => z.type))],
  mod: window.__zhr.wave()?.mod || null,
}));
const types = roster.types;
P.note(`enemy types on night ${lateNight}: ${types.join(', ') || 'none yet'} (modifier: ${roster.mod || 'none'})`);
// The depth roster exists so late nights are a different PROBLEM, not a
// bigger number. On night 9 the mix should include something past the
// starting two, or the spitter, crawler and screamer are decoration.
P.check(types.length > 0, `night ${lateNight} spawns anything at all`, types.join(', '));
// SWARM is all walkers ON PURPOSE ("a flood of weaklings"), so on a
// swarm night this question has no meaning and asking it anyway makes
// the probe fail at random. The first version did exactly that.
if (roster.mod === 'swarm') {
  P.note('swarm night: all walkers by design, roster check skipped');
} else {
  P.check(types.some((t) => t !== 'walker' && t !== 'runner'),
    'and it is not still walkers and runners nine nights in the depth roster',
    `${types.join(', ')}, modifier ${roster.mod || 'none'}`);
}
await browser.close(); server.close();
P.finish();
