// VR PARITY PROBE.
//
// Ola's rule, v0.13.x: "a feature is NOT done until it is usable in VR.
// Every piece of state a flat player can see must be visible in VR, and
// every action a flat player can take must be performable in VR."
//
// This asserts the parity list. It exists because "downed in VR is a
// softlock" shipped: the downed state, game over and victory were all DOM
// overlays, and DOM does not exist inside a headset, so the player saw
// nothing and could do nothing.
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

let fails = 0;
function check(ok, label, detail = '') {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
}

console.log('VR PARITY');
const entered = await page.evaluate(() => window.__zhr.debugEnterVR(true));
check(entered, 'the VR interface can be driven');
await page.waitForTimeout(400);

// ---- 1. State is visible: the wrist carries the whole HUD ----
const wrist = await page.evaluate(() => window.__zhr.debugVrWrist());
check(!!wrist && wrist.attached, 'wrist display is attached to a hand');
check(!!wrist && wrist.key.length > 0, 'wrist display has drawn its content');

// ---- 2. The off hand holds a torch, not a second gun ----
const hands = await page.evaluate(() => window.__zhr.debugHands());
check(hands && hands.includes('light'), 'the off hand carries the flashlight',
  JSON.stringify(hands));
check(hands && hands.filter((h) => h === 'light').length === 1,
  'exactly one hand carries the flashlight');

// ---- 3. Manual reload works in VR (regression guard) ----
// Point the barrel at the floor and hold: this is the whole gesture, and
// it silently stopped working once before.
const reloaded = await page.evaluate(async () => {
  const D = window.__zhr;
  D.debugRefill();
  D.debugFireOnce(true);                 // spend a round so a reload is real
  const before = D.ammo();
  D.debugVrPointDown(true);
  await new Promise((r) => setTimeout(r, 900));
  const reloading = D.reloading ? D.reloading() : null;
  D.debugVrPointDown(false);
  await new Promise((r) => setTimeout(r, 2200));
  return { before, after: D.ammo(), reloading };
});
check(reloaded.after > reloaded.before,
  'pointing the barrel down reloads the weapon',
  `${reloaded.before} -> ${reloaded.after} rounds`);

// ---- 4. Being downed is legible AND actionable ----
await page.evaluate(() => window.__zhr.debugSetDowned(true));
await page.waitForTimeout(300);
const downPanel = await page.evaluate(() => window.__zhr.debugVrPanel());
check(!!downPanel && downPanel.open && downPanel.visible,
  'a panel appears when you are downed');
check(!!downPanel && /DOWN/.test(downPanel.title),
  'it says what has happened', downPanel && downPanel.title);
check(!!downPanel && downPanel.actions.length > 0,
  'it offers at least one way forward', JSON.stringify(downPanel && downPanel.actions));
await page.evaluate(() => window.__zhr.debugSetDowned(false));

// ---- 5. Game over is legible AND actionable ----
// DIED FOR REAL, not ended with a debug shortcut. Ola reports that A and
// B leave him dead in the headset while this test was green, which means
// the test was reaching game over by a route no player can take.
await page.evaluate(async () => {
  const D = window.__zhr;
  for (let i = 0; i < 40 && D.hp() > 0; i++) {
    D.debugHurt(20);
    await new Promise((r) => setTimeout(r, 60));
  }
});
await page.waitForFunction(() => window.__zhr.wave()?.ph === 'gameover',
  null, { timeout: 12000 }).catch(() => {});
await page.waitForTimeout(600);
const overPanel = await page.evaluate(() => window.__zhr.debugVrPanel());
check(!!overPanel && overPanel.open, 'a panel appears on game over');
check(!!overPanel && /GAME OVER/.test(overPanel.title), 'it says the run is over',
  overPanel && overPanel.title);
const acts = (overPanel && overPanel.actions) || [];
check(acts.some((a) => /AGAIN/i.test(a)), 'you can restart from inside the headset',
  JSON.stringify(acts));
check(acts.some((a) => /QUIT/i.test(a)), 'you can quit from inside the headset');

// The action must leave the player ABLE TO PLAY.
//
// This assertion used to read `after !== 'gameover'` and was green while
// TRY AGAIN left the player lying on the floor, unable to move or shoot,
// with the run effectively over. It measured a phase name instead of a
// player. What follows is what a person would actually check.
const acted = await page.evaluate(async () => {
  const before = window.__zhr.wave()?.ph;
  // Pressed through the GAMEPAD LOOP, the only route a player has. The
  // previous version called the panel handler directly and so proved
  // nothing about whether the button reaches it.
  const consumed = window.__zhr.debugVrButtonA();
  await new Promise((r) => setTimeout(r, 900));
  const play = await window.__zhr.debugCanPlay();
  return { consumed, before, after: window.__zhr.wave()?.ph, play };
});
check(acted.consumed, 'the face button is consumed by the panel');
check(!acted.play.downed, 'after TRY AGAIN the player is no longer downed');
check(acted.play.hp >= 100, 'and has full health', `hp ${acted.play.hp}`);
check(acted.play.canMove, 'and can move');
check(acted.play.canShoot, 'and can shoot',
  `ammo ${acted.play.ammoBefore} -> ${acted.play.ammoAfter}`);
check(acted.after !== 'gameover', 'and the run is running again',
  `${acted.before} -> ${acted.after}`);

// ---- 6. The debug menu, reachable from inside the headset ----
// Ola asked for it so he can reach everything the game has. It is also the
// diagnostic: it prints live state, so a fault in a headset can be read
// out loud instead of guessed at.
const menu = await page.evaluate(async () => {
  const D = window.__zhr;
  const opened = D.debugMenuState().open;
  D.debugVrButtonY();                       // Y opens it
  const afterOpen = D.debugMenuState();
  return { before: opened, after: afterOpen };
});
check(!menu.before && menu.after.open, 'Y opens the debug menu in VR');
check(menu.after.actions > 10, 'and it offers everything the game has',
  `${menu.after.actions} actions`);
check(menu.after.status.length > 3, 'and it prints live state to read out loud',
  JSON.stringify(menu.after.status));

const gave = await page.evaluate(async () => {
  const D = window.__zhr;
  const before = D.weapon();
  D.debugMenuPickLabel('Give SHOTGUN');
  await new Promise((r) => setTimeout(r, 300));
  return { before, after: D.weapon() };
});
check(gave.after !== gave.before, 'and picking an action actually does it',
  `${gave.before} -> ${gave.after}`);

console.log(fails === 0 ? '\nVR PARITY GREEN' : `\nVR PARITY: ${fails} FAILURES`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
