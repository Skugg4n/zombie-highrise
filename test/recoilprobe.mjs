// Recoil and fire-rate probe.
//
// Ola's brief: "you CAN shoot super quick but you will probably miss, as
// the recoil will offset your aim", and the pattern must be LEARNABLE,
// not random. This measures both:
//   1. Where do shots land at 20 m when tapping vs spamming?
//   2. Is the vertical climb repeatable across bursts?
//   3. Does the pistol's magazine and reload keep the SMG worth buying?
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  try {
    const b = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/html' });
    res.end(b);
  } catch { res.writeHead(404).end('x'); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?seed=5`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
await page.click('#btn-solo');
await page.waitForFunction(() => window.__zhr.state() === 'playing', null, { timeout: 8000 });

const RANGE = 20;
async function burst(weapon, shots, gapMs, force = true) {
  return page.evaluate(async ([w, n, gap, range, force]) => {
    const D = window.__zhr;
    D.debugGrant(w);
    D.debugSwitch(w);
    D.debugResetRecoil();
    D.debugRefill();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = D.debugAim();
      // Where this shot crosses a plane `range` metres downrange of the
      // aim point the player is actually holding.
      pts.push([a.yaw, a.pitch]);
      D.debugRefill();
      D.debugFireOnce(force);
      await new Promise((r) => setTimeout(r, gap));
    }
    const base = pts[0];
    return {
      // Offsets in centimetres at `range`, relative to the first shot.
      pts: pts.map(([y, p]) => [
        +((y - base[0]) * range * 100).toFixed(1),
        +((p - base[1]) * range * 100).toFixed(1),
      ]),
      heat: +D.debugHeat().toFixed(2),
    };
  }, [weapon, shots, gapMs, RANGE, force]);
}

function spread(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return {
    rise: Math.max(...ys) - Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
  };
}

console.log(`offsets in cm at ${RANGE} m, relative to the first shot\n`);
for (const [w, label] of [['pistol', 'PISTOL'], ['shotgun', 'SHOTGUN'], ['smg', 'SMG']]) {
  // "As fast as the action allows" must respect each weapon's mechanical
  // cooldown: forcing a pump shotgun to 10 rounds a second measures a
  // rate no player can ever produce.
  const cd = await page.evaluate((ww) => window.__zhr.tuning().weapons[ww].fireCooldown, w);
  const fastGap = Math.round(cd * 1000) + 12;
  const tap = await burst(w, 5, Math.max(420, fastGap * 3));
  const spam = await burst(w, 8, fastGap);
  const t = spread(tap.pts), s = spread(spam.pts);
  console.log(`${label}`);
  console.log(`  controlled (5 shots, paced):          rise ${t.rise.toFixed(0)} cm, `
    + `width ${t.width.toFixed(0)} cm, heat ${tap.heat}`);
  console.log(`  spammed    (8 shots, ${fastGap} ms apart): rise ${s.rise.toFixed(0)} cm, `
    + `width ${s.width.toFixed(0)} cm, heat ${spam.heat}`);
  // A weapon whose action caps it below about 3 shots a second (a pump
  // shotgun) is limited by the mechanism, not by recoil, so there is no
  // "spam" for heat to punish. Only judge the fast weapons on this.
  const rateLimited = cd > 0.3;
  const ratio = s.rise / Math.max(1, t.rise);
  console.log(rateLimited
    ? `  rate-limited by the action itself (${(1 / cd).toFixed(1)} shots/s max), `
      + `so the climb is per-shot and not cumulative`
    : `  ${ratio > 2.2 ? 'OK' : 'FAIL'}: spamming costs ${ratio.toFixed(1)}x the vertical climb`);
}

// LEARNABILITY. Compare the STEP between consecutive shots, not the
// cumulative position: a burst that drops or gains one shot to real-time
// timing jitter would otherwise look wildly inconsistent when the pattern
// itself is identical. What a player learns is the step.
function steps(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    out.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  }
  return out;
}
const runs = [];
for (let i = 0; i < 3; i++) runs.push(steps((await burst('smg', 12, 105)).pts));
const n = Math.min(...runs.map((r) => r.length));
let worstStep = 0, worstRel = 0;
for (let i = 0; i < n; i++) {
  for (let a = 0; a < runs.length; a++) {
    for (let b = a + 1; b < runs.length; b++) {
      const d = Math.hypot(runs[a][i][0] - runs[b][i][0], runs[a][i][1] - runs[b][i][1]);
      const mag = Math.max(8, Math.hypot(runs[a][i][0], runs[a][i][1]));
      worstStep = Math.max(worstStep, d);
      worstRel = Math.max(worstRel, d / mag);
    }
  }
}
console.log(`\nlearnability: across 3 identical 12-shot SMG bursts, the step from one`);
console.log(`  shot to the next varies by at most ${worstStep.toFixed(1)} cm at ${RANGE} m`
  + ` (${(worstRel * 100).toFixed(0)}% of the step itself)`);
console.log(worstRel < 0.55
  ? 'OK: the shape repeats, so a player can pull against it'
  : 'FAIL: too random to compensate for');

// The sight must come all the way home when you stop, or aim drifts up
// permanently over a long fight.
const settle = await page.evaluate(async () => {
  const D = window.__zhr;
  D.debugSwitch('smg'); D.debugResetRecoil(); D.debugRefill();
  const before = D.debugAim().pitch;
  for (let i = 0; i < 20; i++) {
    D.debugRefill();
    D.debugFireOnce(true);
    await new Promise((r) => setTimeout(r, 95));
  }
  await new Promise((r) => setTimeout(r, 1800));   // let it settle
  return { before, after: D.debugAim().pitch };
});
const residueCm = Math.abs(settle.after - settle.before) * 20 * 100;
console.log(`\nsettle: after a 20-round burst and 1.8 s of stillness, the aim sits `
  + `${residueCm.toFixed(1)} cm from where it started, at 20 m`);
console.log(residueCm < 12 ? 'OK: the sight comes home'
  : 'FAIL: recoil leaves permanent drift');

// Sustained damage: does the SMG still earn its price?
const dps = await page.evaluate(() => {
  const W = window.__zhr.tuning().weapons;
  const out = {};
  for (const w of ['pistol', 'shotgun', 'smg', 'ak']) {
    const d = W[w];
    const emptyTime = d.magazine * d.fireCooldown;
    const cycle = emptyTime + d.reloadTime;
    out[w] = {
      burstPerSec: +(1 / d.fireCooldown).toFixed(1),
      sustainedDps: +((d.magazine * d.damage * (d.pellets || 1)) / cycle).toFixed(2),
      emptyIn: +emptyTime.toFixed(2),
    };
  }
  return out;
});
console.log('\nsustained damage per second (magazine and reload are the real limit):');
for (const [w, v] of Object.entries(dps)) {
  console.log(`  ${w.padEnd(8)} ${v.burstPerSec}/s burst, empties in ${v.emptyIn}s, `
    + `sustained ${v.sustainedDps} dmg/s`);
}
console.log(dps.smg.sustainedDps > dps.pistol.sustainedDps * 1.5
  ? 'OK: the SMG is still clearly worth buying'
  : 'FAIL: the pistol has made the SMG pointless');

console.log('\nerrors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
