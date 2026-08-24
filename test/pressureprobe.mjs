// Measures pressure: a bot that aims and fires at the nearest zombie,
// reporting how long it survives and how hard each night pushes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('PRESSURE');
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
    if (z.length && !window.__bot_holdFire) window.__zhr.debugShootZombie();
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
P.note(`survived ${log.length}s | reached night ${last.w?.n ?? 0} phase ${last.w?.ph}`);
P.note(`peak zombies alive: ${maxAlive} | lowest HP: ${minHp}`);

// This bot aims at the nearest zombie and pulls the trigger. It is a
// crude player, and a crude player is exactly the right instrument for
// "is the difficulty in the right place": if a bot cannot survive the
// first minute the game is unfair, and if a bot never drops below full
// health there is no game.
//
// These numbers were printed and read by eye, which is to say checked
// whenever somebody happened to look at the output.
P.check(log.length >= 45, 'a shooting player survives the opening',
  `${log.length} s before game over, want 45+`);
// NOT "did the bot take damage". This bot has perfect aim, perfect
// kiting and an infinite pistol reserve, so it walking away untouched
// says something about the bot, not about the game. Asserting on its
// health was measuring the instrument.
//
// The question this probe can honestly answer is REACHABILITY: on a hard
// night, can the horde close on a player who is moving? That is the
// thing that has actually broken (spawns walled in, nav grid too small,
// enemies frozen because a phase was missing from a list), and a horde
// that cannot reach a moving player is a horde that threatens nobody.
const late = await (async () => {
  // STOP SHOOTING for this measurement. With the bot's perfect aim in the
  // mix, "how close did they get" is really "how fast did it kill them",
  // and the answer swings between 0.7 m and 5.5 m run to run depending on
  // the enemy mix. Killing the trigger leaves the question this probe can
  // answer cleanly: can the horde catch someone who is running away? A
  // runner does 3.6 m/s and the bot backs off at 2.75, so the answer is
  // yes unless navigation is broken.
  await page.evaluate(() => { window.__bot_holdFire = true; });
  await page.evaluate(() => { window.__zhr.debugHeal(); window.__zhr.debugClearNight(); window.__zhr.forceNight(10); });
  let closest = 999, peak = 0;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    // Kept alive on purpose: this is a navigation measurement, and a bot
    // that dies stops running away, which would flatter the result.
    const st = await page.evaluate(() => {
      window.__zhr.debugHeal();
      const me = window.__zhr.myPos();
      const zs = window.__zhr.zombies();
      let d = 999;
      for (const q of zs) d = Math.min(d, Math.hypot(me[0] - q.pos[0], me[2] - q.pos[2]));
      return { d, n: zs.length, hp: window.__zhr.hp() };
    });
    closest = Math.min(closest, st.d);
    peak = Math.max(peak, st.n);
    if (st.hp <= 0) break;
  }
  return { closest, peak };
})();
P.note(`night 10 against a kiting perfect shot: closest approach `
  + `${late.closest.toFixed(1)} m, peak ${late.peak} alive`);
P.check(late.closest < 2.5, 'the horde catches a player who runs away',
  `closest approach ${late.closest.toFixed(1)} m, want under 2.5`);
P.check(maxAlive > 3, 'with a horde worth the name',
  `peak ${maxAlive} alive at once`);
// The alive cap is a Quest 2 budget, not a suggestion.
P.check(maxAlive <= 24, 'and never more than the platform can render',
  `peak ${maxAlive}, cap 24`);
await browser.close(); server.close();
P.finish();
