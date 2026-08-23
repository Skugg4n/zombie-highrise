// Smoke test (run after EVERY change): Playwright drives one host context
// and one client context against a local static server. Asserts:
//  - host can create a room, client joins with the 4-char code
//  - state syncs both ways (positions travel host->client and client->host)
//  - "Enter VR" button exists and is enabled in hosting AND joined states
//  - no console errors on either side
//  - every ?uistate renders its key elements visible, inside the viewport
//    and non-overlapping at phone / laptop / desktop sizes
//  - ?photomode=9 boots and renders (flip check itself is visual)
// Exit code 0 = green. Any failure prints details and exits 1.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ARTIFACTS = join(ROOT, 'test-artifacts');
mkdirSync(ARTIFACTS, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

const failures = [];
const note = (ok, label) => {
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + label);
  if (!ok) failures.push(label);
};

// ---- Static server -------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = resolve(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) throw new Error('traversal');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- Browser helpers -----------------------------------------------------
const browser = await chromium.launch();

// WebXR is absent in headless Chromium; stub just enough for the "Enter VR"
// button availability logic (never for real sessions).
const XR_STUB = `
  Object.defineProperty(navigator, 'xr', {
    value: { isSessionSupported: async (m) => m === 'immersive-vr',
             requestSession: async () => { throw new Error('no XR in test'); } },
    configurable: true,
  });
`;

function watchErrors(page, label, store) {
  page.on('console', (m) => {
    if (m.type() === 'error') store.push(`[${label}] console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => store.push(`[${label}] pageerror: ${e.message}`));
}

async function newPage(context, label, errs) {
  const page = await context.newPage();
  watchErrors(page, label, errs);
  return page;
}

const errs = [];

// ---- 0. The record matches the build ------------------------------------
// CLAUDE.md: bump the version on every change, and log every change in
// CHANGELOG.md. That rule broke on v0.14.0 and v0.14.1, which are the same
// two commits that produced the newest dead code in the repo. A rule that
// only holds when you are not busy is not a rule, so it is a test now.
//
// This runs FIRST and needs no browser: an undocumented release should
// stop the run before anything slower gets a chance to.
console.log('THE RECORD');
{
  const cfg = await readFile(join(ROOT, 'src/config.js'), 'utf8');
  const m = cfg.match(/export const VERSION = '([^']+)'/);
  note(!!m, 'src/config.js declares a VERSION');
  if (m) {
    const version = m[1];
    const log = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
    // Accept "## v0.14.2" and "## v0.14.2 - 2026-08-23 - title".
    const documented = new RegExp(`^##\\s+v${version.replace(/\./g, '\\.')}\\b`, 'm').test(log);
    note(documented,
      documented
        ? `v${version} has a CHANGELOG entry`
        : `v${version} is the shipping version but CHANGELOG.md has no "## v${version}" `
          + `entry. Every version the player can see must say what changed in it.`);
  }
}

// ---- 1. Host + client + sync --------------------------------------------
console.log('MULTIPLAYER STEEL THREAD');
const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const clientCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await hostCtx.addInitScript(XR_STUB);
await clientCtx.addInitScript(XR_STUB);

const host = await newPage(hostCtx, 'host', errs);
const client = await newPage(clientCtx, 'client', errs);

let code = null;
try {
  await host.goto(`${BASE}/?autohost=1&name=SmokeHost`);
  await host.waitForFunction(() => window.__zhr && window.__zhr.state() === 'hosting', null, { timeout: 30000 });
  code = await host.evaluate(() => window.__zhr.code());
  note(!!code && code.length === 4, `host created room, code shown (${code})`);
  const shown = await host.locator('#room-code').innerText();
  note(shown.trim() === code, 'room code visible in the hosting panel');
} catch (e) {
  note(false, 'host failed to reach hosting state: ' + e.message);
}

// Enter VR button in hosting state.
try {
  const vrBtn = host.locator('#btn-vr');
  await vrBtn.waitFor({ state: 'visible', timeout: 5000 });
  note(await vrBtn.isEnabled(), 'Enter VR button visible and enabled while hosting');
} catch (e) {
  note(false, 'Enter VR button missing in hosting state: ' + e.message);
}

if (code) {
  try {
    await client.goto(`${BASE}/?autojoin=${code}&name=SmokeClient`);
    await client.waitForFunction(() => window.__zhr && window.__zhr.state() === 'connected', null, { timeout: 30000 });
    note(true, 'client joined with the code and reached connected state');
  } catch (e) {
    note(false, 'client failed to join: ' + e.message);
  }

  try {
    const vrBtn = client.locator('#btn-vr');
    await vrBtn.waitFor({ state: 'visible', timeout: 5000 });
    note(await vrBtn.isEnabled(), 'Enter VR button visible and enabled while joined');
  } catch (e) {
    note(false, 'Enter VR button missing in joined state: ' + e.message);
  }

  // Host -> client sync: move the host, client's remote avatar follows.
  try {
    await host.evaluate(() => window.__zhr.debugMove(3.0, -2.0));
    const hostPos = await host.evaluate(() => window.__zhr.myPos());
    await client.waitForFunction((hp) => {
      const rp = window.__zhr.remotePlayers();
      return Object.values(rp).some((p) =>
        Math.abs(p[0] - hp[0]) < 0.5 && Math.abs(p[2] - hp[2]) < 0.5);
    }, hostPos, { timeout: 10000 });
    note(true, 'host movement replicated to the client');
  } catch (e) {
    note(false, 'host movement did not reach the client: ' + e.message);
  }

  // Client -> host sync.
  try {
    await client.evaluate(() => window.__zhr.debugMove(-2.5, 1.5));
    const clientPos = await client.evaluate(() => window.__zhr.myPos());
    await host.waitForFunction((cp) => {
      const rp = window.__zhr.remotePlayers();
      return Object.values(rp).some((p) =>
        Math.abs(p[0] - cp[0]) < 0.5 && Math.abs(p[2] - cp[2]) < 0.5);
    }, clientPos, { timeout: 10000 });
    note(true, 'client movement replicated to the host');
  } catch (e) {
    note(false, 'client movement did not reach the host: ' + e.message);
  }

  // Both sides can enter playing state; the wave machine runs; zombies
  // spawn at night and replicate to the client; the weapon fires.
  try {
    await host.click('#btn-start-host');
    await client.click('#btn-start-client');
    await host.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
    await client.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
    const wave = await host.evaluate(() => window.__zhr.wave());
    note(wave && wave.ph === 'day', `wave machine running (phase ${wave && wave.ph})`);
    await host.evaluate(() => window.__zhr.forceNight());
    await host.waitForFunction(() => window.__zhr.zombies().length > 0, null, { timeout: 15000 });
    note(true, 'night forced, zombies spawn on the host');
    await client.waitForFunction(() => window.__zhr.zombies().length > 0, null, { timeout: 10000 });
    note(true, 'zombies replicate to the client');
    await host.evaluate(() => window.__zhr.debugShootZombie());
    const ammo = await host.evaluate(() => window.__zhr.ammo());
    note(ammo === 7, `weapon fires and spends ammo (ammo ${ammo}/8)`);
  } catch (e) {
    note(false, 'playing/wave/weapon check failed: ' + e.message);
  }

  // Full floor transition: clear the night, board the elevator, ride the
  // shop, arrive on floor 2 on BOTH peers.
  try {
    // Two nights per floor: clear night 1, run and clear night 2.
    await host.evaluate(() => window.__zhr.debugClearNight());
    await host.waitForFunction(() => window.__zhr.wave()?.ph === 'day', null, { timeout: 8000 });
    await host.evaluate(() => window.__zhr.forceNight());
    await host.waitForFunction(() => window.__zhr.wave()?.ph === 'night', null, { timeout: 8000 });
    await host.waitForTimeout(300);   // let a spawn tick pass
    await host.evaluate(() => window.__zhr.debugClearNight());
    await host.waitForFunction(() => window.__zhr.wave()?.ph === 'elevator', null, { timeout: 8000 });
    note(true, 'two nights cleared, elevator phase reached');
    const zone = await host.evaluate(() => window.__zhr.elevatorZone());
    await host.evaluate((z) => window.__zhr.debugTeleport(z.x, z.z), zone);
    await client.evaluate((z) => window.__zhr.debugTeleport(z.x, z.z), zone);
    await host.waitForFunction(() => window.__zhr.wave()?.ph === 'ride', null, { timeout: 8000 });
    note(true, 'squad boarded, ride (shop) phase reached');
    await host.waitForFunction(() => window.__zhr.shopOpen(), null, { timeout: 5000 });
    await client.waitForFunction(() => window.__zhr.shopOpen(), null, { timeout: 5000 });
    note(true, 'shop opens on both peers');
    await host.click('#btn-shop-ready');
    await client.click('#btn-shop-ready');
    // Floor 2 is a TRAVERSE level, which has no day/night clock: it goes
    // straight into its route phase and ends when you reach the exit.
    await host.waitForFunction(
      () => window.__zhr.levelIndex() === 2 && window.__zhr.wave()?.ph === 'route',
      null, { timeout: 25000 });
    await client.waitForFunction(() => window.__zhr.levelIndex() === 2, null, { timeout: 10000 });
    note(true, 'both peers arrived on floor 2 (the traverse), in its route phase');
  } catch (e) {
    note(false, 'elevator/shop flow failed: ' + e.message);
  }
}

await host.screenshot({ path: join(ARTIFACTS, 'live-host.png') });
await client.screenshot({ path: join(ARTIFACTS, 'live-client.png') });

// Regression: a deliberate client LEAVE must land on the menu, never on
// the "CONNECTION LOST" error overlay (the client's own peer.destroy()
// fires the connection close handler).
if (code) {
  try {
    // Fresh join (the live client is already in playing state, where the
    // LEAVE button is not shown), then leave from the connected panel.
    await client.goto(`${BASE}/?autojoin=${code}&name=SmokeLeaver`);
    await client.waitForFunction(() => window.__zhr && window.__zhr.state() === 'connected', null, { timeout: 30000 });
    await client.click('#btn-leave');
    await client.waitForFunction(() => window.__zhr.state() === 'menu', null, { timeout: 5000 });
    await client.waitForTimeout(400);   // give any stray close event time to fire
    const errVisible = await client.evaluate(() =>
      !document.getElementById('panel-error').classList.contains('hidden'));
    note(!errVisible, 'client LEAVE returns to menu without a false error overlay');
  } catch (e) {
    note(false, 'client LEAVE flow failed: ' + e.message);
  }
}

await hostCtx.close();
await clientCtx.close();

// ---- 2. UI state gallery -------------------------------------------------
console.log('UI STATE GALLERY');
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'desktop', width: 1920, height: 1080 },
];
const UISTATES = ['lobby', 'hosting', 'joining', 'connected', 'hud', 'shop', 'gameover', 'victory'];

const galleryCtx = await browser.newContext();
await galleryCtx.addInitScript(XR_STUB);

for (const vp of VIEWPORTS) {
  const page = await newPage(galleryCtx, `gallery-${vp.name}`, errs);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  for (const state of UISTATES) {
    await page.goto(`${BASE}/?uistate=${state}`);
    await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
    await page.waitForTimeout(250);   // one settled frame

    const report = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-smoke]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return el.offsetParent !== null && r.width > 0 && r.height > 0;
        });
      const rects = els.map((el) => ({
        id: el.id || el.tagName + ':' + (el.textContent || '').slice(0, 18).trim(),
        r: el.getBoundingClientRect().toJSON(),
        el,
      }));
      const problems = [];
      const TOL = 1;
      for (const { id, r } of rects) {
        if (r.left < -TOL || r.top < -TOL ||
            r.right > innerWidth + TOL || r.bottom > innerHeight + TOL) {
          problems.push(`${id} outside viewport (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
        }
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (ox > TOL && oy > TOL) problems.push(`${a.id} overlaps ${b.id}`);
        }
      }
      return { count: rects.length, problems };
    });

    const vrOk = state === 'hosting' || state === 'connected'
      ? await page.locator('#btn-vr').isVisible() && await page.locator('#btn-vr').isEnabled()
      : true;
    const ok = report.count > 0 && report.problems.length === 0 && vrOk;
    note(ok, `uistate=${state} @ ${vp.name}: ${report.count} elements` +
      (report.problems.length ? ' | ' + report.problems.join('; ') : '') +
      (vrOk ? '' : ' | Enter VR button missing/disabled'));
    await page.screenshot({ path: join(ARTIFACTS, `ui-${state}-${vp.name}.png`) });
  }
  await page.close();
}
await galleryCtx.close();

// ---- 2b. Every level type generates and renders --------------------------
console.log('LEVEL TYPES');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(XR_STUB);
  const page = await newPage(ctx, 'leveltypes', errs);
  await page.goto(`${BASE}/?seed=42`);
  await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
  await page.click('#btn-solo');
  await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 5000 });
  for (const [n, expect] of [[2, 'traverse'], [3, 'holdout'], [4, 'ground'], [5, 'trench'], [6, 'wagon']]) {
    await page.evaluate((lv) => window.__zhr.debugGotoLevel(lv), n);
    await page.waitForTimeout(250);
    const type = await page.evaluate(() => window.__zhr.levelType());
    const info = await page.evaluate(() => window.__zhr.renderInfo());
    note(type === expect && info.calls > 0,
      `level ${n} (${type}) renders (${info.calls} calls, ${info.triangles} tris)`);
  }
  await ctx.close();
}

// ---- 3. Photomode boot ---------------------------------------------------
console.log('PHOTOMODE');
const photoCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await photoCtx.addInitScript(XR_STUB);
for (const n of [1, 2, 3, 6, 9]) {
  const page = await newPage(photoCtx, `photomode-${n}`, errs);
  await page.goto(`${BASE}/?photomode=${n}`);
  try {
    await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => window.__zhr.renderInfo());
    note(info.calls > 0, `photomode=${n} renders (${info.calls} draw calls, ${info.triangles} triangles)`);
    await page.screenshot({ path: join(ARTIFACTS, `photomode-${n}.png`) });
  } catch (e) {
    note(false, `photomode=${n} failed to boot: ` + e.message);
  }
  await page.close();
}
await photoCtx.close();

// ---- Verdict -------------------------------------------------------------
const consoleFailures = errs.filter((e) => !/favicon/i.test(e));
for (const e of consoleFailures) note(false, e);
if (consoleFailures.length === 0) note(true, 'no console errors on any page');

await browser.close();
server.close();

if (failures.length) {
  console.log(`\nSMOKE RED: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nSMOKE GREEN');
process.exit(0);
