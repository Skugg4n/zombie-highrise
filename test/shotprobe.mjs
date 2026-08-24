// SHOT: a capture, not really a test. It freezes the frame on the first
// shot of a feel clip so a person can look at the muzzle flash, the
// tracer and the casing. That is a judgement no assertion can make.
//
// It still asserts the one thing it CAN: that a shot was fired at all.
// Without that the screenshot is a picture of a gun not going off, which
// has happened, and which looks the same as a picture of a muzzle flash
// that failed to render.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './assert.mjs';
const P = probe('SHOT');
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
page.on('pageerror', (e) => P.errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?feelclip=1`);
await page.waitForFunction(() => !!window.__zhr, null, { timeout: 10000 });
// Freeze right at the first shot: poll ammo until it drops.
const fired = await page.waitForFunction(() => window.__zhr.ammo() < 8, null,
  { timeout: 8000, polling: 16 }).then(() => true).catch(() => false);
await page.screenshot({ path: 'test-artifacts/shotprobe.png' });
P.check(fired, 'the clip actually fires a shot to photograph');
P.note('test-artifacts/shotprobe.png saved for a person to look at');
await browser.close(); server.close();
P.finish();
