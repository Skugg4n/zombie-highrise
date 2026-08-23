// Bootstrap: renderer, platform detection, quality tier, level lifecycle,
// inputs, net wiring and the frame loop. Special boots: ?photomode=N
// (deterministic critic captures), ?uistate=<name> (UI gallery with fake
// data), ?autohost=1 / ?autojoin=CODE (smoke test hooks), ?seed=N.
import * as THREE from 'three';
import { CONFIG, VERSION, PARAMS, PHOTOMODE, UISTATE, FORCE_QUALITY, PLAY_SIZES, setPlayArea } from './config.js';
import { buildLevel, disposeLevel, MATS, makeHelicopter, FINAL_LEVEL, LEVEL_SIZE } from './world/levelgen.js';
import { makeSkyDome, makeSunGlow, makeDustMotes } from './world/sky.js';
import { HordeRenderer } from './world/horde.js';
import { resolveCircle } from './game/collision.js';
import { LOCO, moveAndCollide, groundHeight, blockingFor } from './game/locomotion.js';
import { makeZombieMesh, makeAvatarMesh, AVATAR_COLORS, SHARED_MATERIALS } from './world/actors.js';
import { applyPhotomode, PHOTO_ZOMBIES } from './views/photomode.js';
import { FEEL_CLIPS } from './views/feelclips.js';
import { Net } from './net/net.js';
import { msg } from './net/protocol.js';
import { HostSim, ZOMBIE_TYPES, ITEM_KINDS, TRAP_KINDS } from './game/state.js';
import { TUNING } from './game/tuning.js';
import { Arsenal } from './game/arsenal.js';
import { makeWeaponMesh, makeItemMesh } from './world/weapons3d.js';
import { Replica } from './game/replica.js';
import { meta } from './game/meta.js';
import { audio } from './audio/audio.js';
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
let lastWave = null;   // latest wave block (declared early: lighting reads it)

// Remove an object from the scene AND free its per-instance GPU buffers.
// Shared materials (zombie skin/pants, pooled casings) are skipped.
function removeAndDispose(obj) {
  scene.remove(obj);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry !== casingGeo) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!SHARED_MATERIALS.has(m) && m !== casingMat) m.dispose();
    }
  });
}

// ---- Lighting rig (persistent; per-level parameters + day/night) --------
const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x8a7a5a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe8c0, 2.2);
sun.position.set(45, 30, 20);   // low warm sun = long readable shadows
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
const flashlight = new THREE.SpotLight(0xd8e8ff, 0, 26, 0.62, 0.7, 1.0);
const flashlightTarget = new THREE.Object3D();
flashlightTarget.position.set(0, 0, -6);
camera.add(flashlight, flashlightTarget);
flashlight.position.set(0, 0.05, 0.05);
flashlight.target = flashlightTarget;
let flashlightOn = false;
// Visible beam cone (cheap volumetric hint).
const beamGeo = new THREE.ConeGeometry(2.1, 7, 12, 1, true);
beamGeo.rotateX(-Math.PI / 2);
beamGeo.translate(0, 0, -3.5);
const beamMesh = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
  color: 0xcfe2ff, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
}));
beamMesh.renderOrder = 2;
camera.add(beamMesh);

// Sky dome, sun glow sprite and dust motes (art-direction details).
const sky = makeSkyDome();
sky.dome.userData.noAtlas = true;
scene.add(sky.dome);
const sunGlow = makeSunGlow();
scene.add(sunGlow);
const dust = makeDustMotes();
scene.add(dust.points);

// Day/night: nightT 0 = full day, 1 = full night. Lerped smoothly.
let nightT = 0, nightTarget = 0;
const colDaySky = new THREE.Color(), colNightSky = new THREE.Color(0x101a2e);
const colDayHaze = new THREE.Color(), colNightHaze = new THREE.Color(0x18223a);
const colNightGround = new THREE.Color(0x151d30);
const colTmp = new THREE.Color(), colTmp2 = new THREE.Color();
const colDayGround = new THREE.Color();

function applyLevelLighting(level) {
  const L = level.lighting;
  colDaySky.setHex(L.daySky);
  colDayHaze.setHex(L.dayHaze);
  colDayGround.setHex(L.dark ? 0x0a0c10 : 0xcabb96);
  scene.background = null;   // the dome paints the sky
  scene.fog = new THREE.Fog(L.dayHaze, L.fogNear, L.fogFar);
  flashlightOn = L.dark;
  sky.dome.visible = true;
  sunGlow.visible = !L.dark;
  dust.points.visible = true;   // dust motes read in dark beams too
  updateDayNight(true);
}

function updateDayNight(force = false) {
  const L = level.lighting;
  const modNow = lastWave && lastWave.ph === 'night' ? lastWave.mod : null;
  if (scene.fog) {
    scene.fog.far = L.fogFar * (modNow === 'fog' ? TUNING.modifiers.fog.fogFarMult : 1);
  } else if (mapSavedFog) {
    // Map view suspended the fog; keep the stored one in step so closing
    // the map does not snap the world to a stale colour.
    mapSavedFog.color.copy(colTmp2);
    mapSavedFog.far = L.fogFar * (modNow === 'fog' ? TUNING.modifiers.fog.fogFarMult : 1);
  }
  const blackout = modNow === 'blackout' ? TUNING.modifiers.blackout.hemiMult : 1;
  if (L.dark) {   // basements/trenches: the sky barely matters
    sun.intensity = 0;
    hemi.intensity = L.hemiDay * blackout;
    sky.uniforms.uTop.value.setHex(0x0c1424);
    sky.uniforms.uHorizon.value.setHex(0x142036);
    sky.uniforms.uGround.value.setHex(0x0b1020);
    return;
  }
  const speed = force ? 1 : 0.02;
  nightT += (nightTarget - nightT) * (force ? 1 : Math.min(1, speed));
  colTmp.copy(colDaySky).lerp(colNightSky, nightT);
  colTmp2.copy(colDayHaze).lerp(colNightHaze, nightT);
  sky.uniforms.uTop.value.copy(colTmp);
  sky.uniforms.uHorizon.value.copy(colTmp2);
  sky.uniforms.uGround.value.copy(colDayGround).lerp(colNightGround, nightT);
  if (scene.fog) scene.fog.color.copy(colTmp2);
  sun.intensity = L.sunDay * (1 - nightT * 0.92);
  sun.color.setHex(nightT > 0.5 ? 0xa8c0e8 : 0xffe8c0);   // moonlight is cool
  hemi.intensity = L.hemiDay * (1 - nightT * 0.72) * blackout;
  // Windows in the skyline only glow after dark.
  MATS.facade.emissiveIntensity = nightT * 0.9;
  sunGlow.material.opacity = 1 - nightT * 0.55;   // the moon still glows
  sunGlow.position.copy(sun.position).normalize().multiplyScalar(290);
}

// ---- Level lifecycle ----------------------------------------------------
// All peers build identical geometry from (runSeed, levelIndex); the host
// picks the seed and hands it out in the welcome message.
const PHOTO_LEVEL = { 2: 2, 6: 3, 7: 5 };
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
  toggleMap(false);
  const spawn = level.playerSpawns[0];
  rig.group.position.copy(spawn);
  rig.group.rotation.y = rig.yaw = 0;
  // VR re-center: put the HEAD on the level's marked ROOMSCALE ZONE, so a
  // roomscale player's real floor maps onto the patch of level that is
  // sized for their room. The level itself stays big around them; they
  // shoot far and walk near (the elevator trick from the vision doc).
  if (vrInput && vrInput.active) {
    const rz = level.roomZone;
    if (rz) rig.group.position.set(rz.x, rig.group.position.y, rz.z);
    rig.group.position.x -= camera.position.x;
    rig.group.position.z -= camera.position.z;
  }
  if (sim) sim.setLevel(level);
  rebuildEntryArrows();
}

// ---- Player rig ---------------------------------------------------------
const rig = { group: new THREE.Group(), yaw: 0, pitch: 0, camera };
const playerVel = new THREE.Vector3();   // vertical velocity for gravity
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

// Audio unlocks on the first user gesture (iOS/WebAudio rule).
for (const evName of ['pointerdown', 'touchstart', 'keydown']) {
  document.addEventListener(evName, () => audio.unlock(), { once: true, passive: true });
}

// ---- Zombie horde (instanced) -------------------------------------------
// The live horde renders through HordeRenderer (7 instanced draw calls
// total); this pool only tracks per-zombie animation state.
const horde = new HordeRenderer(scene, 40, QUALITY === 'DESKTOP');
const zombieStates = new Map();   // id -> {type,x,y,z,rotY,animT,staggerT,flashT}
const dyingStates = [];           // corpses toppling out: {..., t}
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function poseZombie(group, animT) {
  const s = Math.sin(animT);
  const parts = group.userData.parts;
  parts.legL.rotation.x = s * 0.45;
  parts.legR.rotation.x = -s * 0.45;
  parts.armL.rotation.x = -0.12 + s * 0.1;    // shoulder sway
  parts.armR.rotation.x = -0.12 - s * 0.1;
  parts.torso.rotation.z = s * 0.06;
}

// Zombies killed by an instant event must not be resurrected by the
// 120 ms-delayed interpolation still carrying their row.
const recentlyDeadZ = new Map();   // id -> ignore-until timestamp

function clearZombieVisuals() {
  zombieStates.clear();
  dyingStates.length = 0;
  recentlyDeadZ.clear();
  horde.update([]);
}

// rows: [id, typeIndex, x, y, z, hp][]
function updateZombieVisuals(rows, dt) {
  const keep = new Set();
  const now = performance.now();
  for (const [id, until] of recentlyDeadZ) {
    if (now > until) recentlyDeadZ.delete(id);
  }
  for (const r of rows) {
    const [id, ti, x, y, z] = r;
    if (recentlyDeadZ.has(id)) continue;
    keep.add(id);
    let v = zombieStates.get(id);
    if (!v) {
      v = {
        type: ZOMBIE_TYPES[ti] || 'walker', x, y, z, rotY: 0,
        animT: Math.random() * 6, staggerT: 0, flashT: 0,
        scale: 0.93 + Math.random() * 0.14,   // silhouette variation
      };
      zombieStates.set(id, v);
    }
    const dx = x - v.x, dz = z - v.z;
    if (dx * dx + dz * dz > 1e-8) {
      v.rotY = Math.atan2(dx, dz);
      v.animT += dt * (v.type === 'runner' ? 11 : v.type === 'brute' ? 3.5 : 5.5);
    }
    v.x = x; v.y = y; v.z = z;
    if (v.flashT > 0) v.flashT -= dt;
    if (v.staggerT > 0) v.staggerT -= dt;
    if (v.lungeT > 0) v.lungeT -= dt;
  }
  for (const id of zombieStates.keys()) {
    if (!keep.has(id)) zombieStates.delete(id);
  }
  // Corpses topple backward, rest briefly, then sink away.
  const entries = [];
  for (const v of zombieStates.values()) {
    entries.push({
      x: v.x, y: v.y, z: v.z, rotY: v.rotY, type: v.type, animT: v.animT,
      stagger: Math.max(0, v.staggerT / 0.35), flash: v.flashT, fall: 0, sink: 0,
      lunge: Math.max(0, (v.lungeT || 0) / 0.35),
      scale: v.scale,
    });
  }
  // Corpses persist several seconds (a kill deserves a lasting trophy),
  // then sink away. Oldest are dropped when the pool would overflow.
  const CORPSE_T = 6.0;
  while (dyingStates.length > 14) dyingStates.shift();
  for (let i = dyingStates.length - 1; i >= 0; i--) {
    const d = dyingStates[i];
    d.t -= dt;
    if (d.t <= 0) { dyingStates.splice(i, 1); continue; }
    const elapsed = CORPSE_T - d.t;
    // Blast-thrown corpses skid outward while toppling.
    if (d.vx || d.vz) {
      const decel = Math.max(0, 1 - elapsed * 1.6);
      d.x += d.vx * decel * dt;
      d.z += d.vz * decel * dt;
    }
    entries.push({
      x: d.x, y: d.y, z: d.z, rotY: d.rotY, type: d.type, animT: d.animT,
      stagger: 0, flash: 0, scale: d.scale, roll: d.roll || 0,
      fall: Math.min(1, elapsed / 0.4),
      sink: elapsed > CORPSE_T - 1 ? (elapsed - (CORPSE_T - 1)) * 1.6 : 0,
    });
  }
  horde.update(entries);
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
    if (!keepIds.has(id)) { removeAndDispose(a); avatars.delete(id); }
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

// Ejected shell casings: a small pooled particle effect. Spawned at the
// weapon's MUZZLE offset, never at the camera (a casing at the camera
// origin flashes across the whole view as a giant quad; feel-critic find).
const casingGeo = new THREE.BoxGeometry(0.018, 0.018, 0.042);
const casingMat = new THREE.MeshBasicMaterial({ color: 0xc8a848 });
const casings = [];
const upV = new THREE.Vector3(0, 1, 0);
function spawnCasing(origin, dir) {
  if (casings.length > 14) {
    const old = casings.shift();
    scene.remove(old.mesh);
  }
  const mesh = new THREE.Mesh(casingGeo, casingMat);
  const right = new THREE.Vector3().crossVectors(dir, upV).normalize();
  mesh.position.copy(origin).addScaledVector(dir, 0.45)
    .addScaledVector(right, 0.12).addScaledVector(upV, -0.08);
  const vel = right.multiplyScalar(0.9 + Math.random() * 0.6)
    .add(new THREE.Vector3(0, 1.4 + Math.random() * 0.6, 0));
  scene.add(mesh);
  casings.push({ mesh, vel, t: 0.55, spin: (Math.random() - 0.5) * 24 });
}

// Muzzle flash sprite: a bright star at the muzzle for ~2 frames, paired
// with the point light so firing visibly lights the surroundings.
const flashSpriteTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.3, 'rgba(255,214,130,0.9)');
  g.addColorStop(1, 'rgba(255,180,80,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(255,240,200,0.9)';
  x.lineWidth = 3;
  for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    x.beginPath();
    x.moveTo(32 - Math.cos(a) * 30, 32 - Math.sin(a) * 30);
    x.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
    x.stroke();
  }
  return new THREE.CanvasTexture(c);
})();
const muzzleSprites = [];
function spawnMuzzleSprite(pos, big = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashSpriteTex, transparent: true, depthWrite: false,
    rotation: Math.random() * Math.PI,   // normal blending: reads on ANY background
  }));
  s.position.copy(pos);
  s.scale.setScalar((0.4 + Math.random() * 0.2) * big);
  scene.add(s);
  muzzleSprites.push({ s, t: 0.2 });
}

// Tracers: brief additive streaks so every shot visibly goes somewhere.
const tracerGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 4);
tracerGeo.rotateX(Math.PI / 2);   // align length with -Z lookAt axis
const tracers = [];
function localRayHitDist(o, d) {
  // Approximate first zombie along the ray (visual only, for tracer length).
  let best = 24;
  for (const v of zombieStates.values()) {
    const cx = v.x - o.x, cy = v.y + 1.1 - o.y, cz = v.z - o.z;
    const t = cx * d.x + cy * d.y + cz * d.z;
    if (t < 0.5 || t > best) continue;
    const d2 = cx * cx + cy * cy + cz * cz - t * t;
    if (d2 < 0.8 * 0.8) best = t;
  }
  return best;
}
function spawnTracer(origin, dir) {
  const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
    color: 0xffe8b8, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  const len = localRayHitDist(origin, dir);
  m.position.copy(origin).addScaledVector(dir, 0.3 + len / 2);
  m.scale.z = len;
  m.lookAt(m.position.clone().add(dir));
  scene.add(m);
  tracers.push({ m, t: 0.22 });
}
// Blood puffs: a dark red burst wherever a zombie takes a hit.
const bloodTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const x = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    x.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${12 + Math.random() * 14 | 0},10,${0.5 + Math.random() * 0.4})`;
    x.beginPath();
    x.arc(24 + (Math.random() - 0.5) * 26, 24 + (Math.random() - 0.5) * 26, 3 + Math.random() * 6, 0, Math.PI * 2);
    x.fill();
  }
  return new THREE.CanvasTexture(c);
})();
const bloodPuffs = [];
function spawnBloodPuff(x, y, z) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: bloodTex, transparent: true, depthWrite: false, rotation: Math.random() * Math.PI,
  }));
  s.position.set(x, y + 1.1, z);
  s.scale.setScalar(0.5);
  scene.add(s);
  bloodPuffs.push({ s, t: 0.28 });
}

// Blood floor decals: a kill leaves a stain for a while.
const bloodDecals = [];
function spawnBloodDecal(x, y, z) {
  if (bloodDecals.length > 10) {
    const old = bloodDecals.shift();
    scene.remove(old.m);
    old.m.material.dispose();
  }
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.5 + Math.random() * 0.3, 10),
    new THREE.MeshBasicMaterial({ color: 0x4a0e08, transparent: true, opacity: 0.55, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.random() * Math.PI;
  m.position.set(x, y + 0.025, z);
  scene.add(m);
  bloodDecals.push({ m, t: 9 });
}

// Machete swing trail: a fading arc ribbon so the swing exists on screen.
const trailGeo = new THREE.RingGeometry(0.55, 1.0, 12, 1, -0.4, 2.1);
let swingTrail = null;
function spawnSwingTrail() {
  if (swingTrail) { camera.remove(swingTrail.m); swingTrail.m.material.dispose(); }
  const m = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
    color: 0xf2ede0, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
  }));
  m.position.set(0.05, -0.05, -0.9);
  m.rotation.set(0.15, 0.35, -0.6);
  camera.add(m);
  swingTrail = { m, t: 0.42 };
}

function updateShotVfx(dt) {
  for (let i = bloodPuffs.length - 1; i >= 0; i--) {
    const b = bloodPuffs[i];
    b.t -= dt;
    b.s.scale.setScalar(0.5 + (0.28 - b.t) * 2.2);
    b.s.material.opacity = Math.max(0, b.t / 0.28);
    if (b.t <= 0) {
      scene.remove(b.s);
      b.s.material.dispose();
      bloodPuffs.splice(i, 1);
    }
  }
  for (let i = bloodDecals.length - 1; i >= 0; i--) {
    const bd = bloodDecals[i];
    bd.t -= dt;
    if (bd.t < 2) bd.m.material.opacity = 0.55 * (bd.t / 2);
    if (bd.t <= 0) {
      scene.remove(bd.m);
      bd.m.material.dispose();
      bloodDecals.splice(i, 1);
    }
  }
  if (swingTrail) {
    swingTrail.t -= dt;
    swingTrail.m.material.opacity = 0.7 * Math.max(0, swingTrail.t / 0.42);
    swingTrail.m.rotation.z -= dt * 6;
    if (swingTrail.t <= 0) {
      camera.remove(swingTrail.m);
      swingTrail.m.material.dispose();
      swingTrail = null;
    }
  }
  for (let i = muzzleSprites.length - 1; i >= 0; i--) {
    const f = muzzleSprites[i];
    f.t -= dt;
    if (f.t <= 0) {
      scene.remove(f.s);
      f.s.material.dispose();
      muzzleSprites.splice(i, 1);
    }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.t -= dt;
    tr.m.material.opacity = 0.95 * Math.max(0, tr.t / 0.22);
    if (tr.t <= 0) {
      scene.remove(tr.m);
      tr.m.material.dispose();
      tracers.splice(i, 1);
    }
  }
}
function updateCasings(dt) {
  for (let i = casings.length - 1; i >= 0; i--) {
    const c = casings[i];
    c.t -= dt;
    if (!c.rest) {
      c.vel.y -= 16 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin * dt;
      c.mesh.rotation.z += c.spin * 0.7 * dt;
      const floor = level.heightAt(c.mesh.position.x, c.mesh.position.z);
      if (c.mesh.position.y <= floor + 0.02) {
        // Brass stays on the ground for a beat instead of vanishing.
        c.rest = true;
        c.mesh.position.y = floor + 0.015;
        c.mesh.rotation.x = Math.PI / 2;
        c.t = Math.max(c.t, 3.5);
      }
    }
    if (c.t <= 0) { scene.remove(c.mesh); casings.splice(i, 1); }
  }
}

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
      const group = makeItemMesh(ITEM_KINDS[ki]);
      // Pickup language: soft glowing ground ring under every item.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.42, 20),
        new THREE.MeshBasicMaterial({ color: 0xe0a33c, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.name = 'ring';
      group.add(ring);
      v = { group, ring, kind: ITEM_KINDS[ki], bobT: Math.random() * 6 };
      itemVisuals.set(id, v);
      scene.add(v.group);
    }
    v.bobT += dt * 2;
    v.group.position.set(x, y + 0.12 + Math.sin(v.bobT) * 0.06, z);
    v.group.rotation.y += dt * 1.2;
    // Ring stays glued to the ground while the item bobs.
    v.ring.position.y = -(v.group.position.y - y) + 0.02;
    v.ring.rotation.z += dt;
    v.ring.material.opacity = 0.35 + Math.sin(v.bobT * 1.5) * 0.15;
  }
  for (const [id, v] of itemVisuals) {
    if (!keep.has(id)) { removeAndDispose(v.group); itemVisuals.delete(id); }
  }
}

const GRENADE_TINTS = [0x3f4a38, 0x8a8f98, 0xc07830, 0x6ab830];   // frag, smoke, molotov, spit
function updateGrenadeVisuals(rows) {
  const keep = new Set();
  for (const [id, x, y, z, kind] of rows) {
    keep.add(id);
    let m = grenadeVisuals.get(id);
    if (!m) {
      m = makeWeaponMesh('grenade');
      m.scale.setScalar(1.4);
      m.userData.kind = kind || 0;
      m.traverse((o) => {
        if (o.isMesh && o.material.color) o.material.color.setHex(GRENADE_TINTS[kind || 0] || GRENADE_TINTS[0]);
      });
      grenadeVisuals.set(id, m);
      scene.add(m);
    }
    m.position.set(x, y, z);
    // Frags blink faster and faster while cooking (fuse tension).
    if (m.userData.kind === 0) {
      m.scale.setScalar(1.4 + (Math.sin(performance.now() / 70) > 0.3 ? 0.25 : 0));
    }
  }
  for (const [id, m] of grenadeVisuals) {
    if (!keep.has(id)) { removeAndDispose(m); grenadeVisuals.delete(id); }
  }
}

// ---- Smoke clouds, fire patches, drones ---------------------------------
const smokeVisuals = [];   // {mesh, t, d}
const fireVisuals = [];    // {group, light, t, d}
const droneVisuals = new Map();

function spawnSmokeVisual(p, duration) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(TUNING.weapons.smokeGrenade.cloudRadius, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.38, depthWrite: false }));
  mesh.position.set(p[0], p[1] + 1.0, p[2]);
  scene.add(mesh);
  smokeVisuals.push({ mesh, t: duration, d: duration });
}

function spawnFireVisual(p, duration) {
  const group = new THREE.Group();
  const light = new THREE.PointLight(0xff8830, 4, 7, 1.6);
  light.position.y = 0.6;
  group.add(light);
  for (let i = 0; i < 5; i++) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.7, 5),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffa030 : 0xff5010, transparent: true, opacity: 0.85 }));
    const a = (i / 5) * Math.PI * 2;
    flame.position.set(Math.cos(a) * 0.8, 0.3, Math.sin(a) * 0.8);
    group.add(flame);
  }
  group.position.set(p[0], p[1], p[2]);
  scene.add(group);
  fireVisuals.push({ group, light, t: duration, d: duration });
}

function makeDroneMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.5, metalness: 0.5 }));
  g.add(body);
  const rotors = new THREE.Group();
  for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 8),
      new THREE.MeshBasicMaterial({ color: 0x888d94, transparent: true, opacity: 0.5 }));
    r.position.set(dx, 0.07, dz);
    rotors.add(r);
  }
  g.add(rotors);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x001100, emissive: 0x30ff60, emissiveIntensity: 1.5 }));
  eye.position.set(0, -0.06, 0.12);
  g.add(eye);
  // The payload hangs visibly under the frame. "Did my drone do anything"
  // is answered by watching the thing it is carrying leave.
  const sling = new THREE.Group();
  sling.position.set(0, -0.14, 0);
  g.add(sling);
  g.userData.rotors = rotors;
  g.userData.sling = sling;
  g.userData.payload = null;
  return g;
}

// Ground traps the drone drops. Each reads instantly from the base at
// 40 m, because you will never stand next to one.
const TRAP_COLOURS = { tar: 0x141118, spike: 0x8d8578, lure: 0xff7a1a };
function makeTrapMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'tar') {
    const cfg = TUNING.traps.tar;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(cfg.radius, 18).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: TRAP_COLOURS.tar, roughness: 0.12, metalness: 0.3,
        transparent: true, opacity: 0.9,
      }));
    disc.position.y = 0.04;
    g.add(disc);
    // Lumps so it is not a flat decal from an angle.
    for (let i = 0; i < 7; i++) {
      const a = i * 0.92, r = cfg.radius * (0.25 + (i % 3) * 0.22);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.3 + (i % 2) * 0.16, 6, 4),
        new THREE.MeshStandardMaterial({ color: TRAP_COLOURS.tar, roughness: 0.15, metalness: 0.3 }));
      b.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
      b.scale.y = 0.3;
      g.add(b);
    }
  } else if (kind === 'spike') {
    const cfg = TUNING.traps.spike;
    const mat = new THREE.MeshStandardMaterial({ color: TRAP_COLOURS.spike, roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < 22; i++) {
      const a = i * 2.39, r = cfg.radius * Math.sqrt((i + 0.5) / 22);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5 + (i % 3) * 0.12, 4), mat);
      sp.position.set(Math.cos(a) * r, 0.25, Math.sin(a) * r);
      sp.rotation.set((i % 5) * 0.06, a, (i % 3) * 0.08);
      g.add(sp);
    }
  } else {
    // Lure: a burning flare. Bright, loud in the dark, and the thing the
    // horde walks toward.
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.55, 6),
      new THREE.MeshStandardMaterial({
        color: 0x2a1a10, emissive: TRAP_COLOURS.lure, emissiveIntensity: 2.4,
      }));
    core.position.y = 0.28;
    g.add(core);
    const glow = new THREE.PointLight(0xff8a30, 6, 20);
    glow.position.y = 0.6;
    g.add(glow);
    g.userData.glow = glow;
  }
  return g;
}

const trapVisuals = new Map();
function updateTrapVisuals(rows, dt) {
  const keep = new Set();
  for (const [id, kindIdx, x, y, z, left] of rows || []) {
    const kind = TRAP_KINDS[kindIdx] || 'tar';
    keep.add(id);
    let g = trapVisuals.get(id);
    if (!g) { g = makeTrapMesh(kind); trapVisuals.set(id, g); scene.add(g); }
    g.position.set(x, y, z);
    // A flare visibly burns down, so its remaining time is readable
    // without opening the map.
    if (g.userData.glow) {
      const cfg = TUNING.traps.lure;
      const f = Math.max(0, left / cfg.duration);
      g.userData.glow.intensity = (3 + 5 * f) * (0.85 + 0.15 * Math.sin(performance.now() / 90));
    }
  }
  for (const [id, g] of trapVisuals) {
    if (!keep.has(id)) { removeAndDispose(g); trapVisuals.delete(id); }
  }
}

function updateDroneVisuals(rows, dt) {
  const keep = new Set();
  for (const [id, x, y, z, kindIdx, empty] of rows) {
    keep.add(id);
    let g = droneVisuals.get(id);
    if (!g) { g = makeDroneMesh(); droneVisuals.set(id, g); scene.add(g); }
    const kind = TRAP_KINDS[kindIdx ?? 0] || 'mine';
    const want = empty ? null : kind;
    if (g.userData.payload !== want) {
      g.userData.payload = want;
      g.userData.sling.clear();
      if (want) {
        const c = want === 'mine' ? 0x9a3020 : (TRAP_COLOURS[want] || 0x666666);
        const pk = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.2),
          new THREE.MeshStandardMaterial({
            color: c, roughness: 0.6,
            emissive: want === 'lure' ? 0xff7a1a : 0x000000,
            emissiveIntensity: want === 'lure' ? 1.4 : 0,
          }));
        g.userData.sling.add(pk);
      }
    }
    g.position.set(x, y + Math.sin(performance.now() / 300) * 0.08, z);
    g.userData.rotors.rotation.y += dt * 30;
  }
  for (const [id, g] of droneVisuals) {
    if (!keep.has(id)) { removeAndDispose(g); droneVisuals.delete(id); }
  }
}

function updateEffectVisuals(dt) {
  for (let i = smokeVisuals.length - 1; i >= 0; i--) {
    const s = smokeVisuals[i];
    s.t -= dt;
    s.mesh.material.opacity = 0.38 * Math.min(1, s.t / (s.d * 0.35));
    s.mesh.rotation.y += dt * 0.15;
    if (s.t <= 0) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose(); s.mesh.material.dispose();
      smokeVisuals.splice(i, 1);
    }
  }
  for (let i = fireVisuals.length - 1; i >= 0; i--) {
    const f = fireVisuals[i];
    f.t -= dt;
    f.light.intensity = 3 + Math.sin(performance.now() / 60) * 1.4;
    for (const child of f.group.children) {
      if (child.isMesh) child.scale.y = 0.8 + Math.sin(performance.now() / 90 + child.position.x * 7) * 0.3;
    }
    if (f.t <= 0) {
      removeAndDispose(f.group);
      fireVisuals.splice(i, 1);
    }
  }
}

// Explosive barrels: red drums with a hazard band, distinct from the
// inert rust barrels that are level dressing.
const barrelVisuals = new Map();
const barrelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.95, 10);
const barrelBandGeo = new THREE.CylinderGeometry(0.375, 0.375, 0.2, 10);
const barrelMatRed = new THREE.MeshStandardMaterial({ color: 0xa8341f, roughness: 0.75, metalness: 0.25 });
const barrelMatBand = new THREE.MeshStandardMaterial({ color: 0xe8c23c, roughness: 0.8 });
function updateBarrelVisuals(rows) {
  const keep = new Set();
  for (const [id, x, y, z] of rows) {
    keep.add(id);
    let g = barrelVisuals.get(id);
    if (!g) {
      g = new THREE.Group();
      const drum = new THREE.Mesh(barrelGeo, barrelMatRed);
      drum.position.y = 0.475;
      const band = new THREE.Mesh(barrelBandGeo, barrelMatBand);
      band.position.y = 0.62;
      g.add(drum, band);
      barrelVisuals.set(id, g);
      scene.add(g);
    }
    g.position.set(x, y, z);
  }
  for (const [id, g] of barrelVisuals) {
    if (!keep.has(id)) { removeAndDispose(g); barrelVisuals.delete(id); }
  }
}

const mineVisuals = new Map();     // id -> {group, dot}
function makeMineMesh() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.2, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0x2e3230, roughness: 0.6, metalness: 0.4 }));
  disc.position.y = 0.03;
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 1 }));
  dot.position.y = 0.07;
  g.add(disc, dot);
  g.userData.dot = dot;
  return g;
}
function updateMineVisuals(rows) {
  const keep = new Set();
  const blink = (Math.sin(performance.now() / 180) + 1) * 0.5;
  for (const [id, x, y, z] of rows) {
    keep.add(id);
    let g = mineVisuals.get(id);
    if (!g) { g = makeMineMesh(); mineVisuals.set(id, g); scene.add(g); }
    g.position.set(x, y, z);
    g.userData.dot.material.emissiveIntensity = 0.3 + blink * 1.2;
  }
  for (const [id, g] of mineVisuals) {
    if (!keep.has(id)) { removeAndDispose(g); mineVisuals.delete(id); }
  }
}

const pings = [];                  // [{group, t}]
function spawnPing(p) {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.5, 6),
    new THREE.MeshBasicMaterial({ color: 0xe0a33c }));
  cone.rotation.x = Math.PI;
  cone.position.y = 1.6;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 20),
    new THREE.MeshBasicMaterial({ color: 0xe0a33c, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(cone, ring);
  g.position.fromArray(p);
  scene.add(g);
  pings.push({ group: g, t: 5 });
}
function updatePings(dt) {
  for (let i = pings.length - 1; i >= 0; i--) {
    const ping = pings[i];
    ping.t -= dt;
    ping.group.children[0].position.y = 1.6 + Math.sin(performance.now() / 250) * 0.15;
    ping.group.children[0].rotation.y += dt * 2;
    if (ping.t <= 0) {
      removeAndDispose(ping.group);
      pings.splice(i, 1);
    }
  }
}

function spawnExplosion(p) {
  const light = new THREE.PointLight(0xffa040, 42, 18, 1.4);
  light.position.set(p[0], p[1] + 0.5, p[2]);
  // Fireball, lingering smoke column, and a scorch decal on the ground.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xffa838, transparent: true, opacity: 0.95, depthWrite: false,
    }));
  shell.position.copy(light.position);
  shell.scale.setScalar(0.4);
  const smoke = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 7),
    new THREE.MeshBasicMaterial({ color: 0x2c2620, transparent: true, opacity: 0.55, depthWrite: false }));
  smoke.position.set(p[0], p[1] + 1.2, p[2]);
  smoke.scale.setScalar(0.5);
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 16),
    new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.55, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(p[0], p[1] + 0.03, p[2]);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.0, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(p[0], p[1] + 0.15, p[2]);
  scene.add(light, shell, smoke, scorch, ring);
  explosions.push({ light, shell, smoke, scorch, ring, t: 2.6, T: 2.6 });
  // One-frame white screen flash (flat modes).
  if (!(vrInput && vrInput.active)) {
    const el = $('boom-flash');
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 90);
  }
}

function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    ex.t -= dt;
    const age = ex.T - ex.t;
    const flashK = Math.max(0, 1 - age / 0.6);    // fireball: first 0.6 s
    ex.light.intensity = 42 * flashK;
    ex.shell.scale.setScalar(0.4 + (1 - flashK) * 4.4);
    ex.shell.material.opacity = 0.9 * flashK;
    ex.shell.visible = flashK > 0;
    // Smoke rises and thins over the full lifetime.
    ex.smoke.scale.setScalar(0.5 + age * 1.1);
    ex.smoke.position.y += dt * 0.8;
    ex.smoke.material.opacity = 0.55 * Math.max(0, ex.t / ex.T);
    ex.scorch.material.opacity = 0.55 * Math.min(1, ex.t / 1.2);
    const ringK = Math.max(0, 1 - age / 0.5);
    ex.ring.scale.setScalar(1 + (1 - ringK) * 9);
    ex.ring.material.opacity = 0.8 * ringK;
    ex.ring.visible = ringK > 0;
    if (ex.t <= 0) {
      scene.remove(ex.light, ex.shell, ex.smoke, ex.scorch, ex.ring);
      for (const m of [ex.shell, ex.smoke, ex.scorch, ex.ring]) {
        m.geometry.dispose(); m.material.dispose();
      }
      explosions.splice(i, 1);
    }
  }
}

function clearTransientVisuals() {
  for (const v of itemVisuals.values()) removeAndDispose(v.group);
  itemVisuals.clear();
  for (const m of grenadeVisuals.values()) removeAndDispose(m);
  grenadeVisuals.clear();
  for (const g of mineVisuals.values()) removeAndDispose(g);
  mineVisuals.clear();
  for (const g of trapVisuals.values()) removeAndDispose(g);
  trapVisuals.clear();
  for (const ping of pings) removeAndDispose(ping.group);
  pings.length = 0;
  for (const s of smokeVisuals) removeAndDispose(s.mesh);
  smokeVisuals.length = 0;
  for (const f of fireVisuals) removeAndDispose(f.group);
  fireVisuals.length = 0;
  for (const g of droneVisuals.values()) removeAndDispose(g);
  droneVisuals.clear();
  for (const g of barrelVisuals.values()) removeAndDispose(g);
  barrelVisuals.clear();
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
$('btn-win-again').addEventListener('click', () => {
  $('panel-victory').classList.add('hidden');
  if (sim) {
    // A fresh run on a fresh building.
    clearFinale();
    runSeed = ((Math.random() * 1e9) >>> 0);
    loadLevel(1);
    sim.newRun();
    $('hud').classList.remove('hidden');
  } else {
    leaveToMenu();
  }
});
$('btn-win-lobby').addEventListener('click', () => {
  $('panel-victory').classList.add('hidden');
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
  $('hud').classList.add('hidden');   // the shop is modal; HUD returns after
  if (document.pointerLockElement) document.exitPointerLock();
  refreshShop();
}
function closeShop() {
  shopOpen = false;
  $('panel-shop').classList.add('hidden');
  if (lobby.state === 'playing') $('hud').classList.remove('hidden');
}
function refreshShop() {
  if (!shopOpen) return;
  $('shop-status').textContent = `SCRAP ${scrap}  ·  doors close in ${lastWave ? lastWave.t : 20}s  ·  floor ${(lastWave ? lastWave.lv : 1) + 1} next`;
  const P = TUNING.economy.shopPrices;
  const labels = {
    shotgun: 'SHOTGUN', smg: 'SMG',
    ammoRefillShotgun: 'SHELLS +25', ammoRefillSmg: 'SMG +120',
    healthPack: 'HEALTH PACK', grenadePack: '2 GRENADES', mine: 'MINE',
    ak: 'AK', ammoRefillAk: 'AK +90', akimbo: 'DUAL PISTOLS',
    smokePack: '2 SMOKES', molotovPack: '2 MOLOTOVS', nightVision: 'NIGHT VISION',
  };
  for (const btn of document.querySelectorAll('.shop-item')) {
    const item = btn.dataset.item;
    let label = `${labels[item]}  ·  ${P[item]}`;
    let blocked = scrap < P[item];
    if (item === 'shotgun' && arsenal.owned.includes('shotgun')) { label = 'SHOTGUN · OWNED'; blocked = true; }
    if (item === 'smg' && arsenal.owned.includes('smg')) { label = 'SMG · OWNED'; blocked = true; }
    if (item === 'ammoRefillShotgun' && !arsenal.owned.includes('shotgun')) blocked = true;
    if (item === 'ammoRefillSmg' && !arsenal.owned.includes('smg')) blocked = true;
    if (item === 'healthPack' && arsenal.packs >= 2) { label = 'HEALTH PACK · FULL'; blocked = true; }
    if (item === 'grenadePack' && arsenal.grenades >= 5) { label = '2 GRENADES · FULL'; blocked = true; }
    if (item === 'mine' && arsenal.mines >= 3) { label = 'MINE · FULL'; blocked = true; }
    if (item === 'ak' && arsenal.owned.includes('ak')) { label = 'AK · OWNED'; blocked = true; }
    if (item === 'ammoRefillAk' && !arsenal.owned.includes('ak')) blocked = true;
    if (item === 'akimbo' && arsenal.owned.includes('akimbo')) { label = 'DUAL PISTOLS · OWNED'; blocked = true; }
    if (item === 'smokePack' && arsenal.smokes >= 4) { label = '2 SMOKES · FULL'; blocked = true; }
    if (item === 'molotovPack' && arsenal.molotovs >= 4) { label = '2 MOLOTOVS · FULL'; blocked = true; }
    if (item === 'nightVision' && arsenal.nightVision) { label = 'NIGHT VISION · OWNED'; blocked = true; }
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
let viewmodelKickL = 0;    // dual pistols: the left gun kicks on its own
let viewmodelL = null;     // left-hand gun group when akimbo is equipped
let viewmodelSwingT = 0;   // machete swing arc timer
let lastActiveWeapon = null;
let recoilRecover = 0;   // accumulated recoil that eases back down

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
      muzzle: (o, d, w, hand) => {
        // All shot VFX originate at the WEAPON muzzle, offset right/down
        // from the camera axis in flat modes (VFX on the center ray hide
        // behind the crosshair and render end-on; probe-verified).
        const inVR = vrInput && vrInput.active;
        const right = new THREE.Vector3().crossVectors(d, upV).normalize();
        const mp = o.clone().addScaledVector(d, inVR ? 0.28 : 0.62);
        const side = hand === 'left' ? -0.24 : 0.24;
        if (!inVR) mp.addScaledVector(right, side).addScaledVector(upV, -0.14);
        flash.intensity = 11;
        flash.position.copy(mp);
        if (hand === 'left') viewmodelKickL = 0.06; else viewmodelKick = 0.06;
        audio.play(w || 'pistol');
        spawnMuzzleSprite(mp, { shotgun: 1.7, ak: 1.25 }[w] || 1);
        const aimPoint = o.clone().addScaledVector(d, 30);
        spawnTracer(mp, aimPoint.sub(mp).normalize());
        // Recoil (flat modes): a per-weapon upward kick, most of which
        // eases back down over the next frames (recovery). Auto weapons
        // also wander sideways slightly under sustained fire.
        if (!(vrInput && vrInput.active)) {
          const kick = { pistol: 0.012, akimbo: 0.010, shotgun: 0.034, smg: 0.007, ak: 0.014 }[w] || 0.012;
          rig.pitch += kick;
          recoilRecover += kick * 0.7;
          if (TUNING.weapons[w] && TUNING.weapons[w].auto) {
            rig.yaw += (Math.random() - 0.5) * 0.006;
            addShake(0.004);
          }
          if (w === 'shotgun') addShake(0.014);
        }
        spawnCasing(o, d);
      },
      swing: () => { viewmodelSwingT = 0.34; spawnSwingTrail(); audio.play('machete'); },
      throw: () => audio.play('throw'),
      reload: () => audio.play('reload'),
      dry: () => audio.play('dryfire'),
    },
  });
}
let arsenal = makeArsenal();

function refreshWeaponHud() {
  hud.setWeapon(arsenal.hudInfo());
  hud.setScrap(scrap);
  $('btn-nv').classList.toggle('hidden', !arsenal.nightVision);
  refreshShop();
  if (arsenal.active !== lastActiveWeapon) {
    lastActiveWeapon = arsenal.active;
    viewmodel.clear();
    viewmodelL = null;
    if (arsenal.active === 'akimbo') {
      // Dual pistols: two separate guns so each hand can kick alone.
      const right = makeWeaponMesh('pistol');
      viewmodel.add(right);
      viewmodelL = new THREE.Group();
      viewmodelL.add(makeWeaponMesh('pistol'));
      viewmodelL.position.set(-0.56, 0, 0);   // mirrored across the view
      viewmodel.add(viewmodelL);
    } else {
      viewmodel.add(makeWeaponMesh(arsenal.active));
    }
    if (vrInput) vrInput.setWeaponModel(arsenal.active);
  }
}

// Shared action set for every input layer (all gated on canAct).
const actions = {
  fire: () => { if (canAct() && !mapActive) { const r = aimRay(); if (r) arsenal.fire(r.origin, r.dir, arsenal.isAkimbo() ? 'left' : null); } },
  fireRight: () => { if (canAct() && !mapActive) { const r = aimRay(); if (r) arsenal.fire(r.origin, r.dir, 'right'); } },
  isAkimbo: () => arsenal.isAkimbo(),
  setAds: (on) => { arsenal.ads = !!on && canAct(); },
  adsAmount: () => arsenal.adsT,
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
  // Hand-place a mine just in front of the player (T key), or exactly at a
  // VR hand (left squeeze).
  mine: () => {
    if (!canAct()) return;
    const pos = rig.group.position.clone();
    pos.x += -Math.sin(rig.yaw) * 1.2;
    pos.z += -Math.cos(rig.yaw) * 1.2;
    arsenal.placeMine(pos);
  },
  mineAt: (pos) => { if (canAct()) arsenal.placeMine(pos); },
  flashlight: () => { flashlightOn = !flashlightOn; },
  throwCycle: () => { if (canAct()) arsenal.cycleThrowable(); },
  nightVision: () => toggleNightVision(),
  map: () => toggleMap(),
  // Repair the nearest damaged wall segment. Prep only, cheap, and meant
  // to be spammed: patching the base every morning is the routine that
  // makes the day phase worth having.
  // Returns true when it actually repaired something, so VR can fall back
  // to dropping a mine on the same button.
  repair: () => {
    if (!canAct()) return false;
    const seg = nearestRepairTarget();
    if (!seg) return false;
    if (scrap < TUNING.base.repairCost) { showToast('Not enough scrap.', 1200); return true; }
    dispatchAction({ t: 'repair', i: seg.index });
    audio.play('repair', [seg.x, 1, seg.z]);
    return true;
  },
};

// The wall segment the repair prompt is pointing at, or null.
function nearestRepairTarget() {
  const wall = level && level.baseWall;
  if (!wall) return null;
  const w = lastWave;
  if (!w || (w.ph !== 'day' && w.ph !== 'countdown')) return null;
  const p = rig.group.position;
  let best = null, bd = 2.2 * 2.2;
  for (const seg of wall.segments) {
    if (seg.hp >= seg.maxHp) continue;
    const dx = p.x - seg.x, dz = p.z - seg.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = seg; }
  }
  return best;
}

// Adopt the host's wall state wholesale (snapshot join / resync).
function applyWallState(hps) {
  const wall = level.baseWall;
  if (!wall) return;
  let changed = false;
  for (let i = 0; i < wall.segments.length && i < hps.length; i++) {
    const seg = wall.segments[i];
    if (seg.hp === hps[i]) continue;
    seg.hp = hps[i];
    seg.dead = hps[i] <= 0;
    if (seg.collider) seg.collider.dead = seg.dead;
    wall.refresh(i);
    changed = true;
  }
  if (changed) updateBaseHud();
}

// Base integrity readout + the repair prompt, refreshed on wall events and
// once per frame while the prompt could change.
function updateBaseHud() {
  const wall = level && level.baseWall;
  if (!wall) { hud.setBase(null); hud.setRepairPrompt(false); return; }
  hud.setBase(wall.integrity());
  hud.setRepairPrompt(!!nearestRepairTarget(), TUNING.base.repairCost);
}

// ---- Night vision -------------------------------------------------------
// Grainy green view, limited battery, recharges during the day.
let nvOn = false;
let nvBattery = TUNING.weapons.nightVision.batterySeconds;
function toggleNightVision() {
  if (!arsenal.nightVision || (nvBattery <= 0 && !nvOn)) return;
  nvOn = !nvOn;
}
function updateNightVision(dt) {
  const NV = TUNING.weapons.nightVision;
  if (nvOn) {
    nvBattery -= dt;
    if (nvBattery <= 0) { nvBattery = 0; nvOn = false; }
  } else if (lastWave && (lastWave.ph === 'day' || lastWave.ph === 'ride')) {
    nvBattery = Math.min(NV.batterySeconds, nvBattery + NV.rechargePerDaySecond * dt);
  }
  const active = nvOn && nvBattery > 0;
  if (active) {
    // Light-level override works in VR too; the DOM overlay adds the
    // grain/vignette on flat screens.
    hemi.intensity = 1.8;
    hemi.color.setHex(0x66ff88);
    sun.intensity = Math.min(sun.intensity, 0.05);
  } else {
    hemi.color.setHex(0xcfe5ff);
  }
  const inVR = !!(vrInput && vrInput.active);
  $('nv-overlay').classList.toggle('hidden', !active || inVR);
  hud.setNightVision(arsenal.nightVision, active, nvBattery);
}

// ---- Tactical map view --------------------------------------------------
// Orthographic top-down view of the live scene. PING marks a spot for the
// squad; MINE remote-places a mine for scrap (the tactician premium).
const mapCam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 150);
mapCam.position.set(0, 60, 0);
mapCam.up.set(0, 0, -1);
mapCam.lookAt(0, 0, 0);
let mapActive = false;
let mapMode = 'ping';
let mapSavedFog = null;

// The drone button doubles as the payload selector: click it again to
// cycle what it will carry. One button, no submenu, and the price is
// always on the label.
const DRONE_PAYLOADS = ['mine', 'tar', 'spike', 'lure'];
const PAYLOAD_LABEL = {
  mine: 'MINE', tar: 'TAR', spike: 'SPIKES', lure: 'FLARE',
};
let dronePayload = 'mine';

function refreshDroneButton() {
  const cost = TUNING.economy.dronePayload[dronePayload];
  $('btn-map-drone').textContent = `DRONE: ${PAYLOAD_LABEL[dronePayload]} - ${cost}`;
  $('btn-map-mine').textContent = `MINE - ${TUNING.economy.minePlacementFromMap}`;
}

function setMapMode(mode) {
  mapMode = mode;
  $('btn-map-ping').classList.toggle('on', mode === 'ping');
  $('btn-map-mine').classList.toggle('on', mode === 'mine');
  $('btn-map-drone').classList.toggle('on', mode === 'drone');
  refreshDroneButton();
}
$('btn-map-ping').addEventListener('click', () => setMapMode('ping'));
$('btn-map-mine').addEventListener('click', () => setMapMode('mine'));
$('btn-map-drone').addEventListener('click', () => {
  if (mapMode === 'drone') {
    dronePayload = DRONE_PAYLOADS[(DRONE_PAYLOADS.indexOf(dronePayload) + 1) % DRONE_PAYLOADS.length];
  }
  setMapMode('drone');
});
$('btn-map-close').addEventListener('click', () => toggleMap(false));

function toggleMap(force) {
  if (vrInput && vrInput.active) return;   // no 2D map inside the headset
  const next = force !== undefined ? force : !mapActive;
  if (next === mapActive) return;
  mapActive = next;
  // Interior levels have a ceiling; the overhead map must see past it.
  level.group.traverse((o) => {
    if (o.userData && o.userData.ceiling) o.visible = !mapActive;
  });
  // The map camera sits far above the level, so per-level fog would paint
  // the whole readout a flat colour. Suspend it while the map is open.
  if (mapActive) {
    mapSavedFog = scene.fog;
    scene.fog = null;
  } else if (mapSavedFog) {
    scene.fog = mapSavedFog;
    mapSavedFog = null;
  }
  $('map-ui').classList.toggle('hidden', !mapActive);
  $('map-grid').classList.toggle('hidden', !mapActive);
  // On touch devices the stick/look zones cover the canvas; they must let
  // taps through to the map while it is open.
  $('touch-ui').classList.toggle('map-open', mapActive);
  if (mapActive) {
    setMapMode('ping');
    if (document.pointerLockElement) document.exitPointerLock();
    // Frame the level being played, not a fixed box: a holdout field is
    // more than twice the size of an interior floor, and centring on the
    // world origin would put the base in a corner.
    const c = level.baseCentre || { x: 0, z: 0 };
    mapCam.position.set(c.x, 60, c.z);
    mapCam.lookAt(c.x, 0, c.z);
    const ext = level.mapExtent || LEVEL_SIZE * 0.62;
    const aspect = innerWidth / innerHeight;
    if (aspect >= 1) {
      mapCam.top = ext; mapCam.bottom = -ext;
      mapCam.left = -ext * aspect; mapCam.right = ext * aspect;
    } else {
      mapCam.left = -ext; mapCam.right = ext;
      mapCam.top = ext / aspect; mapCam.bottom = -ext / aspect;
    }
    mapCam.updateProjectionMatrix();
  }
}

// In-world tactical markers (visible only in map view): green player
// cones, red zombie blips, orange entry arrows for horde approach lanes.
const mapMarkers = new THREE.Group();
mapMarkers.visible = false;
scene.add(mapMarkers);
const markerPlayerGeo = new THREE.ConeGeometry(0.6, 1.2, 4);
const markerPlayerMat = new THREE.MeshBasicMaterial({ color: 0x7fb069 });
const markerSelfMat = new THREE.MeshBasicMaterial({ color: 0xe0a33c });
const zombieBlips = new THREE.InstancedMesh(
  new THREE.CircleGeometry(0.42, 8).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xd83020 }), 40);
zombieBlips.frustumCulled = false;
mapMarkers.add(zombieBlips);
const playerMarkerPool = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(markerPlayerGeo, markerPlayerMat);
  m.rotation.x = Math.PI;
  m.visible = false;
  mapMarkers.add(m);
  playerMarkerPool.push(m);
}
const entryArrows = new THREE.Group();
mapMarkers.add(entryArrows);
function rebuildEntryArrows() {
  entryArrows.clear();
  const arrowGeo = new THREE.ConeGeometry(0.7, 1.8, 3).rotateX(Math.PI / 2);
  for (const e of level.entries) {
    const a = new THREE.Mesh(arrowGeo,
      new THREE.MeshBasicMaterial({ color: 0xe0722c, transparent: true, opacity: 0.85 }));
    const c = level.baseCentre || { x: 0, z: 0 };
    a.position.set(e.x, 12, e.z);
    a.lookAt(c.x, 12, c.z);   // points toward the base
    entryArrows.add(a);
  }
}
rebuildEntryArrows();   // for the boot level; loadLevel refreshes later
const markerM = new THREE.Matrix4();
function updateMapMarkers() {
  mapMarkers.visible = mapActive || PHOTOMODE === 4;
  if (!mapMarkers.visible) return;
  // Self + remote players
  let pi = 0;
  const put = (x, z, self) => {
    if (pi >= playerMarkerPool.length) return;
    const m = playerMarkerPool[pi++];
    m.visible = true;
    m.material = self ? markerSelfMat : markerPlayerMat;
    m.position.set(x, 13, z);
  };
  put(rig.group.position.x, rig.group.position.z, true);
  for (const a of avatars.values()) put(a.position.x, a.position.z, false);
  for (; pi < playerMarkerPool.length; pi++) playerMarkerPool[pi].visible = false;
  // Zombies
  let zi = 0;
  for (const v of zombieStates.values()) {
    if (zi >= 40) break;
    markerM.makeTranslation(v.x, 12, v.z);
    zombieBlips.setMatrixAt(zi++, markerM);
  }
  zombieBlips.count = zi;
  zombieBlips.instanceMatrix.needsUpdate = true;
}

const mapRaycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!mapActive || !isPlaying()) return;
  const ndc = new THREE.Vector2(
    (e.clientX / innerWidth) * 2 - 1,
    -(e.clientY / innerHeight) * 2 + 1);
  mapRaycaster.setFromCamera(ndc, mapCam);
  const o = mapRaycaster.ray.origin, d = mapRaycaster.ray.direction;
  if (Math.abs(d.y) < 1e-6) return;
  const t = (level.floorY - o.y) / d.y;
  if (t < 0) return;
  const p = o.clone().addScaledVector(d, t);
  if (mapMode === 'ping') {
    dispatchAction({ t: 'ping', p: p.toArray() });
  } else if (mapMode === 'mine') {
    if (scrap < TUNING.economy.minePlacementFromMap) {
      showToast('Not enough scrap (' + TUNING.economy.minePlacementFromMap + ' needed)', 2000);
      return;
    }
    dispatchAction({ t: 'placeMine', p: p.toArray(), via: 'map' });
  } else if (mapMode === 'drone') {
    if (scrap < TUNING.economy.droneDeploy) {
      showToast('Not enough scrap (' + TUNING.economy.droneDeploy + ' needed)', 2000);
      return;
    }
    dispatchAction({ t: 'drone', p: p.toArray(), k: dronePayload });
    audio.play('dronefly');
    showToast(`Drone away: ${PAYLOAD_LABEL[dronePayload]}`, 1400);
  }
});

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
  presentedPhase = null;
  clearFinale();
  $('panel-victory').classList.add('hidden');
  nvOn = false;
  nvBattery = TUNING.weapons.nightVision.batterySeconds;
  $('nv-overlay').classList.add('hidden');
  closeShop();
  toggleMap(false);
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
  sim.addPlayer('H', playerName, PLATFORM, meta.scrapBonus());
  hud.setRoom(null);
  startPlaying();
}

function startHosting() {
  resetSession();
  role = 'host';
  lobby.setMenuBusy(true, 'Contacting the connection broker...');
  net = new Net();
  sim = new HostSim(level);
  sim.addPlayer('H', playerName, PLATFORM, meta.scrapBonus());
  net.onHostReady = (code) => { lobby.setMenuBusy(false); lobby.showCode(code); hud.setRoom(code); };
  net.onPeerJoin = (id, hi) => {
    sim.addPlayer(id, hi.name, hi.platform, hi.b || 0);
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
    // Someone who entered VR while the join was still connecting would be
    // dead-ended in the invisible 2D lobby: start playing now.
    if (vrInput && vrInput.active) startPlaying();
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
  net.join(code, { ...msg.hi(playerName, PLATFORM, VERSION), b: meta.scrapBonus() });
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
  presentedPhase = null;   // re-apply phase side effects for this session
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
  // Solo runs have no teammates; never promise a revive that cannot come.
  $('downed-note').textContent = role === 'solo'
    ? 'DOWNED' : 'DOWNED - a teammate close to you revives you';
  $('downed-note').classList.toggle('hidden', !down);
  updateLowHpVignette();
}

// ---- Events from the sim / snapshots ------------------------------------
function handleEvents(evs) {
  for (const ev of evs) {
    switch (ev.e) {
      case 'zhit': {
        const v = zombieStates.get(ev.id);
        if (v) {
          v.flashT = 0.3;
          v.staggerT = 0.35;   // hit reaction long enough to survive a sampled frame
          audio.play('zhit', v);
          spawnBloodPuff(v.x, v.y, v.z);
        }
        if (ev.by === (role === 'client' ? net?.myId : 'H')) showHitmarker(false);
        break;
      }
      case 'zdie': {
        recentlyDeadZ.set(ev.id, performance.now() + 600);
        if (ev.by === (role === 'client' ? net?.myId : 'H')) showHitmarker(true);
        if (Array.isArray(ev.p)) { spawnBloodPuff(ev.p[0], ev.p[1], ev.p[2]); spawnBloodDecal(ev.p[0], ev.p[1], ev.p[2]); }
        if (Array.isArray(ev.p)) audio.play('zdie', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        const v = zombieStates.get(ev.id);
        if (v) {
          zombieStates.delete(ev.id);
          dyingStates.push({
            ...v, t: 6.0,
            roll: (Math.random() - 0.5) * 1.3,
            vx: Array.isArray(ev.v) ? ev.v[0] : 0,
            vz: Array.isArray(ev.v) ? ev.v[1] : 0,
          });
        }
        break;
      }
      case 'shot': {
        // Other players' muzzle flashes and tracers.
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.id !== me && Array.isArray(ev.o)) {
          flash.intensity = Math.max(flash.intensity, 7);
          flash.position.fromArray(ev.o);
          audio.play(ev.w === 'machete' ? 'machete' : (ev.w || 'pistol'),
            { x: ev.o[0], y: ev.o[1], z: ev.o[2] });
          if (Array.isArray(ev.d) && ev.w !== 'machete') {
            const o = new THREE.Vector3().fromArray(ev.o);
            const d = new THREE.Vector3().fromArray(ev.d);
            const mp = o.clone().addScaledVector(d, 0.5);
            spawnMuzzleSprite(mp);
            spawnTracer(mp, d);
          }
        }
        break;
      }
      case 'head': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.by === me) {
          showHitmarker(true);
          showCritText();
          audio.play('crit');
        }
        if (Array.isArray(ev.p)) spawnBloodPuff(ev.p[0], ev.p[1] + 0.45, ev.p[2]);
        break;
      }
      case 'bhit': {
        const g = barrelVisuals.get(ev.id);
        if (g) audio.play('zhit', g.position);
        break;
      }
      case 'bboom': {
        // A barrel goes up bigger than a grenade: bright, loud, shaky.
        spawnExplosion(ev.p);
        spawnFireVisual(ev.p, 2.5);
        audio.play('explosion', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        const db = camera.getWorldPosition(tmpV).distanceTo(new THREE.Vector3(...ev.p));
        if (db < 22 && !(vrInput && vrInput.active)) addShake(0.02 + 0.06 * (1 - db / 22));
        break;
      }
      case 'boom': {
        spawnExplosion(ev.p);
        audio.play('explosion', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        const d = camera.getWorldPosition(tmpV).distanceTo(new THREE.Vector3(...ev.p));
        if (d < 18) addShake(0.012 + 0.05 * (1 - d / 18));
        break;
      }
      case 'smoke':
        spawnSmokeVisual(ev.p, ev.d || 8);
        audio.play('smoke', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        break;
      case 'fire':
        spawnFireVisual(ev.p, ev.d || 5);
        audio.play('ignite', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        break;
      case 'droned': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.by === me) showToast('Drone deployed', 1500);
        break;
      }
      case 'pickup': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.by === me) {
          const label = {
            ammo_shotgun: '+25 shells', ammo_smg: '+120 rounds',
            pack: '+1 health pack', grenade: '+1 grenade',
          }[ev.kind] || ev.kind;
          showToast(label, 1800);
          audio.play('pickup');
        }
        break;
      }
      case 'bite': {
        const v = zombieStates.get(ev.id);
        if (v) v.lungeT = 0.35;
        break;
      }
      case 'wall': {
        // The host owns the damage; every peer replays it onto its own
        // identical geometry, so the holes match on all screens.
        const wall = level.baseWall;
        if (!wall) break;
        const seg = wall.segments[ev.i];
        if (seg) {
          seg.hp = ev.hp;
          seg.dead = ev.hp <= 0;
          if (seg.collider) seg.collider.dead = seg.dead;
          wall.refresh(ev.i);
        }
        if (ev.broke) {
          audio.play('wallbreak', [seg ? seg.x : 0, 1, seg ? seg.z : 0]);
          showToast('BREACH! The wall is down.', 2200);
          if (!(vrInput && vrInput.active)) addShake(0.03);
        } else if (!ev.fix) {
          audio.play('wallhit', [seg ? seg.x : 0, 1, seg ? seg.z : 0]);
        }
        updateBaseHud();
        break;
      }
      case 'baselost':
        showToast('THE BASE IS LOST', 3200);
        break;
      case 'phit': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.id === me) {
          audio.play('hurt');
          // Pain reaches the whole screen, not just a HUD corner: red
          // vignette pulse + a small shove (flat modes only).
          pulseDamageVignette();
          if (!(vrInput && vrInput.active)) addShake(0.018);
        }
        if (role !== 'client' && ev.id === 'H') { myHp = ev.hp; hud.setHealth(myHp); }
        updateLowHpVignette();
        break;
      }
      case 'down':
        if (ev.id === (role === 'client' ? net?.myId : 'H')) setDowned(true);
        break;
      case 'revive':
        if (ev.id === (role === 'client' ? net?.myId : 'H')) {
          setDowned(false);
          myHp = ev.hp; hud.setHealth(myHp);
          audio.play('heal');
        }
        break;
      // Phase SIDE EFFECTS (lighting, shop, panels) are driven from the
      // wave block by presentPhase() so late joiners land in the right
      // state; events only carry the one-shot announcements.
      case 'day':
        if (isPlaying()) {
          showCenterText('DAY', 1.6);
          audio.stinger('day');
        }
        break;
      case 'countdown':
        break;   // ticking text driven from the wave block each frame
      case 'night':
        if (isPlaying()) {
          const MOD_TEXT = {
            fog: 'FOG NIGHT - they come out of the murk',
            frenzy: 'FRENZY - the runners are rabid',
            blackout: 'BLACKOUT - lights are dead tonight',
            swarm: 'SWARM - countless but rotten',
            loot: 'HARVEST NIGHT - they drop everything',
          };
          if (ev.boss) showCenterText('THE BUTCHER', 2.4);
          else if (ev.surge) showCenterText('NIGHT ' + ev.n + ' - SURGE', 2.2);
          else showCenterText('NIGHT ' + ev.n, 2.0);
          if (ev.mod && MOD_TEXT[ev.mod]) showToast(MOD_TEXT[ev.mod], 4200);
          audio.stinger('night');
        }
        break;
      case 'elevator':
        if (isPlaying()) {
          showCenterText('CLEARED', 1.6);
          showToast('Board the elevator!', 5000);
          audio.play('doors');
        }
        break;
      case 'ride':
        if (isPlaying()) showCenterText('GOING UP', 1.4);
        break;
      case 'level': {
        const areaChanged = typeof ev.area === 'number' && ev.area !== CONFIG.PLAY_AREA;
        if (areaChanged) setPlayArea(ev.area);
        if (ev.index !== levelIndex || areaChanged) loadLevel(ev.index);
        closeShop();
        // Each floor announces its identity so 7 never feels like 2.
        if (ev.name) {
          showCenterText(ev.name, 2.4);
          if (ev.note) showToast(ev.note, 5000);
        }
        break;
      }
      case 'finale':
        startFinale();
        break;
      case 'victory': {
        const st = ev.stats || {};
        meta.recordRun({ ...st, won: true });
        $('menu-meta').textContent = meta.summaryLine();
        const wn = st.nights || 0, wk = st.kills || 0;
        $('win-stats').textContent =
          `${wn} night${wn === 1 ? '' : 's'} survived. ${wk} zombie${wk === 1 ? '' : 's'} down. `
          + `${st.scrap || 0} scrap left unspent.`;
        $('btn-win-again').style.display = role === 'client' ? 'none' : '';
        audio.stinger('day');
        break;
      }
      case 'gameover': {
        const s = ev.stats || {};
        meta.recordRun(s);
        $('menu-meta').textContent = meta.summaryLine();
        $('go-stats').textContent =
          `You survived ${s.nights || 0} night${s.nights === 1 ? '' : 's'} and reached level ${s.level || 1}. ` +
          `${s.kills || 0} zombies down.`;
        $('btn-go-retry').style.display = role === 'client' ? 'none' : '';
        break;   // the panel itself is shown by presentPhase
      }
      case 'ping':
        spawnPing(ev.p);
        audio.play('ping', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        break;
      case 'spit': {
        const v = zombieStates.get(ev.id);
        if (v) audio.play('acid', v);
        break;
      }
      case 'acid':
        spawnBloodPuff(ev.p[0], ev.p[1] - 1.0, ev.p[2]);   // green-ish splash stand-in
        audio.play('acid', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        break;
      case 'scream':
        audio.play('scream', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        spawnPing(ev.p);   // marks the priority target for the squad
        break;
      case 'roar': {
        audio.play('roar', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        const dRoar = camera.getWorldPosition(tmpV).distanceTo(new THREE.Vector3(...ev.p));
        if (dRoar < 16 && !(vrInput && vrInput.active)) addShake(0.02);
        showToast('The Butcher is charging!', 1200);
        break;
      }
      case 'crash': {
        audio.play('explosion', { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        spawnSmokeVisual(ev.p, 1.2);
        if (!(vrInput && vrInput.active)) addShake(0.03);
        break;
      }
      case 'crit':
        showHitmarker(true);
        break;
      case 'mined': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.by === me) showToast('Mine placed (arms in 1s)', 1500);
        break;
      }
      case 'bought': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.id === me) {
          const NICE = {
            shotgun: 'Shotgun', smg: 'SMG', ak: 'AK', akimbo: 'Dual pistols',
            ammoRefillShotgun: 'Shells', ammoRefillSmg: 'SMG ammo', ammoRefillAk: 'AK ammo',
            healthPack: 'Health pack', grenadePack: 'Grenades', mine: 'Mine',
            smokePack: 'Smoke grenades', molotovPack: 'Molotovs', nightVision: 'Night vision',
          };
          showToast((NICE[ev.item] || ev.item) + ' purchased', 1500);
          audio.play('buy');
        }
        refreshShop();
        break;
      }
      case 'join': if (role === 'host') refreshHostPlayers(); break;
    }
  }
}

// Damage vignette: red edge pulse per hit; persistent heartbeat when low.
let vignettePulseTimer = 0;
function pulseDamageVignette() {
  const el = $('dmg-vignette');
  el.classList.add('pulse');
  clearTimeout(vignettePulseTimer);
  vignettePulseTimer = setTimeout(() => el.classList.remove('pulse'), 140);
}
function updateLowHpVignette() {
  $('dmg-vignette').classList.toggle('lowhp', isPlaying() && myHp <= 25);
}

// ---- Roof finale ------------------------------------------------------
// The extraction helicopter flies in over the arena while the survivors
// hold their ground; when it lifts away the run is won.
let heli = null;
let finaleT = 0;
function startFinale() {
  if (heli) return;
  heli = makeHelicopter();
  scene.add(heli.group);
  finaleT = 0;
  showCenterText('EXTRACTION', 2.0);
  showToast('Chopper coming in from the west. Hold the roof!', 5000);
  audio.play('doors');
}
function clearFinale() {
  if (!heli) return;
  removeAndDispose(heli.group);
  heli = null;
  finaleT = 0;
}
function updateFinale(dt) {
  if (!heli) return;
  const dur = TUNING.pacing.finaleDuration;
  finaleT = Math.min(dur, finaleT + dt);
  heli.update(finaleT / dur, dt);
  // Rotor wash: a low rumble while it hovers overhead.
  if (Math.random() < dt * 3) {
    audio.play('doors', heli.group.position);
  }
}

// Headshot callout: a short amber word above the crosshair.
let critTimer = 0;
function showCritText() {
  const el = $('crit-text');
  el.classList.add('show');
  clearTimeout(critTimer);
  critTimer = setTimeout(() => el.classList.remove('show'), 450);
}

// Hit marker: white ticks on a confirmed hit, red on a kill.
let hitmarkerTimer = 0;
function showHitmarker(kill) {
  const el = $('hitmarker');
  el.classList.toggle('kill', !!kill);
  el.classList.add('show');
  clearTimeout(hitmarkerTimer);
  hitmarkerTimer = setTimeout(() => el.classList.remove('show'), kill ? 220 : 120);
}

// Screen shake (flat modes ONLY; never in VR, comfort rule).
let shakeT = 0, shakeAmp = 0;
function addShake(amp) {
  shakeAmp = Math.max(shakeAmp, amp);
  shakeT = 0.35;
}

// Big centre text with auto-hide.
let centerT = 0;
function showCenterText(text, seconds) {
  if (typeof clipDef !== 'undefined' && clipDef) return;   // clips stay clean
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
  isMapActive: () => mapActive,
  isModalOpen: () => shopOpen || !$('panel-gameover').classList.contains('hidden'),
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
  // Dressed zombies render through the same instanced horde as live play.
  const photoEntries = [];
  for (const [type, x, z, fx, fz, animT] of (PHOTO_ZOMBIES[PHOTOMODE] || [])) {
    photoEntries.push({
      x, y: level.heightAt(x, z), z, rotY: Math.atan2(fx - x, fz - z),
      type, animT, stagger: 0, flash: 0, fall: 0, sink: 0,
      scale: 0.93 + ((x * 13 + z * 7) % 10) / 70,   // deterministic variation
    });
  }
  updateAvatar('photobot', { p: [-2, level.floorY, -1], ry: 2.3, rx: 0, vr: false, hp: 100 });
  if (PHOTOMODE === 2) { nightTarget = 0; flashlightOn = true; }
  viewmodel.visible = PHOTOMODE === 8;   // no floating pistol in scenic shots
  const wantHud = applyPhotomode(PHOTOMODE, { camera, scene, level });
  if (PHOTOMODE === 2 && level.entries.length) {
    // Basement shot: a walker between the camera and the doorway it
    // stares at, lit by the flashlight cone.
    const e = level.entries[0];
    photoEntries.push({
      x: e.x * 0.45, y: 0, z: e.z * 0.45,
      rotY: Math.atan2(camera.position.x - e.x * 0.45, camera.position.z - e.z * 0.45),
      type: 'walker', animT: 0.8, stagger: 0, flash: 0, fall: 0, sink: 0, scale: 1,
    });
  }
  horde.update(photoEntries);
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
  $('menu-meta').textContent = meta.summaryLine();
}

// ---- Phase presentation -------------------------------------------------
// Applied whenever the observed wave phase changes (and once on entering
// playing). Idempotent, so a client joining mid-game lands correctly in
// night lighting, an open shop, or the gameover screen.
let presentedPhase = null;
let gameoverTimer = 0;
function presentPhase(ph) {
  presentedPhase = ph;
  switch (ph) {
    case 'lobby':
    case 'day':
      nightTarget = 0;
      closeShop();
      $('panel-gameover').classList.add('hidden');
      break;
    case 'countdown':
      nightTarget = 0;
      break;
    case 'night':
      nightTarget = clipDef ? 0 : 1;   // feel clips stay in daylight
      closeShop();
      break;
    case 'elevator':
      nightTarget = 0.35;
      closeShop();
      break;
    case 'ride':
      toggleMap(false);
      // The wagon has no shop: the ride just arrives.
      if (level.type === 'wagon') closeShop();
      else openShop();
      break;
    case 'finale':
      nightTarget = 0.0;    // dawn breaks over the roof: you made it
      toggleMap(false);
      closeShop();
      $('panel-gameover').classList.add('hidden');
      $('panel-victory').classList.add('hidden');
      break;
    case 'victory':
      toggleMap(false);
      closeShop();
      $('hud').classList.add('hidden');
      $('panel-victory').classList.remove('hidden');
      break;
    case 'gameover':
      toggleMap(false);
      closeShop();
      // A dying beat before the modal: the camera sinks first, THEN the
      // screen admits it (feel-critic: no hard cut from bite to menu).
      clearTimeout(gameoverTimer);
      gameoverTimer = setTimeout(() => {
        if (presentedPhase === 'gameover') {
          $('panel-gameover').classList.remove('hidden');
          $('hud').classList.add('hidden');
        }
      }, 2000);
      break;
    default:
      break;
  }
}

// ---- HUD phase text -----------------------------------------------------
function updateWaveHud(w) {
  if (!w) { hud.setWave('NIGHT 1'); return; }
  switch (w.ph) {
    case 'lobby': hud.setWave(role === 'client' ? 'WAITING FOR HOST' : 'NIGHT 1'); break;
    case 'day': hud.setWave(`FLOOR ${w.lv} - DAY - lay traps - night in ${w.t}s`); break;
    case 'countdown':
      hud.setWave(`NIGHT ${w.n + 1}`);
      showCenterText(String(w.t), 0.5);
      break;
    case 'night': hud.setWave(`NIGHT ${w.n} - ${w.left} left`); break;
    case 'elevator': hud.setWave('CLEARED - board the elevator'); break;
    case 'ride':
      hud.setWave(level.type === 'wagon'
        ? 'ARRIVING - floor ' + (w.lv + 1)
        : 'GOING UP - floor ' + (w.lv + 1));
      if (shopOpen && w.t !== lastRideT) { lastRideT = w.t; refreshShop(); }
      break;
    case 'finale': hud.setWave('EXTRACTION INBOUND'); break;
    case 'victory': hud.setWave('EXTRACTED'); break;
    case 'gameover': hud.setWave('GAME OVER'); break;
    default: hud.setWave('');
  }
}

// ---- Frame loop ---------------------------------------------------------
let last = performance.now();
let poseAccum = 0, snapAccum = 0, invAccum = 0;
let currentAmb = null;
let groanT = 3;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!PHOTOMODE && !UISTATE) {
    for (const input of inputs) input.update(dt);
    const inVR = !!(vrInput && vrInput.active);
    if (!inVR) {
      if (!isPlaying()) rig.yaw += dt * 0.02;  // slow menu drift
      // Recoil recovery: the kick eases back toward the aim point.
      if (recoilRecover > 0) {
        const rec = Math.min(recoilRecover, dt * 0.22);
        rig.pitch -= rec;
        recoilRecover -= rec;
      }
      rig.group.rotation.y = rig.yaw;
      camera.rotation.x = rig.pitch;
      // Screen shake (explosions), flat modes only.
      if (shakeT > 0) {
        shakeT -= dt;
        const k = shakeAmp * (shakeT / 0.35);
        camera.rotation.x += (Math.random() - 0.5) * k;
        camera.rotation.z = (Math.random() - 0.5) * k * 0.7;
        if (shakeT <= 0) shakeAmp = 0;
      }
      // Downed players sink to the floor with a sideways slump.
      const eyeTarget = myDown ? 0.55 : CONFIG.PLAYER_HEIGHT;
      camera.position.y += (eyeTarget - camera.position.y) * Math.min(1, dt * 2.4);
      const rollTarget = myDown ? 0.16 : 0;
      camera.rotation.z += (rollTarget - camera.rotation.z) * Math.min(1, dt * 2.4);
    }
    // ---- Ground and collision (real, not teleport-to-height) ---------
    // The input layers write into rig.group.position directly, so we treat
    // the frame's horizontal displacement as this frame's velocity and run
    // it through the character controller: step-up, slope, gravity, falls.
    const ref = inVR ? camera.getWorldPosition(tmpV) : rig.group.position;
    if (inVR) {
      const before = tmpV.clone();
      resolveCircle(tmpV, 0.3, blockingFor(level, rig.group.position.y));
      rig.group.position.x += tmpV.x - before.x;
      rig.group.position.z += tmpV.z - before.z;
    } else {
      resolveCircle(rig.group.position, LOCO.radius, blockingFor(level, rig.group.position.y));
    }
    // Vertical is honest for everyone: you step up, you walk down, and if
    // there is nothing under you, you fall.
    playerVel.x = 0; playerVel.z = 0;
    const grounded = moveAndCollide(
      level, rig.group.position, playerVel, dt, [], LOCO.radius);
    // Falling out of the world (off a balcony, into a chasm) is a death,
    // not an eternal descent.
    if (!grounded && rig.group.position.y < (level.baseY || 0) - 25) {
      rig.group.position.copy(level.playerSpawns[0]);
      playerVel.set(0, 0, 0);
      if (sim) sim.damagePlayer('H', 45);
      showToast('You fell.', 2200);
    }

    // Weapons: auto fire + reload timing, predicted locally.
    stepFeelClip(dt);
    const fireHeld = inputs.some((i) => i.fireHeld) || (clipDef && clipT < clipHoldUntil);
    const fireHeldR = inputs.some((i) => i.fireHeldR);
    arsenal.update(dt, fireHeld && canAct(), aimRay, fireHeldR && canAct());
    if (viewmodelKick > 0) viewmodelKick = Math.max(0, viewmodelKick - dt * 0.4);
    if (viewmodelKickL > 0) viewmodelKickL = Math.max(0, viewmodelKickL - dt * 0.4);

    // ---- Viewmodel pose: ADS, reload animation, per-hand recoil --------
    const a = arsenal.adsT;
    // Aiming pulls the gun to the centre of the view and closer in.
    const restX = 0.28, adsX = 0.055;
    const restY = -0.24, adsY = -0.105;
    const baseX = restX + (adsX - restX) * a;
    const baseY = restY + (adsY - restY) * a;
    const baseZ = -0.5 + (-0.12) * a;
    // Reload: the gun drops out of view, mag work, then snaps back up.
    // Every weapon has one now; the shape differs by reload length.
    let rlDrop = 0, rlRoll = 0, rlYaw = 0;
    if (arsenal.reloading && arsenal.reloadTotal > 0) {
      const p = 1 - arsenal.reloadT / arsenal.reloadTotal;   // 0..1
      const dip = Math.sin(Math.min(1, p * 1.25) * Math.PI);  // out and back
      rlDrop = dip * 0.2;
      rlRoll = dip * 0.85;
      rlYaw = dip * 0.3;
      // A shove at the moment the magazine seats.
      if (p > 0.55 && p < 0.68) rlDrop += 0.03;
    }
    viewmodel.position.set(baseX, baseY - rlDrop, baseZ + viewmodelKick);
    if (viewmodelSwingT <= 0) {
      viewmodel.rotation.set(-rlRoll * 0.6, rlYaw, rlRoll * 0.5);
    }
    if (viewmodelL) viewmodelL.position.z = viewmodelKickL;

    // ADS narrows the FOV: the classic "leaning in" read.
    const wantFov = 75 * (1 - a * (1 - TUNING.weapons.ads.fovMult));
    if (!inVR && Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
    }
    // Machete swing: a fast diagonal arc with follow-through.
    if (viewmodelSwingT > 0) {
      viewmodelSwingT = Math.max(0, viewmodelSwingT - dt);
      const p = 1 - viewmodelSwingT / 0.34;         // 0 -> 1 over the swing
      const arc = Math.sin(p * Math.PI);            // out and back
      viewmodel.rotation.set(-0.9 * arc, 0.5 * arc, -1.1 * arc);
      viewmodel.position.x = 0.28 - 0.22 * arc;
      viewmodel.position.y = -0.24 + 0.08 * arc;
    }

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
      lastWave = { ph: sim.wave.phase, n: sim.wave.night, lv: sim.wave.level, t: Math.ceil(sim.wave.t), left: sim.wave.left, mod: sim.mod || null };
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
      const GK = ['frag', 'smoke', 'molotov', 'spit'];
      for (const g of sim.grenades.values()) {
        grows.push([g.id, g.pos.x, g.pos.y, g.pos.z, GK.indexOf(g.kind || 'frag')]);
      }
      updateGrenadeVisuals(grows);
      const mrows = [];
      for (const m of sim.mines.values()) {
        mrows.push([m.id, m.pos.x, m.pos.y, m.pos.z]);
      }
      updateMineVisuals(mrows);
      const drows = [];
      for (const d of sim.drones.values()) {
        drows.push([d.id, d.pos.x, d.pos.y, d.pos.z,
          TRAP_KINDS.indexOf(d.payload || 'mine'), d.phase === 'home' ? 1 : 0]);
      }
      updateDroneVisuals(drows, dt);
      const trows = [];
      for (const t of sim.traps.values()) {
        trows.push([t.id, TRAP_KINDS.indexOf(t.kind), t.pos.x, t.pos.y, t.pos.z, t.t]);
      }
      updateTrapVisuals(trows, dt);
      const brows = [];
      for (const b of sim.barrels.values()) {
        brows.push([b.id, b.pos.x, b.pos.y, b.pos.z]);
      }
      updateBarrelVisuals(brows);
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
        updateMineVisuals(latest.ms || []);
        updateDroneVisuals(latest.ds || [], dt);
        updateTrapVisuals(latest.tr || [], dt);
        updateBarrelVisuals(latest.bs || []);
        // A joining client rebuilds the base wall from the snapshot, so
        // it never shows an intact wall the host knows is full of holes.
        if (latest.bw && level.baseWall) applyWallState(latest.bw);
      }
      // Stale-connection feedback (LESSONS.md).
      const stale = lastSnapAt > 0 && performance.now() - lastSnapAt > 4000;
      if (stale && !staleShown) { staleShown = true; showToast('Connection stalled, waiting for the host...', 0); }
      else if (!stale && staleShown) { staleShown = false; hideToast(); }
    }

    // Wave-driven presentation.
    if (isPlaying()) {
      if (lastWave && lastWave.ph !== presentedPhase) presentPhase(lastWave.ph);
      updateWaveHud(lastWave);
      updateBaseHud();
    }
    updateDayNight();
    updateNightVision(dt);
    updateFinale(dt);

    // Audio: listener follows the camera; ambience tracks level mood;
    // random horde groans keep the pressure audible.
    audio.updateListener(camera);
    const desiredAmb = !isPlaying() ? null : (level.lighting.dark ? 'dark' : 'day');
    if (desiredAmb !== currentAmb) { currentAmb = desiredAmb; audio.ambience(desiredAmb); }
    groanT -= dt;
    if (groanT <= 0) {
      groanT = 2.5 + Math.random() * 3.5;
      if (isPlaying() && zombieStates.size) {
        const arr = [...zombieStates.values()];
        const v = arr[(Math.random() * arr.length) | 0];
        audio.play('groan', v);
      }
    }
    // Elevator doors: open while boarding, closed otherwise. The cab lamp
    // flickers like the worn fluorescent it is.
    // PLAYTEST FIX: the doors used to shut before you could step in. They
    // now open whenever anyone is NEAR the cab (any phase) and stay open
    // for the whole boarding phase; they only close for the ride itself.
    let doorTarget = 0;
    if (lastWave && lastWave.ph === 'ride') {
      doorTarget = 0;
    } else if (lastWave && lastWave.ph === 'elevator') {
      doorTarget = 1;
    } else if (level.elevatorZone) {
      const ez = level.elevatorZone;
      const near = Math.hypot(rig.group.position.x - ez.x, rig.group.position.z - ez.z) < 5.0;
      doorTarget = near ? 1 : 0;
    }
    doorT += (doorTarget - doorT) * Math.min(1, dt * 3);
    if (level.elevator) {
      level.elevator.setDoors(doorT);
      level.elevator.lamp.intensity = 1.05
        + Math.sin(now * 0.011) * 0.06
        + (Math.random() < 0.015 ? -0.7 : 0);
    }
    // Dust motes drift around the player outdoors.
    if (dust.points.visible) dust.update(dt, camera.getWorldPosition(tmpV));
    // Moving-platform levels scroll their scenery.
    if (level.tick) level.tick(dt);
  }

  // Centre text timer.
  if (centerT > 0) {
    centerT -= dt;
    if (centerT <= 0) $('countdown').classList.add('hidden');
  }

  // Flashlight follows its toggle.
  flashlight.intensity += ((flashlightOn ? 15 : 0) - flashlight.intensity) * Math.min(1, dt * 10);
  beamMesh.material.opacity = (flashlight.intensity / 15) * (level.lighting.dark ? 0.055 : 0);

  updateMapMarkers();

  // Muzzle flash decay + explosion + ping VFX.
  if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - dt * 45);
  updateExplosions(dt);
  updatePings(dt);
  updateEffectVisuals(dt);
  updateCasings(dt);
  updateShotVfx(dt);

  renderer.render(scene, mapActive && !(vrInput && vrInput.active) ? mapCam : camera);
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
    for (const [id, v] of zombieStates) out.push({ id, type: v.type, pos: [v.x, v.y, v.z] });
    return out;
  },
  debugMove: (dx, dz) => { rig.group.position.x += dx; rig.group.position.z += dz; },
  debugTeleport: (x, z) => { rig.group.position.x = x; rig.group.position.z = z; },

  // Foundation bug 3 check: feed the VR rig a grip pose rotated away from the
  // aim ray (Touch controllers really are tilted this much) and report the
  // angle between where the gun points and where the bullet goes. It must be
  // ~0 after alignment, and it was ~45 before the fix.
  debugVRAim: (tiltDeg = 45) => {
    if (!vrInput || !vrInput.grips.length) return null;
    const tilt = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(tiltDeg), 0.3, 0));
    // three.js turns matrixAutoUpdate OFF on XR controller groups and writes
    // the pose straight into .matrix, decomposing it afterwards. A fake pose
    // has to do exactly the same or the world transform never moves.
    const pose = (obj, q) => {
      obj.matrix.compose(obj.position.set(0, 1.2, -0.3), q, obj.scale.set(1, 1, 1));
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      obj.matrixWorldNeedsUpdate = true;
    };
    for (let i = 0; i < vrInput.grips.length; i++) {
      pose(vrInput.grips[i], tilt);
      pose(vrInput.controllers[i], new THREE.Quaternion());
    }
    vrInput._alignWeapons();
    rig.group.updateMatrixWorld(true);
    const gunFwd = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(vrInput.gripWeapons[0].getWorldQuaternion(new THREE.Quaternion()));
    const rayFwd = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(vrInput.controllers[0].getWorldQuaternion(new THREE.Quaternion()));
    const rawFwd = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(vrInput.grips[0].getWorldQuaternion(new THREE.Quaternion()));
    const deg = (a, b) => THREE.MathUtils.radToDeg(a.angleTo(b));
    const m = vrInput._muzzle(vrInput.controllers[0]);
    return {
      offBy: deg(gunFwd, rayFwd),          // after the fix
      wasOffBy: deg(rawFwd, rayFwd),       // what the player used to see
      shotOffBy: deg(m.dir, rayFwd),
    };
  },
  forceNight: (n) => { if (sim) sim.forceNight(n); },
  debugClearNight: () => {
    if (!sim) return;
    sim.wave.queue = [];
    sim.zombies.clear();
  },
  debugGotoLevel: (n) => {
    if (sim) sim.wave.level = n;
    loadLevel(n);
  },
  // Jump straight to the final floor's boss night (ending test hook).
  debugGotoFinal: () => {
    if (!sim) return;
    sim.wave.level = FINAL_LEVEL;
    loadLevel(FINAL_LEVEL);
    sim.wave.nightInLevel = 0;
    sim.forceNight();
  },
  // radius: kill only what has arrived within `r` of the base, so a test
  // can measure whether zombies ARRIVE without also measuring whether an
  // immobile bot can kill them.
  debugKillAll: (r = 0) => {
    if (!sim) return;
    const c = r > 0 && level.baseCentre ? level.baseCentre : null;
    if (!c) sim.wave.queue = [];
    for (const z of [...sim.zombies.values()]) {
      if (c && Math.hypot(z.pos.x - c.x, z.pos.z - c.z) > r) continue;
      sim.damageZombie(z, 9999, false, 'H');
    }
  },
  levelType: () => level.type,

  // Holdout probe surface: spawn geometry, base integrity and where the
  // horde actually is relative to the base.
  holdout: () => {
    const wall = level.baseWall;
    if (!wall || !level.baseCentre) return null;
    const c = level.baseCentre;
    const hb = 4;
    const zs = sim ? [...sim.zombies.values()].filter((z) => z.alive) : [];
    let nearest = Infinity, inside = 0;
    for (const z of zs) {
      nearest = Math.min(nearest, Math.hypot(z.pos.x - c.x, z.pos.z - c.z));
      if (Math.abs(z.pos.x - c.x) < hb && Math.abs(z.pos.z - c.z) < hb) inside++;
    }
    return {
      spawns: level.spawnSources.map((s) => ({
        from: s.kind, dist: Math.hypot(s.x - c.x, s.z - c.z),
      })),
      state: {
        integrity: wall.integrity(),
        dead: wall.segments.filter((sg) => sg.dead).length,
        nearest: Number.isFinite(nearest) ? nearest : -1,
        inside, alive: zs.length,
      },
    };
  },
  // Drone probe: send one out with each payload and report what landed.
  // Confinement check: try to walk out of the base in every direction and
  // report how far you actually got from the base centre.
  // Level validator: find gaps between solids that are wider than zero
  // but narrower than a player can stand in. Those are traps: both boxes
  // push the player and they end up pinned, unable to move at all. This
  // is how the snipe ramp / elevator overlap was found.
  debugGaps: (pad = 0.02) => {
    const R = LOCO.radius;
    const solids = level.colliders.filter((c) => !c.playerOnly && !c.dead
      && (c.tall || (c.top !== undefined && c.top > LOCO.stepUp)));
    const bad = [];
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i], b = solids[j];
        // Gap along X, only when they actually overlap in Z (and v.v.).
        const zOverlap = Math.abs(a.z - b.z) < a.hz + b.hz - pad;
        const xOverlap = Math.abs(a.x - b.x) < a.hx + b.hx - pad;
        if (zOverlap) {
          const gap = Math.abs(a.x - b.x) - a.hx - b.hx;
          if (gap > pad && gap < R * 2 + 0.08) {
            bad.push({ axis: 'x', gap: +gap.toFixed(2), at: [+((a.x + b.x) / 2).toFixed(1), +((a.z + b.z) / 2).toFixed(1)] });
          }
        }
        if (xOverlap) {
          const gap = Math.abs(a.z - b.z) - a.hz - b.hz;
          if (gap > pad && gap < R * 2 + 0.08) {
            bad.push({ axis: 'z', gap: +gap.toFixed(2), at: [+((a.x + b.x) / 2).toFixed(1), +((a.z + b.z) / 2).toFixed(1)] });
          }
        }
      }
    }
    // Also flag solids that overlap the walkable ramp lane: a ramp you
    // cannot use is worse than no ramp.
    const onRamp = [];
    for (const r of level.ramps || []) {
      for (const c of solids) {
        if (Math.abs(r.x - c.x) < r.hx + c.hx - 0.05 && Math.abs(r.z - c.z) < r.hz + c.hz - 0.05) {
          onRamp.push({ at: [+r.x.toFixed(1), +r.z.toFixed(1)] });
        }
      }
    }
    return { gaps: bad, blockedRamp: onRamp, solids: solids.length };
  },
  // The behavioural version of the gap check, and the one that matters:
  // stand at every point in the base and try to walk to the middle. Any
  // start that cannot get there is a pocket the player can be pinned in.
  // Pairwise geometry checks over-report (a tiled wall run looks full of
  // gaps); this asks the actual question.
  // Every spawn point must have a real route to the base, or a night
  // never ends: one zombie sits behind a wall and the counter sticks.
  baseCentre: () => (level.baseCentre ? [level.baseCentre.x, 0, level.baseCentre.z] : null),
  debugSpawnRoutes: () => {
    if (!sim || !level.baseCentre) return null;
    const nav = sim._nav();
    const c = level.baseCentre;
    return level.zombieSpawns.map((s, i) => {
      const src = level.spawnSources[i] || {};
      const [fx, fz] = nav.nearestFree(s.x, s.z);
      const moved = Math.hypot(nav.worldX(fx) - s.x, nav.worldZ(fz) - s.z);
      const path = nav.findPath(s.x, s.z, c.x, c.z);
      const end = path && path.length ? path[path.length - 1] : null;
      const reach = end ? Math.hypot(end.x - c.x, end.z - c.z) : Infinity;
      return {
        from: src.kind || '?', at: [+s.x.toFixed(0), +s.z.toFixed(0)],
        // How far the spawn had to be nudged to land on a free cell: a
        // big number means it is buried inside a sight blocker.
        nudged: +moved.toFixed(1),
        // How close the best path gets to the base. Anything much over
        // the base half-size means it cannot get there.
        reaches: Number.isFinite(reach) ? +reach.toFixed(1) : -1,
      };
    });
  },

  // The floor in front of the lift doors must be free and reachable.
  debugBoarding: () => {
    const z = level.elevatorZone;
    if (!z || !level.baseCentre) return null;
    const blockers = level.colliders.filter((c) => !c.playerOnly && !c.dead
      && (c.tall || (c.top !== undefined && c.top > LOCO.stepUp))
      && Math.abs(c.x - z.x) < c.hx + z.hx - 0.05 && Math.abs(c.z - z.z) < c.hz + z.hz - 0.05);
    // Can you actually walk from the middle of the base to the zone?
    const c = level.baseCentre;
    const save = rig.group.position.clone();
    rig.group.position.set(c.x, level.heightAt(c.x, c.z), c.z);
    playerVel.set(0, 0, 0);
    for (let i = 0; i < 150; i++) {
      const dx = z.x - rig.group.position.x, dz = z.z - rig.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) break;
      playerVel.set((dx / d) * 5, playerVel.y, (dz / d) * 5);
      moveAndCollide(level, rig.group.position, playerVel, 1 / 60, [], LOCO.radius);
      resolveCircle(rig.group.position, LOCO.radius, blockingFor(level, rig.group.position.y));
    }
    const got = Math.hypot(rig.group.position.x - z.x, rig.group.position.z - z.z);
    rig.group.position.copy(save);
    return { blockers: blockers.length, walkedToWithin: +got.toFixed(2) };
  },

  debugPockets: (step = 0.4) => {
    const c = level.baseCentre;
    if (!c) return null;
    const hb = 4 - 0.4;
    const stuck = [];
    let tested = 0;
    const save = rig.group.position.clone();
    for (let x = c.x - hb; x <= c.x + hb; x += step) {
      for (let z = c.z - hb; z <= c.z + hb; z += step) {
        // Skip starts that are inside a solid: you can never be there.
        rig.group.position.set(x, level.heightAt(x, z), z);
        resolveCircle(rig.group.position, LOCO.radius, blockingFor(level, rig.group.position.y));
        if (Math.hypot(rig.group.position.x - x, rig.group.position.z - z) > 0.45) continue;
        tested++;
        playerVel.set(0, 0, 0);
        // Walk toward the middle, and slide sideways when blocked: a real
        // player goes AROUND a crate rather than pressing into it, and
        // without this the test flags every obstacle as a pocket.
        let slide = 0, slideDir = 1;
        for (let i = 0; i < 160; i++) {
          const dx = c.x - rig.group.position.x, dz = c.z - rig.group.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.2) break;
          let vx = dx / d, vz = dz / d;
          if (slide > 0) { const t = vx; vx = -vz * slideDir; vz = t * slideDir; slide--; }
          playerVel.set(vx * 5, playerVel.y, vz * 5);
          const bx = rig.group.position.x, bz = rig.group.position.z;
          moveAndCollide(level, rig.group.position, playerVel, 1 / 60, [], LOCO.radius);
          resolveCircle(rig.group.position, LOCO.radius, blockingFor(level, rig.group.position.y));
          const moved = Math.hypot(rig.group.position.x - bx, rig.group.position.z - bz);
          if (moved < 0.02 && slide === 0) { slide = 22; slideDir = -slideDir; }
        }
        const d = Math.hypot(rig.group.position.x - c.x, rig.group.position.z - c.z);
        if (d > 1.6) stuck.push({ from: [+x.toFixed(1), +z.toFixed(1)], endedAt: +d.toFixed(1) });
      }
    }
    rig.group.position.copy(save);
    return { tested, stuck };
  },

  debugRamps: () => (level.ramps || []).map((r) => ({
    x: +r.x.toFixed(2), z: +r.z.toFixed(2), top: +r.top.toFixed(2),
    hx: +r.hx.toFixed(2), hz: +r.hz.toFixed(2),
  })),
  debugHeightAt: (x, z) => level.heightAt(x, z),
  debugEscape: (dirIdx, steps = 60) => {
    const c = level.baseCentre;
    if (!c) return null;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    const [dx, dz] = dirs[dirIdx % dirs.length];
    rig.group.position.set(c.x, level.heightAt(c.x, c.z), c.z);
    playerVel.set(0, 0, 0);
    for (let i = 0; i < steps; i++) {
      playerVel.set(dx * 6, playerVel.y, dz * 6);
      moveAndCollide(level, rig.group.position, playerVel, 1 / 60, [], LOCO.radius);
      resolveCircle(rig.group.position, LOCO.radius, blockingFor(level, rig.group.position.y));
    }
    const p = rig.group.position;
    return { dx, dz, out: Math.max(Math.abs(p.x - c.x), Math.abs(p.z - c.z)) };
  },
  debugDrone: (kind, x, z) => {
    if (!sim) return null;
    for (const p of sim.players.values()) p.inv.s = 9999;
    dispatchAction({ t: 'drone', p: [x, 0, z], k: kind });
    return true;
  },
  debugField: () => {
    if (!sim) return null;
    return {
      drones: [...sim.drones.values()].map((d) => ({ k: d.payload, ph: d.phase })),
      traps: [...sim.traps.values()].map((t) => ({
        k: t.kind, x: +t.pos.x.toFixed(1), z: +t.pos.z.toFixed(1), left: +t.t.toFixed(0),
      })),
      mines: [...sim.mines.values()].map((m) => ({ x: +m.pos.x.toFixed(1), z: +m.pos.z.toFixed(1) })),
      trapMeshes: trapVisuals.size,
      scrap: sim.players.get('H')?.inv.s ?? -1,
    };
  },
  debugRepairAll: () => {
    const wall = level.baseWall;
    if (!wall || !sim) return null;
    const before = wall.integrity();
    const deadBefore = wall.segments.filter((s) => s.dead).length;
    for (const p of sim.players.values()) p.inv.s = 9999;
    sim.wave.phase = 'day';
    for (let pass = 0; pass < 3; pass++) {
      for (const seg of wall.segments) sim.repairBaseWall('H', seg.index);
    }
    return {
      before, after: wall.integrity(),
      deadBefore, deadAfter: wall.segments.filter((s) => s.dead).length,
    };
  },
  debugMap: (on) => toggleMap(on),
  elevatorZone: () => (level.elevatorZone ? { x: level.elevatorZone.x, z: level.elevatorZone.z } : null),
  shopOpen: () => shopOpen,
  debugShootZombie: () => {
    // Nearest zombie, not "first in the map" (the old behaviour made the
    // pressure probe shoot at distant targets while being eaten).
    const o0 = camera.getWorldPosition(new THREE.Vector3());
    let first = null, bd = Infinity;
    for (const v of zombieStates.values()) {
      const d = (v.x - o0.x) ** 2 + (v.z - o0.z) ** 2;
      if (d < bd) { bd = d; first = v; }
    }
    if (!first) return false;
    const c = new THREE.Vector3(first.x, first.y + 1.1, first.z);
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = c.sub(o).normalize();
    arsenal.fire(o, d);
    return true;
  },
  items: () => [...itemVisuals.keys()],
  debugHeal: () => {
    if (!sim) return;
    const p = sim.players.get('H');
    if (p) { p.hp = TUNING.player.maxHp; p.down = false; myHp = p.hp; myDown = false; }
  },
  debugGrant: (w) => {
    if (!sim) return;
    const p = sim.players.get('H');
    if (!p.inv.w.includes(w)) {
      p.inv.w.push(w);
      p.inv.a[w] = [TUNING.weapons[w].magazine, 999];
    }
    arsenal.syncFromHost(p.inv);
    arsenal.switchTo(w);
  },
  barrels: () => {
    const out = [];
    for (const [id, g] of barrelVisuals) out.push({ id, pos: g.position.toArray() });
    return out;
  },
  debugShootAt: (x, y, z) => {
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = new THREE.Vector3(x, y, z).sub(o).normalize();
    arsenal.fire(o, d);
  },
  renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
};

// ---- Feel clips (?feelclip=N): scripted deterministic gameplay ----------
const FEELCLIP = parseInt(PARAMS.get('feelclip') || '0', 10) || 0;
const clipDef = FEEL_CLIPS[FEELCLIP];
let clipT = 0, clipIdx = 0, clipHoldUntil = 0, clipDone = false;
let clipZid = 9000;
const clipApi = {
  spawnAt(type, x, z) {
    const stats = TUNING.enemies[type];
    sim.zombies.set(clipZid, {
      id: clipZid++, type,
      pos: new THREE.Vector3(x, level.heightAt(x, z), z),
      hp: stats.hp, alive: true, biteT: 0, targetId: null, retargetT: 0, stuckT: 0,
    });
  },
  grant(w) {
    const p = sim.players.get('H');
    if (!p.inv.w.includes(w)) {
      p.inv.w.push(w);
      p.inv.a[w] = [TUNING.weapons[w].magazine, 999];
    }
    arsenal.syncFromHost(p.inv);
    arsenal.switchTo(w);
  },
  equip(w) { arsenal.switchTo(w); },
  aim() {
    let best = null, bd = Infinity;
    for (const z of sim.zombies.values()) {
      const d = z.pos.distanceToSquared(rig.group.position);
      if (d < bd) { bd = d; best = z; }
    }
    if (!best) return;
    const dx = best.pos.x - rig.group.position.x;
    const dz = best.pos.z - rig.group.position.z;
    rig.yaw = Math.atan2(-dx, -dz);
    const dist = Math.hypot(dx, dz);
    const targetY = best.pos.y + (best.type === 'brute' ? 1.2 : 1.0);
    rig.pitch = Math.atan2(targetY - (rig.group.position.y + CONFIG.PLAYER_HEIGHT), dist);
  },
  fire() { actions.fire(); },
  hold(sec) { clipHoldUntil = clipT + sec; },
  throwGrenade() { actions.grenade(); },
  pitchDown(d) { rig.pitch = -Math.abs(d); },
  setHp(n) {
    const p = sim.players.get('H');
    p.hp = n; myHp = n; hud.setHealth(n);
  },
};
function stepFeelClip(dt) {
  if (!clipDef || !isPlaying() || clipDone) return;
  clipT += dt;
  const acts = clipDef.actions;
  while (clipIdx < acts.length && acts[clipIdx][0] <= clipT) {
    acts[clipIdx][1](clipApi);
    clipIdx++;
  }
  if (clipT >= clipDef.duration) clipDone = true;
}

// Smoke test hooks + feel-clip boot.
if (PARAMS.get('autohost')) startHosting();
else if (PARAMS.get('autojoin')) startJoining(PARAMS.get('autojoin').toUpperCase());
else if (clipDef) {
  startSolo();
  // A held night: zombies act, the sentinel queue entry never spawns
  // (spawnT stays at Infinity), and the night never clears mid-clip.
  sim.wave.phase = 'night';
  sim.wave.queue = ['walker'];
  sim.wave.spawnT = Infinity;
  sim.wave.night = 1;
  centerT = 0;
  $('countdown').classList.add('hidden');
}
window.__zhr.clipDone = () => clipDone;
