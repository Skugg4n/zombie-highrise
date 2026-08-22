// Feel-critic capture: runs every ?feelclip=N scripted scenario, records
// video (Playwright recordVideo) and a frame strip (screenshot every
// 350 ms) into test-artifacts/feel/<label>/. Usage: node test/feelcapture.mjs <label>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, renameSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const label = process.argv[2] || 'round';
const OUT = join(ROOT, 'test-artifacts', 'feel', label);
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = resolve(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(ROOT + sep)) throw new Error('traversal');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();

const CLIP_NAMES = {
  1: 'pistol-walker', 2: 'smg-group', 3: 'shotgun-brute',
  4: 'machete', 5: 'grenade', 6: 'downed',
};

for (let n = 1; n <= 6; n++) {
  const videoDir = join(OUT, `video-tmp-${n}`);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  await ctx.addInitScript(`Object.defineProperty(navigator, 'xr', {
    value: { isSessionSupported: async () => false }, configurable: true });`);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?feelclip=${n}&seed=42`);
  await page.waitForFunction(() => !!window.__zhr, null, { timeout: 15000 });
  // Frame strip while the clip plays out.
  let frame = 0;
  const start = Date.now();
  while (Date.now() - start < 9000) {
    const done = await page.evaluate(() => window.__zhr.clipDone && window.__zhr.clipDone());
    await page.screenshot({ path: join(OUT, `clip${n}-f${String(frame).padStart(2, '0')}.png`) });
    frame++;
    if (done) break;
    await page.waitForTimeout(350);
  }
  await page.close();
  await ctx.close();   // flushes the video
  const files = readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
  if (files[0]) renameSync(join(videoDir, files[0]), join(OUT, `clip${n}-${CLIP_NAMES[n]}.webm`));
  console.log(`clip ${n} (${CLIP_NAMES[n]}): ${frame} frames`);
}

await browser.close();
server.close();
console.log('feel capture done: ' + OUT);
