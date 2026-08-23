// Verifies the horde can actually navigate: do they close distance on a
// player behind geometry, and does anyone freeze?
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
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=4`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });

for (const [lvl, name] of [[1,'ground'],[2,'basement'],[3,'upper']]) {
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
  let closed = 0, frozen = 0, tracked = 0, gone = 0;
  for (const z of second) {
    const a = byId.get(z.id);
    if (!a) continue;
    tracked++;
    const moved = Math.hypot(z.p[0]-a.p[0], z.p[2]-a.p[2]);
    if (moved < 0.5) frozen++;
    if (z.d < a.d - 1.0) closed++;
  }
  gone = first.length - tracked;
  const ph = await page.evaluate(() => window.__zhr.wave()?.ph);
  console.log(`${name}: [phase ${ph}] tracked ${tracked} | closed distance ${closed} | frozen ${frozen} | despawned/killed ${gone}`);
}
console.log('errors:', errs.length ? errs.slice(0,2) : 'none');
await browser.close(); server.close();
