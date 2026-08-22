// Bootstrap: renderer, platform detection, quality tier, level lifecycle,
// inputs, net wiring and the frame loop. Special boots: ?photomode=N
// (deterministic critic captures), ?uistate=<name> (UI gallery with fake
// data), ?autohost=1 / ?autojoin=CODE (smoke test hooks), ?seed=N.
import * as THREE from 'three';
import { CONFIG, VERSION, PARAMS, PHOTOMODE, UISTATE, FORCE_QUALITY, PLAY_SIZES, setPlayArea } from './config.js';
import { buildLevel, disposeLevel } from './world/levelgen.js';
import { resolveCircle } from './game/collision.js';
import { makeZombieMesh, makeAvatarMesh, AVATAR_COLORS } from './world/actors.js';
import { applyPhotomode, PHOTO_ZOMBIES } from './views/photomode.js';
import { Net } from './net/net.js';
import { msg } from './net/protocol.js';
import { HostSim, ZOMBIE_TYPES, ITEM_KINDS } from './game/state.js';
import { TUNING } from './game/tuning.js';
import { Arsenal } from './game/arsenal.js';
import { makeWeaponMesh, makeItemMesh } from './world/weapons3d.js';
import { Replica } from './game/replica.js';
import { KeyboardInput } from './input/keyboard.js';
import { TouchInput } from './input/touch.js';
import { VRInput } from './input/vr.js';
import { LobbyUI } from './ui/lobby.js';
import { Hud } from './ui/hud.js';

// ---- Platform and quality tier ----------------------------------------
const ua = navigator.userAgent || '';
const isQuest = /OculusBrowser|Quest/i.test(ua);
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
// A touchscreen laptop still has a fine pointer (mouse/trackpad): treat it
// as desktop so keyboard and mouse keep working. 'mobile' means touch-only.
const hasFinePointer = matchMedia('(pointer: fine)').matches;
const PLATFORM = isQuest ? 'quest' : (isTouch && !hasFinePointer ? 'mobile' : 'desktop');
const QUALITY = (FORCE_QUALITY || (isQuest ? 'vr' : PLATFORM)).toUpperCase() === 'VR' ? 'VR'
  : (FORCE_QUALITY || PLATFORM).toUpperCase() === 'MOBILE' ? 'MOBILE' : 'DESKTOP';

// ---- Renderer -----------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = QUALITY === 'DESKTOP';
renderer.xr.setFoveation?.(1);
document.getElementById('gl-root').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);

// ---- Lighting rig (persistent; per-level parameters + day/night) --------
const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x8a7a5a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe8c0, 2.2);
sun.position.set(40, 60, 25);
scene.add(sun);
if (QUALITY === 'DESKTOP') {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 30;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.far = 150;
}
// Headlamp-style flashlight (auto-on in dark levels, F toggles on desktop).
const flashlight = new THREE.SpotLight(0xd8e8ff, 0, 22, 0.42, 0.45, 1.2);
const flashlightTarget = new THREE.Object3D();
flashlightTarget.position.set(0, 0, -6);
camera.add(flashlight, flashlightTarget);
flashlight.position.set(0, 0.05, 0.05);
flashlight.target = flashlightTarget;
let flashlightOn = false;

// Day/night: nightT 0 = full day, 1 = full night. Lerped smoothly.
let nightT = 0, nightTarget = 0;
const colDaySky = new THREE.Color(), colNightSky = new THREE.Color(0x101a2e);
const colDayHaze = new THREE.Color(), colNightHaze = new THREE.Color(0x18223a);
const colTmp = new THREE.Color(), colTmp2 = new THREE.Color();

function applyLevelLighting(level) {
  const L = level.lighting;
  colDaySky.setHex(L.daySky);
  colDayHaze.setHex(L.dayHaze);
  scene.background = new THREE.Color(L.daySky);
  scene.fog = new THREE.Fog(L.dayHaze, L.fogNear, L.fogFar);
  flashlightOn = L.dark;
  updateDayNight(true);
}

function updateDayNight(force = false) {
  const L = level.lighting;
  if (L.dark) {   // basements ignore the sky entirely
    sun.intensity = 0;
    hemi.intensity = L.hemiDay;
    return;
  }
  const speed = force ? 1 : 0.02;
  nightT += (nightTarget - nightT) * (force ? 1 : Math.min(1, speed));
  colTmp.copy(colDaySky).lerp(colNightSky, nightT);
  colTmp2.copy(colDayHaze).lerp(colNightHaze, nightT);
  scene.background.copy(colTmp);
  scene.fog.color.copy(colTmp2);
  sun.intensity = L.sunDay * (1 - nightT * 0.92);
  sun.color.setHex(nightT > 0.5 ? 0xa8c0e8 : 0xffe8c0);   // moonlight is cool
  hemi.intensity = L.hemiDay * (1 - nightT * 0.72);
}

// ---- Level lifecycle ----------------------------------------------------
// All peers build identical geometry from (runSeed, levelIndex); the host
// picks the seed and hands it out in the welcome message.
const PHOTO_LEVEL = { 2: 2, 6: 3 };
let runSeed = (PHOTOMODE || UISTATE) ? 1337
  : (parseInt(PARAMS.get('seed') || '0', 10) || ((Math.random() * 1e9) >>> 0));
let levelIndex = PHOTOMODE ? (PHOTO_LEVEL[PHOTOMODE] || 1) : 1;
let level = buildLevel(scene, QUALITY, runSeed, levelIndex);
let doorT = 0;   // elevator doors 0 closed .. 1 open (visual)

function loadLevel(idx) {
  disposeLevel(scene, level);
  clearZombieVisuals();
  clearTransientVisuals();
  levelIndex = idx;
  level = buildLevel(scene, QUALITY, runSeed, idx);
  applyLevelLighting(level);
  nightTarget = 0; nightT = 0;
  doorT = 0;
  const spawn = level.playerSpawns[0];
  rig.group.position.copy(spawn);
  rig.group.rotation.y = rig.yaw = 0;
  // VR re-center: put the HEAD on the spawn point, not the play-space
  // origin, so the world quietly re-centers around the player's physical
  // position (the elevator trick from the vision doc).
  if (vrInput && vrInput.active) {
    rig.group.position.x -= camera.position.x;
    rig.group.position.z -= camera.position.z;
  }
  if (sim) sim.setLevel(level);
}

// ---- Player rig ---------------------------------------------------------
const rig = { group: new THREE.Group(), yaw: 0, pitch: 0, camera };
camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
rig.group.add(camera);
rig.group.position.copy(level.playerSpawns[0] || new THREE.Vector3());
scene.add(rig.group);
applyLevelLighting(level);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
// Backgrounded tabs suspend the animation loop; on return, restart the dt
// clock so the first frame is not a huge step (LESSONS.md).
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// ---- Zombie visuals pool ------------------------------------------------
const zombieVisuals = new Map();  // id -> {group, prev:V3, animT, flashT, type}
const dyingZombies = [];          // [{group, t}] short shrink-out corpses
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function poseZombie(group, animT) {
  const s = Math.sin(animT);
  const parts = group.userData.parts;
  parts.legL.rotation.x = s * 0.45;
  parts.legR.rotation.x = -s * 0.45;
  parts.armL.position.y = 1.22 + s * 0.03;
  parts.armR.position.y = 1.22 - s * 0.03;
  parts.torso.rotation.z = s * 0.06;
}

function ensureZombieVisual(id, type) {
  let v = zombieVisuals.get(id);
  if (!v) {
    v = { group: makeZombieMesh(type), prev: new THREE.Vector3(), animT: Math.random() * 6, flashT: 0, type };
    zombieVisuals.set(id, v);
    scene.add(v.group);
  }
  return v;
}

function clearZombieVisuals() {
  for (const v of zombieVisuals.values()) scene.remove(v.group);
  zombieVisuals.clear();
  for (const d of dyingZombies) scene.remove(d.group);
  dyingZombies.length = 0;
}

// rows: [id, typeIndex, x, y, z, hp][]
function updateZombieVisuals(rows, dt) {
  const keep = new Set();
  for (const r of rows) {
    const [id, ti, x, y, z] = r;
    keep.add(id);
    const v = ensureZombieVisual(id, ZOMBIE_TYPES[ti] || 'walker');
    v.prev.copy(v.group.position);
    v.group.position.set(x, y, z);
    const dx = x - v.prev.x, dz = z - v.prev.z;
    if (dx * dx + dz * dz > 1e-8) {
      v.group.rotation.y = Math.atan2(dx, dz);
      v.animT += dt * (v.type === 'runner' ? 11 : v.type === 'brute' ? 3.5 : 5.5);
      poseZombie(v.group, v.animT);
    }
    if (v.flashT > 0) {
      v.flashT -= dt;
      if (v.flashT <= 0) setZombieEmissive(v.group, 0x000000, 0);
    }
  }
  for (const [id, v] of zombieVisuals) {
    if (!keep.has(id)) { scene.remove(v.group); zombieVisuals.delete(id); }
  }
  for (let i = dyingZombies.length - 1; i >= 0; i--) {
    const d = dyingZombies[i];
    d.t -= dt;
    const k = Math.max(0.05, d.t / 0.45);
    d.group.scale.set(1, k, 1);
    if (d.t <= 0) { scene.remove(d.group); dyingZombies.splice(i, 1); }
  }
}

function setZombieEmissive(group, hex, intensity) {
  for (const part of Object.values(group.userData.parts)) {
    if (part.material.emissive) {
      part.material.emissive.setHex(hex);
      part.material.emissiveIntensity = intensity;
    }
  }
}

// ---- Remote player avatars ----------------------------------------------
const avatars = new Map();   // playerId -> mesh group
let avatarColorIdx = 0;
function ensureAvatar(id) {
  let a = avatars.get(id);
  if (!a) {
    a = makeAvatarMesh(AVATAR_COLORS[avatarColorIdx++ % AVATAR_COLORS.length]);
    avatars.set(id, a);
    scene.add(a);
  }
  return a;
}
function pruneAvatars(keepIds) {
  for (const [id, a] of avatars) {
    if (!keepIds.has(id)) { scene.remove(a); avatars.delete(id); }
  }
}
function updateAvatar(id, p) {
  const a = ensureAvatar(id);
  const parts = a.userData.parts;
  a.position.fromArray(p.p);
  a.rotation.y = p.ry || 0;
  parts.head.rotation.x = p.rx || 0;
  // Downed players lie flat.
  a.rotation.x = p.down ? -Math.PI / 2 * 0.9 : 0;
  const isVR = !!(p.vr && p.h);
  parts.handL.visible = isVR && !!p.hl;
  parts.handR.visible = isVR && !!p.hr;
  if (isVR) {
    a.updateMatrixWorld(true);
    parts.head.position.y = Math.max(0.4, (p.h.p[1] - p.p[1]));
    parts.body.scale.y = Math.max(0.5, parts.head.position.y / 1.55);
    for (const [hand, data] of [[parts.handL, p.hl], [parts.handR, p.hr]]) {
      if (!data) continue;
      hand.position.copy(a.worldToLocal(tmpV.fromArray(data.p)));
      a.getWorldQuaternion(tmpQ).invert();
      hand.quaternion.fromArray(data.q).premultiply(tmpQ);
    }
  } else {
    parts.head.position.y = 1.55;
    parts.body.scale.y = 1;
  }
}

// Muzzle flash: one pooled point light.
const flash = new THREE.PointLight(0xffc890, 0, 9);
scene.add(flash);

// ---- Item and grenade visuals ------------------------------------------
const itemVisuals = new Map();     // id -> {group, kind, bobT}
const grenadeVisuals = new Map();  // id -> mesh
const explosions = [];             // [{light, shell, t}]

function updateItemVisuals(rows, dt) {
  const keep = new Set();
  for (const [id, ki, x, y, z] of rows) {
    keep.add(id);
    let v = itemVisuals.get(id);
    if (!v) {
      v = { group: makeItemMesh(ITEM_KINDS[ki]), kind: ITEM_KINDS[ki], bobT: Math.random() * 6 };
      itemVisuals.set(id, v);
      scene.add(v.group);
    }
    v.bobT += dt * 2;
    v.group.position.set(x, y + 0.12 + Math.sin(v.bobT) * 0.06, z);
    v.group.rotation.y += dt * 1.2;
  }
  for (const [id, v] of itemVisuals) {
    if (!keep.has(id)) { scene.remove(v.group); itemVisuals.delete(id); }
  }
}

function updateGrenadeVisuals(rows) {
  const keep = new Set();
  for (const [id, x, y, z] of rows) {
    keep.add(id);
    let m = grenadeVisuals.get(id);
    if (!m) {
      m = makeWeaponMesh('grenade');
      m.scale.setScalar(1.4);
      grenadeVisuals.set(id, m);
      scene.add(m);
    }
    m.position.set(x, y, z);
  }
  for (const [id, m] of grenadeVisuals) {
    if (!keep.has(id)) { scene.remove(m); grenadeVisuals.delete(id); }
  }
}

function spawnExplosion(p) {
  const light = new THREE.PointLight(0xffa040, 26, 14, 1.5);
  light.position.set(p[0], p[1] + 0.4, p[2]);
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.7 }));
  shell.position.copy(light.position);
  shell.scale.setScalar(0.3);
  scene.add(light, shell);
  explosions.push({ light, shell, t: 0.45 });
}

function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    ex.t -= dt;
    const k = Math.max(0, ex.t / 0.45);
    ex.light.intensity = 26 * k;
    ex.shell.scale.setScalar(0.3 + (1 - k) * 2.4);
    ex.shell.material.opacity = 0.7 * k;
    if (ex.t <= 0) {
      scene.remove(ex.light, ex.shell);
      ex.shell.geometry.dispose(); ex.shell.material.dispose();
      explosions.splice(i, 1);
    }
  }
}

function clearTransientVisuals() {
  for (const v of itemVisuals.values()) scene.remove(v.group);
  itemVisuals.clear();
  for (const m of grenadeVisuals.values()) scene.remove(m);
  grenadeVisuals.clear();
}

// ---- UI -----------------------------------------------------------------
const hud = new Hud();
const lobby = new LobbyUI({
  onHost: startHosting,
  onJoin: startJoining,
  onSolo: startSolo,
  onStart: startPlaying,
  onLeave: leaveToMenu,
});
const $ = (id) => document.getElementById(id);
$('btn-go-retry').addEventListener('click', () => {
  if (sim) {
    $('panel-gameover').classList.add('hidden');
    sim.restartLevel();
  } else {
    leaveToMenu();   // clients cannot restart; the host does
  }
});
$('btn-go-lobby').addEventListener('click', () => {
  $('panel-gameover').classList.add('hidden');
  leaveToMenu();
});

// ---- Elevator shop ------------------------------------------------------
let shopOpen = false;
let lastRideT = -1;
for (const btn of document.querySelectorAll('.shop-item')) {
  btn.addEventListener('click', () => dispatchAction({ t: 'buy', item: btn.dataset.item }));
}
$('btn-shop-ready').addEventListener('click', () => {
  $('btn-shop-ready').textContent = 'WAITING FOR THE SQUAD...';
  dispatchAction({ t: 'ready' });
});

function openShop() {
  shopOpen = true;
  $('btn-shop-ready').textContent = 'READY - NEXT FLOOR';
  $('panel-shop').classList.remove('hidden');
  refreshShop();
}
function closeShop() {
  shopOpen = false;
  $('panel-shop').classList.add('hidden');
}
function refreshShop() {
  if (!shopOpen) return;
  $('shop-status').textContent = `SCRAP ${scrap} - doors close in ${lastWave ? lastWave.t : 20}s`;
  const P = TUNING.economy.shopPrices;
  const labels = {
    shotgun: 'SHOTGUN', smg: 'SMG',
    ammoRefillShotgun: 'SHELLS +25', ammoRefillSmg: 'SMG AMMO +120',
    healthPack: 'HEALTH PACK', grenadePack: '2 GRENADES',
  };
  for (const btn of document.querySelectorAll('.shop-item')) {
    const item = btn.dataset.item;
    let label = `${labels[item]} - ${P[item]}`;
    let blocked = scrap < P[item];
    if (item === 'shotgun' && arsenal.owned.includes('shotgun')) { label = 'SHOTGUN - OWNED'; blocked = true; }
    if (item === 'smg' && arsenal.owned.includes('smg')) { label = 'SMG - OWNED'; blocked = true; }
    if (item === 'ammoRefillShotgun' && !arsenal.owned.includes('shotgun')) blocked = true;
    if (item === 'ammoRefillSmg' && !arsenal.owned.includes('smg')) blocked = true;
    if (item === 'healthPack' && arsenal.packs >= 2) { label = 'HEALTH PACK - FULL'; blocked = true; }
    if (item === 'grenadePack' && arsenal.grenades >= 5) { label = '2 GRENADES - FULL'; blocked = true; }
    btn.textContent = label;
    btn.disabled = blocked;
  }
}

// ---- Game session state -------------------------------------------------
let role = null;             // null | 'solo' | 'host' | 'client'
let net = null;
let sim = null;              // HostSim (solo/host)
let replica = null;          // Replica (client)
let myHp = TUNING.player.maxHp;
let myDown = false;
let scrap = TUNING.economy.startingScrap;
let lastSnapAt = 0;          // client: when the last snapshot arrived
let staleShown = false;
let toastTimer = 0;
let lastWave = null;         // latest wave block (host: sim.wave mirror)

function showToast(text, ms = 4000) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('toast').classList.add('hidden');
}

const playerName = PARAMS.get('name') || 'Player';

function isPlaying() { return lobby.state === 'playing'; }
function canAct() { return isPlaying() && !myDown; }

// ---- Arsenal (weapons controller) ---------------------------------------
// Routes actions to the local sim (host/solo) or over the wire (client).
function dispatchAction(m) {
  if (role === 'client') net?.sendToHost(m);
  else if (sim) sim.applyAction('H', m);
}

// Flat-mode viewmodel: the active weapon in the lower right of the camera.
const viewmodel = new THREE.Group();
viewmodel.position.set(0.28, -0.24, -0.5);
camera.add(viewmodel);
let viewmodelKick = 0;
let lastActiveWeapon = null;

function aimRay() {
  if (vrInput && vrInput.active) return vrInput.getAimRay();
  return {
    origin: camera.getWorldPosition(new THREE.Vector3()),
    dir: camera.getWorldDirection(new THREE.Vector3()),
  };
}

function makeArsenal() {
  return new Arsenal({
    dispatch: dispatchAction,
    onHudChange: refreshWeaponHud,
    effects: {
      muzzle: (o, d) => {
        flash.intensity = 10;
        flash.position.copy(o).addScaledVector(d, 0.3);
        viewmodelKick = 0.06;
      },
      swing: () => { viewmodelKick = 0.1; },
      throw: () => {},
    },
  });
}
let arsenal = makeArsenal();

function refreshWeaponHud() {
  hud.setWeapon(arsenal.hudInfo());
  hud.setScrap(scrap);
  refreshShop();
  if (arsenal.active !== lastActiveWeapon) {
    lastActiveWeapon = arsenal.active;
    viewmodel.clear();
    viewmodel.add(makeWeaponMesh(arsenal.active));
    if (vrInput) vrInput.setWeaponModel(arsenal.active);
  }
}

// Shared action set for every input layer (all gated on canAct).
const actions = {
  fire: () => { if (canAct()) { const r = aimRay(); if (r) arsenal.fire(r.origin, r.dir); } },
  fireFrom: (o, d) => { if (canAct()) arsenal.fire(o, d); },
  reload: () => { if (canAct()) arsenal.reload(); },
  cycle: () => { if (canAct()) arsenal.cycle(); },
  switchTo: (w) => { if (canAct()) arsenal.switchTo(w); },
  grenade: () => {
    if (!canAct()) return;
    const r = aimRay();
    if (r) arsenal.throwGrenade(r.origin, r.dir.clone().add(new THREE.Vector3(0, 0.35, 0)).normalize());
  },
  grenadeFrom: (o, d) => { if (canAct()) arsenal.throwGrenade(o, d); },
  pack: () => { if (canAct()) arsenal.usePack(); },
  flashlight: () => { flashlightOn = !flashlightOn; },
  map: () => {},   // tactical map lands in Pass D
};

// Tear down any previous session completely before starting a new one.
function resetSession() {
  if (net) net.leave();          // leave() detaches all callbacks first
  net = null; sim = null; replica = null; role = null;
  myHp = TUNING.player.maxHp; myDown = false;
  scrap = TUNING.economy.startingScrap;
  arsenal = makeArsenal();
  lastActiveWeapon = null;
  refreshWeaponHud();
  lastSnapAt = 0; lastWave = null;
  closeShop();
  clearTransientVisuals();
  hideToast();
  $('panel-gameover').classList.add('hidden');
  $('downed-note').classList.add('hidden');
  pruneAvatars(new Set());
  clearZombieVisuals();
  lobby.setMenuBusy(false);
  if (levelIndex !== 1) { runSeed = ((Math.random() * 1e9) >>> 0); loadLevel(1); }
}

function startSolo() {
  resetSession();
  role = 'solo';
  sim = new HostSim(level);
  sim.addPlayer('H', playerName, PLATFORM);
  hud.setRoom(null);
  startPlaying();
}

function startHosting() {
  resetSession();
  role = 'host';
  lobby.setMenuBusy(true, 'Contacting the connection broker...');
  net = new Net();
  sim = new HostSim(level);
  sim.addPlayer('H', playerName, PLATFORM);
  net.onHostReady = (code) => { lobby.setMenuBusy(false); lobby.showCode(code); hud.setRoom(code); };
  net.onPeerJoin = (id, hi) => {
    sim.addPlayer(id, hi.name, hi.platform);
    refreshHostPlayers();
  };
  net.onPeerLeave = (id) => { sim.removePlayer(id); refreshHostPlayers(); };
  net.onClientMessage = (id, m) => {
    if (m.t === 'pose') sim.updatePose(id, m);
    else sim.applyAction(id, m);
  };
  net.onError = onNetError;
  net.getWelcomeExtras = () => ({ seed: runSeed, level: levelIndex, area: CONFIG.PLAY_AREA });
  net.host();
}

function refreshHostPlayers() {
  const names = [...sim.players.entries()].filter(([id]) => id !== 'H').map(([, p]) => p.name);
  lobby.setHostPlayers(names);
}

function startJoining(code) {
  resetSession();
  role = 'client';
  net = new Net();
  replica = new Replica();
  lobby.setState('joining');
  lobby.setJoinStatus('Connecting to ' + code + '...');
  net.onWelcome = (w) => {
    lobby.showConnected(w.code);
    hud.setRoom(w.code);
    const areaChanged = typeof w.area === 'number' && w.area !== CONFIG.PLAY_AREA;
    if (areaChanged) setPlayArea(w.area);
    if ((typeof w.seed === 'number' && w.seed !== runSeed) || areaChanged) {
      if (typeof w.seed === 'number') runSeed = w.seed;
      loadLevel(w.level || 1);
    }
  };
  net.onSnapshot = (snap) => {
    lastSnapAt = performance.now();
    replica.push(snap);
    lastWave = snap.wave;
    handleEvents(snap.ev || []);
    const me = snap.players?.[net.myId];
    if (me) {
      if (me.hp !== myHp) { myHp = me.hp; hud.setHealth(myHp); }
      if (me.down !== myDown) setDowned(me.down);
      if (me.inv) {
        arsenal.syncFromHost(me.inv);
        if (me.inv.s !== scrap) { scrap = me.inv.s; hud.setScrap(scrap); }
      }
    }
  };
  net.onDisconnected = () => lobby.showError('Lost the connection to the host.');
  net.onError = onNetError;
  net.join(code, msg.hi(playerName, PLATFORM, VERSION));
}

function startPlaying() {
  // The host's play-size choice takes effect when the game starts; every
  // client hears about it through a level event in the next snapshot.
  if (sim) {
    const desired = PLAY_SIZES[lobby.playSize] || CONFIG.PLAY_AREA;
    if (desired !== CONFIG.PLAY_AREA) {
      setPlayArea(desired);
      loadLevel(1);
      sim.events.push({ e: 'level', index: 1, area: desired });
    }
  }
  lobby.setState('playing');
  hud.setHealth(myHp);
  refreshWeaponHud();
  if (sim && (sim.wave.phase === 'lobby' || sim.wave.phase === 'gameover')) sim.startRun();
}

function leaveToMenu() {
  resetSession();
  hud.setRoom(null);
  lobby.setState('menu');
}

function onNetError(text, fatal) {
  if (fatal) {
    resetSession();
    lobby.setState('menu');
    lobby.setJoinStatus(text, true);
    $('menu-status').textContent = text;
  } else if (lobby.state === 'menu' || lobby.state === 'joining') {
    lobby.setJoinStatus(text, true);
    $('menu-status').textContent = text;
  } else {
    showToast(text, 6000);
  }
}

function setDowned(down) {
  myDown = down;
  $('downed-note').classList.toggle('hidden', !down);
}

// ---- Events from the sim / snapshots ------------------------------------
function handleEvents(evs) {
  for (const ev of evs) {
    switch (ev.e) {
      case 'zhit': {
        const v = zombieVisuals.get(ev.id);
        if (v) { v.flashT = 0.12; setZombieEmissive(v.group, 0xff5040, 0.8); }
        break;
      }
      case 'zdie': {
        const v = zombieVisuals.get(ev.id);
        if (v) {
          zombieVisuals.delete(ev.id);
          dyingZombies.push({ group: v.group, t: 0.45 });
        }
        break;
      }
      case 'shot': {
        // Other players' muzzle flashes (own shots flash locally already).
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.id !== me && Array.isArray(ev.o)) {
          flash.intensity = Math.max(flash.intensity, 7);
          flash.position.fromArray(ev.o);
        }
        break;
      }
      case 'boom':
        spawnExplosion(ev.p);
        break;
      case 'pickup': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.by === me) {
          const label = {
            ammo_shotgun: '+25 shells', ammo_smg: '+120 rounds',
            pack: '+1 health pack', grenade: '+1 grenade',
          }[ev.kind] || ev.kind;
          showToast(label, 1800);
        }
        break;
      }
      case 'phit':
        if (role !== 'client' && ev.id === 'H') { myHp = ev.hp; hud.setHealth(myHp); }
        break;
      case 'down':
        if (ev.id === (role === 'client' ? net?.myId : 'H')) setDowned(true);
        break;
      case 'revive':
        if (ev.id === (role === 'client' ? net?.myId : 'H')) {
          setDowned(false);
          myHp = ev.hp; hud.setHealth(myHp);
        }
        break;
      case 'day':
        nightTarget = 0;
        $('panel-gameover').classList.add('hidden');
        closeShop();
        showCenterText('DAY', 1.6);
        break;
      case 'countdown':
        break;   // ticking text driven from the wave block each frame
      case 'night':
        nightTarget = 1;
        showCenterText('NIGHT ' + ev.n, 2.0);
        break;
      case 'elevator':
        nightTarget = 0.35;
        showCenterText('CLEARED', 1.6);
        showToast('Board the elevator!', 5000);
        break;
      case 'ride':
        showCenterText('GOING UP', 1.4);
        openShop();
        break;
      case 'level': {
        const areaChanged = typeof ev.area === 'number' && ev.area !== CONFIG.PLAY_AREA;
        if (areaChanged) setPlayArea(ev.area);
        if (ev.index !== levelIndex || areaChanged) loadLevel(ev.index);
        closeShop();
        break;
      }
      case 'gameover': {
        const s = ev.stats || {};
        $('go-stats').textContent =
          `You survived ${s.nights || 0} night${s.nights === 1 ? '' : 's'} and reached level ${s.level || 1}. ` +
          `${s.kills || 0} zombies down.`;
        $('btn-go-retry').style.display = role === 'client' ? 'none' : '';
        closeShop();
        $('panel-gameover').classList.remove('hidden');
        break;
      }
      case 'bought': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.id === me) showToast('Purchased: ' + ev.item, 1500);
        refreshShop();
        break;
      }
      case 'join': if (role === 'host') refreshHostPlayers(); break;
    }
  }
}

// Big centre text with auto-hide.
let centerT = 0;
function showCenterText(text, seconds) {
  const el = $('countdown');
  el.textContent = text;
  el.classList.remove('hidden');
  centerT = seconds;
}

// ---- Inputs -------------------------------------------------------------
const inputCtx = {
  rig, camera, renderer,
  dom: renderer.domElement,
  actions,
  isPlaying: canAct,
  getLocoMode: () => lobby.locoMode,
  onSessionChange: (active) => {
    if (active) {
      // Inside the headset the 2D lobby panels are invisible; entering VR
      // from the lobby starts the game (session start itself is always the
      // user's own button press, per the WebXR gesture rule).
      if (lobby.state === 'hosting' || lobby.state === 'connected') startPlaying();
      else if (lobby.state === 'menu') startSolo();
      return;
    }
    // Back to flat controls: adopt whatever yaw the rig ended up with.
    rig.yaw = rig.group.rotation.y;
    rig.pitch = 0;
    camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
    camera.rotation.set(0, 0, 0);
  },
};
let inputs = [];
let vrInput = null;
if (!PHOTOMODE && !UISTATE) {
  if (PLATFORM === 'desktop') inputs.push(new KeyboardInput(inputCtx));
  if (PLATFORM !== 'desktop') inputs.push(new TouchInput(inputCtx));
  vrInput = new VRInput(inputCtx);
  inputs.push(vrInput);
}
refreshWeaponHud();

// ---- Pose reporting -----------------------------------------------------
function buildPose() {
  const inVR = !!(vrInput && vrInput.active);
  if (!inVR) {
    return { p: rig.group.position.toArray(), ry: rig.yaw, rx: rig.pitch, vr: false };
  }
  const hp = camera.getWorldPosition(new THREE.Vector3());
  const hq = camera.getWorldQuaternion(new THREE.Quaternion());
  const e = new THREE.Euler().setFromQuaternion(hq, 'YXZ');
  const pose = {
    p: [hp.x, rig.group.position.y, hp.z], ry: e.y, rx: e.x, vr: true,
    h: { p: hp.toArray(), q: hq.toArray() },
  };
  const hl = vrInput.getHandPose('left');
  const hr = vrInput.getHandPose('right');
  if (hl) pose.hl = hl;
  if (hr) pose.hr = hr;
  return pose;
}

// ---- Special boots ------------------------------------------------------
if (PHOTOMODE) {
  for (const [type, x, z, fx, fz, animT] of (PHOTO_ZOMBIES[PHOTOMODE] || [])) {
    const g = makeZombieMesh(type);
    g.position.set(x, level.heightAt(x, z), z);
    g.rotation.y = Math.atan2(fx - x, fz - z);
    poseZombie(g, animT);
    scene.add(g);
  }
  updateAvatar('photobot', { p: [-2, level.floorY, -1], ry: 2.3, rx: 0, vr: false, hp: 100 });
  if (PHOTOMODE === 2) { nightTarget = 0; flashlightOn = true; }
  const wantHud = applyPhotomode(PHOTOMODE, { camera, scene, level });
  scene.remove(rig.group);
  scene.add(camera);
  if (wantHud) lobby.applyUIState('hud');
} else if (UISTATE) {
  lobby.applyUIState(UISTATE);
  camera.position.set(10, 1.7, 12);
  camera.lookAt(0, 1.2, 0);
  scene.remove(rig.group);
  scene.add(camera);
} else {
  lobby.setState('menu');
}

// ---- HUD phase text -----------------------------------------------------
function updateWaveHud(w) {
  if (!w) { hud.setWave('NIGHT 1'); return; }
  switch (w.ph) {
    case 'lobby': hud.setWave(role === 'client' ? 'WAITING FOR HOST' : 'NIGHT 1'); break;
    case 'day': hud.setWave(`FLOOR ${w.lv} - DAY - night in ${w.t}s`); break;
    case 'countdown':
      hud.setWave(`NIGHT ${w.n + 1}`);
      showCenterText(String(w.t), 0.5);
      break;
    case 'night': hud.setWave(`NIGHT ${w.n} - ${w.left} left`); break;
    case 'elevator': hud.setWave('CLEARED - board the elevator'); break;
    case 'ride':
      hud.setWave('GOING UP - floor ' + (w.lv + 1));
      if (shopOpen && w.t !== lastRideT) { lastRideT = w.t; refreshShop(); }
      break;
    case 'gameover': hud.setWave('GAME OVER'); break;
    default: hud.setWave('');
  }
}

// ---- Frame loop ---------------------------------------------------------
let last = performance.now();
let poseAccum = 0, snapAccum = 0, invAccum = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!PHOTOMODE && !UISTATE) {
    for (const input of inputs) input.update(dt);
    const inVR = !!(vrInput && vrInput.active);
    if (!inVR) {
      if (!isPlaying()) rig.yaw += dt * 0.02;  // slow menu drift
      rig.group.rotation.y = rig.yaw;
      camera.rotation.x = rig.pitch;
      // Downed players sink to the floor (flat modes).
      const eyeTarget = myDown ? 0.55 : CONFIG.PLAYER_HEIGHT;
      camera.position.y += (eyeTarget - camera.position.y) * Math.min(1, dt * 6);
    }
    // Collision + terrain under the player (head position in VR).
    const ref = inVR ? camera.getWorldPosition(tmpV) : rig.group.position;
    if (inVR) {
      const before = tmpV.clone();
      resolveCircle(tmpV, 0.3, level.colliders);
      rig.group.position.x += tmpV.x - before.x;
      rig.group.position.z += tmpV.z - before.z;
    } else {
      resolveCircle(rig.group.position, 0.32, level.colliders);
    }
    rig.group.position.y = level.heightAt(ref.x, ref.z);

    // Weapons: auto fire + reload timing, predicted locally.
    const fireHeld = inputs.some((i) => i.fireHeld);
    arsenal.update(dt, fireHeld && canAct(), aimRay);
    if (viewmodelKick > 0) {
      viewmodelKick = Math.max(0, viewmodelKick - dt * 0.4);
    }
    viewmodel.position.z = -0.5 + viewmodelKick;

    // Simulation / replication.
    if (sim) {
      sim.updatePose('H', buildPose());
      if (isPlaying()) sim.step(dt);
      if (role === 'solo') handleEvents(sim.events.splice(0));
      if (role === 'host' && net) {
        snapAccum += dt;
        if (snapAccum >= 1 / CONFIG.SNAPSHOT_HZ) {
          snapAccum = 0;
          const snap = sim.snapshot(now);
          handleEvents(snap.ev);
          net.broadcast(snap);
        }
      }
      lastWave = { ph: sim.wave.phase, n: sim.wave.night, lv: sim.wave.level, t: Math.ceil(sim.wave.t), left: sim.wave.left };
      // Authoritative inventory sync for the host's own arsenal (pickups,
      // grenade drops, scrap) at snapshot cadence.
      invAccum += dt;
      if (invAccum > 0.2) {
        invAccum = 0;
        const hostP = sim.players.get('H');
        if (hostP) {
          arsenal.syncFromHost(hostP.inv);
          if (hostP.inv.s !== scrap) { scrap = hostP.inv.s; hud.setScrap(scrap); }
        }
      }
      // Visuals straight from the authoritative sim.
      const rows = [];
      for (const z of sim.zombies.values()) {
        rows.push([z.id, ZOMBIE_TYPES.indexOf(z.type), z.pos.x, z.pos.y, z.pos.z, z.hp]);
      }
      updateZombieVisuals(rows, dt);
      const irows = [];
      for (const it of sim.items.values()) {
        irows.push([it.id, ITEM_KINDS.indexOf(it.kind), it.pos.x, it.pos.y, it.pos.z]);
      }
      updateItemVisuals(irows, dt);
      const grows = [];
      for (const g of sim.grenades.values()) {
        grows.push([g.id, g.pos.x, g.pos.y, g.pos.z]);
      }
      updateGrenadeVisuals(grows);
      const keep = new Set();
      for (const [id, p] of sim.players) {
        if (id === 'H') continue;
        keep.add(id);
        updateAvatar(id, {
          p: p.pos.toArray(), ry: p.ry, rx: p.rx, vr: p.vr, down: p.down, h: p.h, hl: p.hl, hr: p.hr,
        });
      }
      pruneAvatars(keep);
    } else if (role === 'client' && net && net.connected) {
      poseAccum += dt;
      if (poseAccum >= 1 / CONFIG.INPUT_HZ) {
        poseAccum = 0;
        net.sendToHost(msg.pose(buildPose()));
      }
      const s = replica.sample();
      if (s) {
        const keep = new Set();
        for (const [id, p] of Object.entries(s.players || {})) {
          if (id === net.myId) continue;
          keep.add(id);
          updateAvatar(id, p);
        }
        pruneAvatars(keep);
        updateZombieVisuals(s.zs || [], dt);
        if (s.wave) lastWave = s.wave;
      }
      const latest = replica.latest;
      if (latest) {
        updateItemVisuals(latest.is || [], dt);
        updateGrenadeVisuals(latest.gs || []);
      }
      // Stale-connection feedback (LESSONS.md).
      const stale = lastSnapAt > 0 && performance.now() - lastSnapAt > 4000;
      if (stale && !staleShown) { staleShown = true; showToast('Connection stalled, waiting for the host...', 0); }
      else if (!stale && staleShown) { staleShown = false; hideToast(); }
    }

    // Wave-driven presentation.
    if (isPlaying()) updateWaveHud(lastWave);
    updateDayNight();
    // Elevator doors: open while boarding, closed otherwise.
    const doorTarget = lastWave && lastWave.ph === 'elevator' ? 1 : (lastWave && (lastWave.ph === 'night' || lastWave.ph === 'ride') ? 0 : doorT);
    doorT += (doorTarget - doorT) * Math.min(1, dt * 3);
    if (level.elevator) level.elevator.setDoors(doorT);
  }

  // Centre text timer.
  if (centerT > 0) {
    centerT -= dt;
    if (centerT <= 0) $('countdown').classList.add('hidden');
  }

  // Flashlight follows its toggle.
  flashlight.intensity += ((flashlightOn ? 9 : 0) - flashlight.intensity) * Math.min(1, dt * 10);

  // Muzzle flash decay + explosion VFX.
  if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - dt * 80);
  updateExplosions(dt);

  renderer.render(scene, camera);
});

// ---- Test and debug API -------------------------------------------------
window.__zhr = {
  version: VERSION,
  platform: PLATFORM,
  quality: QUALITY,
  state: () => lobby.state,
  code: () => net?.code || null,
  role: () => role,
  myId: () => (role === 'client' ? net?.myId : role ? 'H' : null),
  hp: () => myHp,
  ammo: () => arsenal.hudInfo().mag,
  weapon: () => arsenal.active,
  scrap: () => scrap,
  wave: () => lastWave,
  levelIndex: () => levelIndex,
  myPos: () => rig.group.position.toArray(),
  remotePlayers: () => {
    const out = {};
    for (const [id, a] of avatars) out[id] = a.position.toArray();
    return out;
  },
  zombies: () => {
    const out = [];
    for (const [id, v] of zombieVisuals) out.push({ id, type: v.type, pos: v.group.position.toArray() });
    return out;
  },
  debugMove: (dx, dz) => { rig.group.position.x += dx; rig.group.position.z += dz; },
  debugTeleport: (x, z) => { rig.group.position.x = x; rig.group.position.z = z; },
  forceNight: () => { if (sim) sim.forceNight(); },
  debugClearNight: () => {
    if (!sim) return;
    sim.wave.queue = [];
    sim.zombies.clear();
  },
  elevatorZone: () => (level.elevatorZone ? { x: level.elevatorZone.x, z: level.elevatorZone.z } : null),
  shopOpen: () => shopOpen,
  debugShootZombie: () => {
    const first = zombieVisuals.values().next().value;
    if (!first) return false;
    const c = first.group.position.clone(); c.y += 1.1;
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = c.sub(o).normalize();
    arsenal.fire(o, d);
    return true;
  },
  items: () => [...itemVisuals.keys()],
  renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
};

// Smoke test hooks.
if (PARAMS.get('autohost')) startHosting();
else if (PARAMS.get('autojoin')) startJoining(PARAMS.get('autojoin').toUpperCase());
