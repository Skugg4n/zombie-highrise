// RAMP PROBE. Ola: "the ramp is wonky and the player sometimes falls
// through it. Ground and collision on ramps still are not solid."
//
// Walks the real character controller up, down and along the edges of the
// snipe ramp and flags any frame where the ground is not where the ramp
// says it should be.
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

const ramps = await page.evaluate(() => window.__zhr.debugRamps());
console.log(`ramp slabs: ${ramps.length}`);
console.log(ramps.map((r) => `x${r.x} z${r.z} top${r.top}`).join('\n'));

// The lane the ramp runs along, and two lines just inside each edge.
const cx = ramps[0].x, hx = ramps[0].hx;
const zTop = Math.min(...ramps.map((r) => r.z)) - 0.6;
const zBot = Math.max(...ramps.map((r) => r.z)) + 0.6;

const LINES = [
  ['centre, up  ', cx, zBot, cx, zTop],
  ['centre, down', cx, zTop, cx, zBot],
  ['west edge   ', cx - hx + 0.35, zBot, cx - hx + 0.35, zTop],
  ['east edge   ', cx + hx - 0.35, zBot, cx + hx - 0.35, zTop],
];

let bad = 0;
for (const [label, x0, z0, x1, z1] of LINES) {
  const path = await page.evaluate(([a, b, c, d]) => window.__zhr.debugWalkLine(a, b, c, d, 110),
    [x0, z0, x1, z1]);
  const ys = path.map((p) => p[1]);
  // A fall is a drop bigger than one ramp step (about 0.23 m) in one frame.
  let worstDrop = 0, worstAt = null;
  for (let i = 1; i < ys.length; i++) {
    const drop = ys[i - 1] - ys[i];
    if (drop > worstDrop) { worstDrop = drop; worstAt = path[i]; }
  }
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const fell = worstDrop > 0.35;
  if (fell) bad++;
  console.log(`${label}: y ${minY.toFixed(2)} to ${maxY.toFixed(2)}, `
    + `biggest single-frame drop ${worstDrop.toFixed(2)} m`
    + (worstAt ? ` at ${worstAt[0]},${worstAt[2]}` : '')
    + (fell ? '  FALL' : '  ok'));
}
console.log(bad === 0
  ? 'OK: the ramp is solid from every approach'
  : `FAIL: ${bad}/${LINES.length} lines fall through the ramp`);

// The step profile itself: every step must be climbable and every drop
// walkable, or the surface is not continuous.
const prof = await page.evaluate(([x, za, zb]) => {
  const out = [];
  for (let z = za; z <= zb; z += 0.1) out.push([+z.toFixed(1), +window.__zhr.debugHeightAt(x, z).toFixed(2)]);
  return out;
}, [cx, zTop, zBot]);
let maxStep = 0, stepAt = null;
for (let i = 1; i < prof.length; i++) {
  const d = Math.abs(prof[i][1] - prof[i - 1][1]);
  if (d > maxStep) { maxStep = d; stepAt = prof[i][0]; }
}
console.log(`\nsurface profile along the ramp: biggest height change between two `
  + `points 10 cm apart is ${maxStep.toFixed(2)} m at z=${stepAt}`);
console.log(maxStep <= 0.45
  ? 'OK: every step is within step-up, so the surface is continuous'
  : 'FAIL: there is a lip on the ramp taller than the player can step');
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
