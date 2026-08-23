// HOT RELOAD probe.
//
// Ola: "changing a number should rebuild the level without restarting the
// run." So this changes a number in a real level data file, on disk,
// while the game is running, and checks that the level on screen changed
// and the run did not.
//
// It edits src/world/levels/L1.js and puts it back afterwards, including
// if it fails partway.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SPEC = join(ROOT, 'src/world/levels/L1.js');
const original = await readFile(SPEC, 'utf8');
const restore = async () => writeFile(SPEC, original);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  try {
    const b = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
    // no-store, or the browser serves the version it already has and the
    // whole feature appears not to work.
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/html', 'Cache-Control': 'no-store' });
    res.end(b);
  } catch { res.writeHead(404).end('x'); }
});
await new Promise((r) => server.listen(0, r));

let fails = 0;
function check(ok, label, detail = '') {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
}

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${server.address().port}/index.html?seed=5&hot=1`);
  await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
  await page.click('#btn-solo');
  await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

  console.log('HOT RELOAD');
  const on = await page.evaluate(() => window.__zhr.debugHot());
  check(on.on === true, 'the watcher is running');
  check(on.watching.includes(1), 'and it is watching the floor we are on',
    JSON.stringify(on.watching));

  // Something a player would SEE: how many colliders the level has, and
  // where the base sits. Take a reading, change the file, take another.
  const before = await page.evaluate(() => {
    const D = window.__zhr;
    D.debugScrap(123);
    return { colliders: D.debugColliderCount(), base: D.baseCentre(),
      scrap: D.debugScrapNow(), phase: D.wave().ph, reloads: D.debugHot().reloads };
  });

  // The edit: one number. A prop moved is the cheapest possible change
  // and the one Ola will make most often.
  // The key is `prop`, not `kind`. Getting this wrong the first time was
  // useful: the spec validator caught it, said which entries were bad by
  // index, and the running level was left standing, which is exactly the
  // behaviour this probe goes on to check on purpose.
  const edited = original.replace(/props:\s*\[/,
    "props: [\n      { prop: 'bigRock', x: 20, z: 20 },\n      { prop: 'bigRock', x: 24, z: 20 },");
  if (edited === original) throw new Error('could not find a props list in L1.js to edit');
  await writeFile(SPEC, edited);

  await page.waitForFunction(
    (n) => window.__zhr.debugHot().reloads > n || window.__zhr.debugHot().error !== '',
    before.reloads, { timeout: 8000 })
    .catch(async () => {
      const d = await page.evaluate(() => window.__zhr.debugHot());
      console.log('  (no reload seen)', JSON.stringify(d));
    });
  const after = await page.evaluate(() => {
    const D = window.__zhr;
    return { colliders: D.debugColliderCount(), base: D.baseCentre(),
      scrap: D.debugScrapNow(), phase: D.wave().ph, err: D.debugHot().error,
      hp: D.debugHealth(), playing: D.state() };
  });

  check(after.err === '', 'the new file imported cleanly', after.err);
  check(after.colliders > before.colliders,
    `the level actually changed (${before.colliders} -> ${after.colliders} colliders)`);
  check(after.playing === 'playing', 'and the run is still running');
  check(after.phase === before.phase, 'in the same phase', `${before.phase} -> ${after.phase}`);
  check(after.scrap === before.scrap, 'with your scrap intact',
    `${before.scrap} -> ${after.scrap}`);
  check(after.hp > 0, 'and you are still alive', `hp ${after.hp}`);

  // A half-typed file is the normal state of a file being edited. It must
  // complain and keep watching, not take the game down.
  await writeFile(SPEC, edited.replace('export const L1 = {', 'export const L1 = { { syntax error'));
  await page.waitForFunction(() => window.__zhr.debugHot().error !== '', null, { timeout: 8000 })
    .catch(() => {});
  const broken = await page.evaluate(() => ({
    err: window.__zhr.debugHot().error, playing: window.__zhr.state(),
    colliders: window.__zhr.debugColliderCount(),
  }));
  check(broken.err !== '', 'a broken file is reported', broken.err.slice(0, 60));
  check(broken.playing === 'playing', 'and does not take the run down with it');
  check(broken.colliders === after.colliders,
    'and the last good level is still standing');

  // And it recovers when the file is fixed.
  await writeFile(SPEC, original);
  await page.waitForFunction(() => window.__zhr.debugHot().error === '', null, { timeout: 8000 })
    .catch(() => {});
  const fixed = await page.evaluate(() => ({
    err: window.__zhr.debugHot().error,
    colliders: window.__zhr.debugColliderCount(),
  }));
  check(fixed.err === '', 'fixing the file clears the error');
  check(fixed.colliders === before.colliders,
    `and puts the level back (${fixed.colliders} vs ${before.colliders})`);
} finally {
  await restore();
  await browser.close();
  server.close();
}

console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
if (errors.length) fails += errors.length;
console.log(fails ? `\nHOT RELOAD RED (${fails})` : '\nHOT RELOAD GREEN');
process.exit(fails ? 1 : 0);
