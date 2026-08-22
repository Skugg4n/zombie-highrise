// Measures pressure: a bot that aims and fires at the nearest zombie,
// reporting how long it survives and how hard each night pushes.
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=21`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
const START_NIGHT = Number(process.argv[2] || 0);
if (START_NIGHT) {
  // Give the bot the kit a player would plausibly have by then.
  await page.evaluate((n) => {
    window.__zhr.debugGrant && window.__zhr.debugGrant(n >= 5 ? 'smg' : 'shotgun');
    window.__zhr.forceNight(n);
  }, START_NIGHT);
}
// Install a simple combat bot in-page: aim at nearest, fire, back off.
// The bot plays like a person: shoot the nearest, and back away from
// anything that gets close (kiting is the core skill of the game).
await page.evaluate(() => {
  window.__bot = setInterval(() => {
    const me = window.__zhr.myPos();
    const z = window.__zhr.zombies();
    if (z.length) window.__zhr.debugShootZombie();
    let nx = 0, nz = 0, near = 0;
    for (const q of z) {
      const dx = me[0] - q.pos[0], dz = me[2] - q.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < 6 && d > 0.01) { nx += dx / d; nz += dz / d; near++; }
    }
    if (near) {
      const len = Math.hypot(nx, nz) || 1;
      window.__zhr.debugMove((nx / len) * 0.55, (nz / len) * 0.55);
    }
  }, 200);
});
const log = [];
for (let i = 0; i < 90; i++) {
  const st = await page.evaluate(() => ({
    hp: window.__zhr.hp(), w: window.__zhr.wave(), n: window.__zhr.zombies().length,
  }));
  log.push(st);
  if (st.w && st.w.ph === 'gameover') break;
  await page.waitForTimeout(1000);
}
const last = log[log.length - 1];
const maxAlive = Math.max(...log.map((l) => l.n));
const minHp = Math.min(...log.map((l) => l.hp));
console.log(`survived ${log.length}s | reached night ${last.w?.n ?? 0} phase ${last.w?.ph}`);
console.log(`peak zombies alive: ${maxAlive} | lowest HP: ${minHp}`);
console.log('errors:', errs.length ? errs.slice(0,2) : 'none');
await browser.close(); server.close();
