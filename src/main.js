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
import { LOCO, moveAndCollide, blockingFor } from './game/locomotion.js';
import { CharacterController, BODY } from './game/controller.js';
import { NavGrid } from './game/navgrid.js';
import { voidBlocker } from './world/levelkit.js';
import { overrideSpec, specUrl } from './world/levels/index.js';
import { LevelHotReload } from './views/hotreload.js';
import { InteractionLayer } from './world/interact.js';
import { DebugMenu } from './world/debugmenu.js';
import { StrategyView } from './world/strategy.js';
import { setDoorOpen } from './world/traverse.js';
import { makeAvatarMesh, makeNameTag, AVATAR_COLORS, SHARED_MATERIALS } from './world/actors.js';
import { applyPhotomode, PHOTO_ZOMBIES } from './views/photomode.js';
import { applyLevelPreview } from './views/levelpreview.js';
import { FEEL_CLIPS } from './views/feelclips.js';
import { Net } from './net/net.js';
import { msg } from './net/protocol.js';
import { HostSim, ZOMBIE_TYPES, ITEM_KINDS, TRAP_KINDS, DRONE_LOADS, zombieRow } from './game/state.js';
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
// The FLAT player's torch: an eye-mounted cone, because a flat player has
// no hand to carry one from. Auto-on in dark levels, F toggles it. Never
// lit in VR, where the light comes from the off hand instead.
const flashlight = new THREE.SpotLight(0xd8e8ff, 0, 26, 0.62, 0.7, 1.0);
const flashlightTarget = new THREE.Object3D();
flashlightTarget.position.set(0, 0, -6);
camera.add(flashlight, flashlightTarget);
flashlight.position.set(0, 0.05, 0.05);
flashlight.target = flashlightTarget;
let flashlightOn = false;
// Is the main weapon on the hip? Set by the VR holster gesture. A
// holstered weapon cannot fire, which the VR layer enforces on its own
// side too, and it is what frees a hand to point at the strategy map.
let holstered = false;
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
// ?levelpreview=N boots straight into a labelled top-down view of that
// level, without playing it. Ola: "five seconds instead of five minutes
// changes how many sketches I can try."
const LEVELPREVIEW = PARAMS.get('levelpreview')
  ? Math.max(1, parseInt(PARAMS.get('levelpreview'), 10) || 1) : 0;
// ?hot=1 watches the level data files and rebuilds the current floor
// when one changes, without restarting the run. Dev only; nothing polls
// in a normal session.
const HOT = PARAMS.get('hot') === '1';
let levelIndex = LEVELPREVIEW || (PHOTOMODE ? (PHOTO_LEVEL[PHOTOMODE] || 1) : 1);
let level = buildLevel(scene, QUALITY, runSeed, levelIndex);
let doorT = 0;   // elevator doors 0 closed .. 1 open (visual)

// ---- Hot reload of level data (?hot=1) --------------------------------
//
// Rebuild the CURRENT floor from a freshly edited data file without
// restarting the run: same phase, same wave, same scrap, same inventory,
// and you keep standing where you were standing if that spot still
// exists. The point is to change a number and see it, not to play the
// level again.
let hotReload = null;
let hotCount = 0;
let hotError = '';

function rebuildLevelInPlace() {
  const wasAt = { x: rig.group.position.x, z: rig.group.position.z };
  const wasYaw = rig.yaw;
  disposeLevel(scene, level);
  clearTransientVisuals();
  level = buildLevel(scene, QUALITY, runSeed, levelIndex);
  applyLevelLighting(level);
  if (sim) sim.setLevel(level);
  rebuildEntryArrows();
  toggleMap(false);
  // Stay put if the new layout still has floor there. If the edit moved a
  // wall through you, the spawn plate is the honest fallback: being left
  // inside a new wall is the one outcome that would make this useless.
  const g = level.heightAt(wasAt.x, wasAt.z);
  const inside = level.playBounds
    && wasAt.x > level.playBounds.minX && wasAt.x < level.playBounds.maxX
    && wasAt.z > level.playBounds.minZ && wasAt.z < level.playBounds.maxZ;
  if (Number.isFinite(g) && inside) placePlayer(wasAt.x, wasAt.z);
  else {
    const s = level.playerSpawns[0];
    placePlayer(s.x, s.z);
  }
  rig.yaw = wasYaw;
  rig.group.rotation.y = wasYaw;
  // In preview mode the labelled overlay is built FROM the level, so it
  // has to be rebuilt with it or it describes the layout you just
  // replaced. Which would be worse than no preview.
  if (preview) {
    const old = document.getElementById('levelpreview');
    if (old) old.remove();
    preview = applyLevelPreview(level, { scene, camera, renderer });
  }
  hotCount++;
}

function startHotReload() {
  if (hotReload) return hotReload;
  hotReload = new LevelHotReload({
    specPath: (i) => specUrl(i),
    apply: (i, spec) => {
      overrideSpec(i, spec);
      hotError = '';
      if (i === levelIndex) rebuildLevelInPlace();
      showToast(`Level ${i} reloaded`, 1200);
    },
    onError: (e) => {
      // A half-typed file is the normal case while editing. Say what is
      // wrong and keep watching rather than dying on a stray comma.
      hotError = String(e && e.message ? e.message : e);
      showToast(`Level data error: ${hotError}`, 3200);
      console.warn('[hot]', e);
    },
  });
  return hotReload;
}

function loadLevel(idx) {
  // The map belongs to the level it was opened on. Carrying it across a
  // level change leaves a picture of somewhere you are no longer standing
  // in front of your face.
  if (strategy && strategy.open) toggleStrategy(false);
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
  placePlayer(spawn.x, spawn.z);
  rig.group.rotation.y = rig.yaw = 0;
  // VR re-center: put the HEAD on the level's marked ROOMSCALE ZONE, so a
  // roomscale player's real floor maps onto the patch of level that is
  // sized for their room. The level itself stays big around them; they
  // shoot far and walk near (the elevator trick from the vision doc).
  if (vrInput && vrInput.active) {
    const rz = level.roomZone;
    if (rz) placePlayer(rz.x, rz.z);
    rig.group.position.x -= camera.position.x;
    rig.group.position.z -= camera.position.z;
    controller.pos.x = rig.group.position.x;
    controller.pos.z = rig.group.position.z;
  }
  if (sim) sim.setLevel(level);
  rebuildEntryArrows();
  if (HOT) startHotReload().watch(idx);
}

// ---- Player rig ---------------------------------------------------------
const rig = { group: new THREE.Group(), yaw: 0, pitch: 0, camera };

// THE ONE WAY THE PLAYER IS PLACED. Setting the rig position by hand left
// the controller believing the player was still somewhere else, which is
// how a body ends up half inside geometry with no way out.
function placePlayer(x, z, y = null) {
  controller.place(level, x, z, y);
  rig.group.position.copy(controller.pos);
  playerVel.set(0, 0, 0);
}
const playerVel = new THREE.Vector3();   // legacy scratch, probes only
// ONE controller. Everything that moves the local player goes through it.
const controller = new CharacterController();
let probeDrivesMovement = false;   // a movement probe has taken the wheel
let preview = null;                // ?levelpreview=N: a diagram, not a game
camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
rig.group.add(camera);
rig.group.position.copy(level.playerSpawns[0] || new THREE.Vector3());
controller.pos.copy(rig.group.position);
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
const tmpV2 = new THREE.Vector3();
const vrFeet = new THREE.Vector3();   // where the VR player's feet actually are
const tmpQ = new THREE.Quaternion();


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
    const [id, ti, x, y, z, , atk] = r;
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
    // The hammer runs on its own clock so every zombie on the wall is not
    // swinging in lockstep, which would read as one animation on twenty
    // bodies rather than a crowd tearing at a barricade.
    v.attacking = !!atk;
    if (v.attacking) v.swingT = (v.swingT || Math.random() * 3) + dt * 7.5;
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
      swing: v.attacking ? (v.swingT || 0) : 0,
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
function ensureAvatar(id, name) {
  let a = avatars.get(id);
  if (!a) {
    const colour = AVATAR_COLORS[avatarColorIdx++ % AVATAR_COLORS.length];
    a = makeAvatarMesh(colour);
    a.userData.colour = colour;
    avatars.set(id, a);
    scene.add(a);
  }
  // The name tag is rebuilt only when the name changes, which is once.
  if (name && a.userData.tagName !== name) {
    a.userData.tagName = name;
    if (a.userData.tag) removeAndDispose(a.userData.tag);
    const tag = makeNameTag(name, a.userData.colour);
    a.add(tag);
    a.userData.tag = tag;
  }
  return a;
}

// Two-bone IK. Point the upper segment so that the chain from `root` can
// reach `goal`, bending at the elbow. This is what turns a head and two
// tracked hands into something that reads as a person: without it the
// hands float in formation beside a torso and the illusion never lands.
const IK_A = new THREE.Vector3();
const IK_B = new THREE.Vector3();
function solveTwoBone(upper, fore, goalLocal, upperLen, foreLen) {
  IK_A.copy(goalLocal).sub(upper.position);
  const dist = Math.min(IK_A.length(), (upperLen + foreLen) * 0.999);
  if (dist < 1e-4) return;
  IK_A.normalize();
  // Law of cosines for the shoulder angle off the straight line to the goal.
  const cos = Math.max(-1, Math.min(1,
    (upperLen * upperLen + dist * dist - foreLen * foreLen) / (2 * upperLen * dist)));
  const bend = Math.acos(cos);
  // Aim the whole chain at the goal, then swing the upper bone out by the
  // bend angle around an axis that puts the elbow behind and below.
  upper.lookAt(IK_B.copy(upper.position).add(IK_A));
  upper.rotateX(bend);
  // The forearm closes the remaining angle back toward the goal.
  const cos2 = Math.max(-1, Math.min(1,
    (upperLen * upperLen + foreLen * foreLen - dist * dist) / (2 * upperLen * foreLen)));
  fore.position.set(0, 0, -upperLen);
  fore.rotation.set(-(Math.PI - Math.acos(cos2)), 0, 0);
}
// Stand-in avatars a probe has asked to keep alive. Empty in a real game.
const debugKeepAvatars = new Set();
function pruneAvatars(keepIds) {
  for (const [id, a] of avatars) {
    if (keepIds.has(id) || debugKeepAvatars.has(id)) continue;
    removeAndDispose(a);
    avatars.delete(id);
  }
}
const UPPER_LEN = 0.26, FORE_LEN = 0.26;
function updateAvatar(id, p, dt = 1 / 60) {
  const a = ensureAvatar(id, p.name);
  const parts = a.userData.parts;
  a.position.fromArray(p.p);
  a.rotation.y = p.ry || 0;
  parts.head.rotation.x = p.rx || 0;
  // Downed players lie flat.
  a.rotation.x = p.down ? -Math.PI / 2 * 0.9 : 0;
  if (a.userData.tag) {
    // The tag stays upright and faces the reader whatever the body does.
    a.userData.tag.quaternion.copy(camera.getWorldQuaternion(tmpQ));
    a.userData.tag.position.y = p.down ? 0.7 : 1.92;
  }

  const isVR = !!(p.vr && p.h);
  if (isVR) {
    a.updateMatrixWorld(true);
    // Head height comes from the headset, and the torso stretches to meet
    // it, so a crouching teammate reads as crouching.
    const headY = Math.max(0.6, p.h.p[1] - p.p[1]);
    parts.head.position.y = headY;
    parts.body.position.y = headY - 0.49;
    parts.collar.position.y = headY - 0.17;
    parts.strap.position.y = headY - 0.41;
    a.getWorldQuaternion(tmpQ).invert();
    for (const side of ['L', 'R']) {
      const arm = parts.arms[side];
      const data = side === 'L' ? p.hl : p.hr;
      arm.upper.position.y = headY - 0.23;
      if (!data) {
        // Untracked hand: rest the arm at the side rather than leaving it
        // pointing wherever it happened to be.
        arm.upper.rotation.set(-Math.PI / 2, 0, 0);
        arm.fore.rotation.set(0, 0, 0);
        arm.fore.position.set(0, 0, -UPPER_LEN);
        arm.hand.position.set(side === 'L' ? -0.22 : 0.22, arm.upper.position.y - 0.5, 0);
        arm.hand.quaternion.identity();
        continue;
      }
      arm.hand.position.copy(a.worldToLocal(tmpV.fromArray(data.p)));
      arm.hand.quaternion.fromArray(data.q).premultiply(tmpQ);
      solveTwoBone(arm.upper, arm.fore, arm.hand.position, UPPER_LEN, FORE_LEN);
    }
  } else {
    parts.head.position.y = 1.55;
    parts.body.position.y = 1.06;
    parts.collar.position.y = 1.38;
    parts.strap.position.y = 1.14;
    // A flat player has no tracked hands, so the arms swing with the walk.
    const moved = tmpV.fromArray(p.p).distanceTo(parts.lastPos);
    parts.lastPos.fromArray(p.p);
    const speed = Math.min(1, moved / (dt * 4.5));
    parts.strideT += dt * (2 + speed * 7);
    const swing = Math.sin(parts.strideT) * 0.7 * speed;
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      const arm = parts.arms[side];
      arm.upper.rotation.set(-Math.PI / 2 + swing * sign * 0.5, 0, 0);
      arm.fore.rotation.set(0.45 + Math.max(0, swing * sign) * 0.4, 0, 0);
      arm.fore.position.set(0, 0, -UPPER_LEN);
      arm.hand.position.set(0, 0, 0);
      arm.hand.quaternion.identity();
      arm.upper.updateMatrixWorld(true);
      arm.fore.localToWorld(tmpV.set(0, 0, -FORE_LEN));
      arm.hand.position.copy(a.worldToLocal(tmpV));
    }
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      const leg = parts.legs[side];
      leg.thigh.rotation.set(-Math.PI / 2 + swing * sign * 0.75, 0, 0);
      leg.shin.rotation.set(-Math.max(0, swing * sign) * 0.9, 0, 0);
    }
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
  for (const [id, ki, x, y, z, field] of rows) {
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
      // A crate out in the field needs a beacon: it has to be findable
      // from inside the base at forty metres, and it must read as "send
      // the drone", not "walk over and grab it".
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.22, 9, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x6fd0ff, transparent: true, opacity: 0.24,
          depthWrite: false, side: THREE.DoubleSide,
        }));
      beam.position.y = 4.5;
      beam.name = 'beacon';
      beam.visible = false;
      group.add(beam);
      v = { group, ring, beam, kind: ITEM_KINDS[ki], bobT: Math.random() * 6 };
      itemVisuals.set(id, v);
      scene.add(v.group);
    }
    v.bobT += dt * 2;
    v.group.position.set(x, y + 0.12 + Math.sin(v.bobT) * 0.06, z);
    v.group.rotation.y += dt * 1.2;
    // Ring stays glued to the ground while the item bobs.
    v.ring.position.y = -(v.group.position.y - y) + 0.02;
    if (v.beam) {
      v.beam.visible = !!field;
      if (field) {
        v.beam.material.opacity = 0.18 + 0.1 * Math.sin(v.bobT * 1.6);
        v.beam.position.y = 4.5 - (v.group.position.y - y);
      }
    }
    v.ring.material.color.setHex(field ? 0x6fd0ff : 0xe0a33c);
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
    const kind = DRONE_LOADS[kindIdx ?? 0] || 'mine';
    // A fetch drone flies out empty and comes back carrying.
    const want = (empty || kind === 'fetch') ? null : kind;
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
// The three ways a stopped run can move forward. They are functions, not
// click handlers, because VR has no DOM: the same three actions have to be
// reachable from a face button inside the headset.
function actRetryLevel() {
  $('panel-gameover').classList.add('hidden');
  if (!sim) { leaveToMenu(); return; }   // clients cannot restart; the host does
  sim.restartLevel();
  // AND PUT THE LOCAL PLAYER BACK ON THEIR FEET, HERE. The simulation
  // already did it and announced it, but Ola reports pressing A in the
  // headset and staying dead, and a restart that depends on an event
  // arriving is a restart that can fail silently. This cannot.
  forceLocalRevive();
}

// Everything that makes the local player playable again, in one place and
// depending on nothing being delivered.
function forceLocalRevive() {
  setDowned(false);
  myHp = TUNING.player.maxHp;
  hud.setHealth(myHp);
  updateLowHpVignette();
  arsenal.cancelReload();
  const spawn = (level.playerSpawns && level.playerSpawns[0]) || { x: 0, z: 0 };
  placePlayer(spawn.x, spawn.z);
  if (sim) {
    const p = sim.players.get('H');
    if (p) { p.down = false; p.hp = TUNING.player.maxHp; p.reviveT = 0; }
  }
}
function actNewRun() {
  $('panel-victory').classList.add('hidden');
  $('panel-gameover').classList.add('hidden');
  if (!sim) { leaveToMenu(); return; }
  forceLocalRevive();
  clearFinale();
  runSeed = ((Math.random() * 1e9) >>> 0);
  loadLevel(1);
  sim.newRun();
  $('hud').classList.remove('hidden');
}
function actQuitToMenu() {
  $('panel-gameover').classList.add('hidden');
  $('panel-victory').classList.add('hidden');
  leaveToMenu();
}
$('btn-go-retry').addEventListener('click', actRetryLevel);
$('btn-go-lobby').addEventListener('click', actQuitToMenu);
$('btn-win-again').addEventListener('click', actNewRun);
$('btn-win-lobby').addEventListener('click', actQuitToMenu);

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

let vrReloadHint = 0;

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
let recoilHoldT = 0;     // recovery waits until the trigger has been still

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
      muzzle: (o, d, w, hand, kick = null) => {
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
        const kickUp = kick ? kick.up : 0.012;
        const kickSide = kick ? kick.side : 0;
        if (!(vrInput && vrInput.active)) {
          // Mouse and stick: recoil moves the aim, and the player pulls
          // back down. The vertical climb is identical every burst and the
          // horizontal follows the weapon's fixed pattern, so it can be
          // learned and compensated rather than merely endured.
          rig.pitch += kickUp;
          rig.yaw += kickSide;
          recoilRecover += kickUp * TUNING.weapons.recoil.recover;
          recoilHoldT = TUNING.weapons.recoil.recoverDelay;
          const heat = arsenal.heat || 0;
          if (TUNING.weapons[w] && TUNING.weapons[w].auto) addShake(0.004);
          if (w === 'shotgun') addShake(0.014 + heat * 0.02);
        } else if (vrInput) {
          // VR: the controller IS the aim, so moving it would fight the
          // player's own hand and feel broken. Recoil is a visible kick on
          // the weapon model, and the accuracy cost lands entirely in
          // spread, which has already grown with heat. Same skill curve
          // (pace your shots), nothing wrestling your arm.
          vrInput.addRecoil(hand, kickUp);
        }
        spawnCasing(o, d);
      },
      swing: () => { viewmodelSwingT = 0.34; spawnSwingTrail(); audio.play('machete'); },
      throw: () => audio.play('throw'),
      reload: () => audio.play('reload'),
      magSeated: () => {
        audio.play('magseat');
        // Visual confirmation on every screen there is: the flat
        // viewmodel snaps up, the ammo readout flashes READY, and the VR
        // weapon's charge light goes green (handled in vr.js). A sound
        // and a small kick are easy to miss with a horde in front of you.
        viewmodelKick = 0.045;
        hud.flashReady();
      },
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
  // How far through the VR "point the gun down" reload gesture we are,
  // 0..1. Drives the visible charge on the weapon so the gesture has
  // feedback before it fires, not only after.
  setReloadHint: (t) => { vrReloadHint = t; },
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
  // ---- The strategy view ----
  strategy: (on) => toggleStrategy(on),
  strategyCentre: () => (strategy && strategy.open
    ? strategy.group.position.toArray() : null),
  // Called every frame while the panel is open with the ray from the
  // pointing hand. Everything the panel says about what will happen is
  // decided here, so the label can never promise something the action
  // then refuses.
  strategyPoint: (origin, dir) => {
    const s = strategy;
    if (!s || !s.open) return;
    const hit = s.hitTest(origin, dir);
    s.cursor = hit;
    if (!hit) {
      s.label = 'POINT AT THE MAP';
      s.hint = 'trigger places a drone target';
      s.blocked = false;
      return;
    }
    const w = panelToWorld(hit.u, hit.v);
    const grounded = level.droneAllowed === false;
    const cost = dronePayloadCost(dronePayload);
    s.blocked = grounded || scrap < cost;
    s.label = grounded
      ? 'NO SIGNAL DOWN HERE'
      : `DRONE: ${dronePayload === 'fetch' ? 'FETCH LOOT' : PAYLOAD_LABEL[dronePayload]}`
        + `  ${w.x.toFixed(0)}, ${w.z.toFixed(0)}`;
    s.hint = grounded
      ? 'the drone stays topside'
      : scrap < cost
        ? `needs ${cost} scrap, you have ${scrap}`
        : `trigger to send  |  ${cost} scrap  |  Y cycles payload`;
  },
  // The trigger, while the panel is open: send the drone to the point
  // under the cursor. This is the whole reason the panel exists.
  strategyClick: () => {
    const s = strategy;
    if (!s || !s.open || !s.cursor) return false;
    const w = panelToWorld(s.cursor.u, s.cursor.v);
    if (level.droneAllowed === false) {
      showToast('No signal down here. The drone stays topside.', 2200);
      return false;
    }
    const cost = dronePayloadCost(dronePayload);
    if (scrap < cost) { showToast(`Not enough scrap (${cost} needed)`, 2000); return false; }
    const y = level.heightAt(w.x, w.z);
    dispatchAction({ t: 'drone', p: [w.x, y, w.z], k: dronePayload });
    audio.play('dronefly');
    showToast(`Drone away: ${PAYLOAD_LABEL[dronePayload]}`, 1400);
    strategyTarget = w;
    return true;
  },
  strategyCyclePayload: () => {
    dronePayload = DRONE_PAYLOADS[(DRONE_PAYLOADS.indexOf(dronePayload) + 1) % DRONE_PAYLOADS.length];
    refreshDroneButton();
    return dronePayload;
  },
  strategyOpen: () => !!(strategy && strategy.open),
  setHolstered: (on) => { holstered = on; },
  flashlight: () => { flashlightOn = !flashlightOn; },
  throwCycle: () => { if (canAct()) arsenal.cycleThrowable(); },
  nightVision: () => toggleNightVision(),
  map: () => toggleMap(),
  debugMenu: () => toggleDebugMenu(),
  debugMenuOpen: () => !!(debugMenu && debugMenu.open),
  debugMenuMove: (d) => { if (debugMenu) debugMenu.move(d); },
  debugMenuPick: () => { if (debugMenu) debugMenu.activate(); },
  // Repair the nearest damaged wall segment. Prep only, cheap, and meant
  // to be spammed: patching the base every morning is the routine that
  // makes the day phase worth having.
  // Repair is a HOLD, with a ring you watch fill. "OBJECTIVE: REPAIR WALL"
  // told the player nothing about how; a highlighted section, a prompt and
  // a filling ring tell them everything without a word of tutorial.
  canRepairHere: () => {
    if (nearestRepairTarget()) return true;
    const p = rig.group.position;
    return !!(level.doors || []).find((d) => !d.open
      && Math.hypot(d.buttonX - p.x, d.buttonZ - p.z) < 1.9);
  },
  repairHold: (down) => { repairHeld = down && canAct(); },
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

// ---- Hold-to-act -------------------------------------------------------
// Repairing the wall and reviving a teammate are the same interaction: go
// to a marked thing, hold, watch it fill. Everything about it is
// world-space, so it works identically flat and in VR. A DOM prompt would
// have been half a feature again.
let repairHeld = false;
let repairHoldT = 0;
let interact = null;

function updateInteractions(dt) {
  if (!interact) interact = new InteractionLayer(scene);
  if (!isPlaying()) { interact.show(null, camera); interact.setBeacons([]); return; }

  const me = role === 'client' ? net?.myId : 'H';
  const here = rig.group.position;

  // Downed teammates get a marker that draws THROUGH geometry: not being
  // able to see them is the entire problem it solves.
  const downed = [];
  for (const [id, p] of remotePlayerPoses()) {
    if (!p.down || id === me) continue;
    downed.push({ id, x: p.p[0], y: p.p[1], z: p.p[2], rv: p.rv || 0, name: p.name });
  }
  interact.setBeacons(downed);

  // Reviving beats repairing: a teammate on the floor is always the more
  // urgent of the two.
  let target = null;
  let actVerb = null;              // what the touch ACT button should say
  const mate = downed.find((d) => Math.hypot(d.x - here.x, d.z - here.z) < 1.9);
  if (mate) {
    target = {
      x: mate.x, y: mate.y, z: mate.z,
      label: 'REVIVING', sub: mate.name || 'teammate',
      progress: Math.min(1, mate.rv / TUNING.player.reviveTime),
    };
    repairHoldT = 0;
  } else if (nearestPickup()) {
    // Pickups are automatic, but they were also invisible: Ola could not
    // tell whether a med kit could be collected at all. It now names
    // itself as you approach, so walking over it is a decision.
    const it = nearestPickup();
    target = {
      x: it.x, y: it.y, z: it.z,
      label: PICKUP_LABEL[it.kind] || 'SUPPLIES',
      sub: 'walk over it',
      progress: 0,
    };
    repairHoldT = 0;
  } else if (level.doors && level.doors.length) {
    // A closed door is the same interaction: walk to the button, hold,
    // watch it fill. The design doc asks for "a moment of standing still
    // and defending", and a hold is exactly that moment.
    const door = level.doors.find((d) => !d.open
      && Math.hypot(d.buttonX - here.x, d.buttonZ - here.z) < 1.9);
    if (door) {
      if (repairHeld) {
        repairHoldT += dt;
        if (repairHoldT >= TUNING.pacing.route.doorHoldTime) {
          repairHoldT = 0;
          dispatchAction({ t: 'door', i: door.index });
        }
      } else {
        repairHoldT = Math.max(0, repairHoldT - dt * 2.5);
      }
      actVerb = 'OPEN';
      target = {
        x: door.buttonX, y: 0, z: door.buttonZ,
        label: holdLabel('OPEN'),
        sub: 'the door',
        progress: repairHoldT / TUNING.pacing.route.doorHoldTime,
      };
    } else {
      repairHoldT = 0;
    }
  } else {
    const seg = nearestRepairTarget();
    if (seg) {
      const afford = scrap >= TUNING.base.repairCost;
      if (repairHeld && afford) {
        repairHoldT += dt;
        if (repairHoldT >= TUNING.base.repairHoldTime) {
          repairHoldT = 0;
          dispatchAction({ t: 'repair', i: seg.index });
          audio.play('repair', [seg.x, 1, seg.z]);
        }
      } else {
        repairHoldT = Math.max(0, repairHoldT - dt * 2.5);
      }
      actVerb = afford ? 'REPAIR' : 'NEED SCRAP';
      target = {
        x: seg.x, y: 0, z: seg.z,
        label: afford ? holdLabel('REPAIR') : 'NOT ENOUGH SCRAP',
        sub: afford ? `${TUNING.base.repairCost} scrap` : `${TUNING.base.repairCost} needed`,
        progress: repairHoldT / TUNING.base.repairHoldTime,
      };
    } else {
      repairHoldT = 0;
    }
  }
  interact.show(target, camera);
  setActButton(actVerb);
}

function inVRNow() { return !!(vrInput && vrInput.active); }

// WHAT TO PRESS depends on what you are playing on, and the prompt used
// to name a key that half the players do not have. A phone player was
// told to "HOLD E" and had no E, no grip, and no button: repairing the
// wall and opening a door were simply unavailable on mobile, which is
// the flat-mode version of the VR parity rule.
function holdLabel(verb) {
  if (inVRNow()) return `HOLD GRIP TO ${verb}`;
  if (touchInput) return `HOLD THE BUTTON TO ${verb}`;
  return `HOLD E TO ${verb}`;
}

// The touch ACT button appears only when there is something to hold, and
// says which of the two it is.
function setActButton(verb) {
  const el = $('btn-act');
  if (!el) return;
  const want = !!verb && !!touchInput;
  el.classList.toggle('hidden', !want);
  if (want) el.textContent = verb;
}

// "+1 HEALTH PACK", floating in front of you for a moment. In a headset
// the toast that carries this on a monitor simply does not exist, so a
// player had no idea what they had just picked up, or whether they had.
let pickupFlash = null;
let pickupFlashT = 0;
function showPickupFlash(text) {
  if (!pickupFlash) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    pickupFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.094),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, toneMapped: false }));
    pickupFlash.renderOrder = 999;
    pickupFlash.position.set(0, -0.18, -1.1);
    camera.add(pickupFlash);
    pickupFlash.userData.canvas = c;
    pickupFlash.material.map = new THREE.CanvasTexture(c);
    pickupFlash.material.map.colorSpace = THREE.SRGBColorSpace;
  }
  const c = pickupFlash.userData.canvas;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 512, 96);
  x.fillStyle = 'rgba(10,12,16,0.8)';
  x.beginPath(); x.roundRect(4, 4, 504, 88, 20); x.fill();
  x.strokeStyle = '#7fb069'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#e8e4da';
  x.font = 'bold 44px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text.toUpperCase(), 256, 50);
  pickupFlash.material.map.needsUpdate = true;
  pickupFlash.visible = true;
  pickupFlashT = 1.6;
}
function stepPickupFlash(dt) {
  if (!pickupFlash || pickupFlashT <= 0) return;
  pickupFlashT -= dt;
  pickupFlash.material.opacity = Math.min(1, pickupFlashT * 2.5);
  if (pickupFlashT <= 0) pickupFlash.visible = false;
}

const PICKUP_LABEL = {
  pack: 'MED KIT', grenade: 'GRENADE',
  ammo_shotgun: 'SHELLS', ammo_smg: 'SMG AMMO',
};

// The nearest collectable within prompt range of where the player ACTUALLY
// is, which in VR is the camera and not the play-space origin.
function nearestPickup() {
  const here = inVRNow() ? camera.getWorldPosition(tmpV2) : rig.group.position;
  let best = null, bd = 2.6 * 2.6;
  for (const v of itemVisuals.values()) {
    if (v.beam && v.beam.visible) continue;      // a field crate: drone job
    const dx = v.group.position.x - here.x, dz = v.group.position.z - here.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) {
      bd = d2;
      best = { x: v.group.position.x, y: 0, z: v.group.position.z, kind: v.kind };
    }
  }
  return best;
}

// Every player the client knows about, including its own mirror, as
// snapshot-shaped records. The host reads its own sim, a client its
// replica, so the interaction layer does not care which it is.
function remotePlayerPoses() {
  const out = [];
  if (role === 'client') {
    const latest = replica && replica.latest;
    if (latest && latest.players) {
      for (const [id, p] of Object.entries(latest.players)) out.push([id, p]);
    }
  } else if (sim) {
    for (const [id, p] of sim.players) {
      out.push([id, {
        p: p.pos.toArray(), down: p.down, rv: p.reviveT || 0, name: p.name,
      }]);
    }
  }
  return out;
}

// Base integrity readout + the repair prompt, refreshed on wall events and
// once per frame while the prompt could change.
let baseAlarmT = 0;
let victorySummary = '';  // run stats, shown in the DOM AND in the headset
let lastDt = 1 / 60;     // the frame loop's dt, for helpers called from it
function updateBaseHud() {
  const wall = level && level.baseWall;
  if (!wall) { hud.setBase(null); hud.setRepairPrompt(false); return; }
  const integrity = wall.integrity();
  hud.setBase(integrity);
  // The prompt itself is world-space now (see updateInteractions), so it
  // reaches a VR player too. The DOM row stays only as a reminder that
  // repairing is a thing during prep.
  hud.setRepairPrompt(false);
  // A pulse that speeds up as the perimeter fails: the emergency has to
  // be audible from anywhere in the base, including with your back to it.
  if (integrity < TUNING.base.warnAt && lastWave && lastWave.ph === 'night') {
    baseAlarmT -= lastDt;
    if (baseAlarmT <= 0) {
      baseAlarmT = 0.6 + 2.2 * Math.max(0, (integrity - TUNING.base.loseAt))
        / Math.max(0.01, TUNING.base.warnAt - TUNING.base.loseAt);
      audio.play('baseAlarm');
    }
  } else {
    baseAlarmT = 0;
  }
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

// ---- The strategy view: the same map, in VR, big enough to aim at ----
//
// Ola: "the wrist is the TRIGGER, not the whole surface... a larger
// holographic panel floating at a comfortable distance, big enough to
// read the map and place a drone target precisely." Without it the drone
// could not be used in a headset at all, because sending it needs a point
// on the map and VR had no way to give one.
//
// It reuses mapCam, so what unfolds is the map the flat player sees,
// markers and all, rather than a second drawing that can drift.
let strategy = null;
let strategyTarget = null;          // {x, z} the last placed point

function getStrategy() {
  if (!strategy) {
    strategy = new StrategyView(renderer);
    strategy.attachTo(scene);
  }
  return strategy;
}

// The map camera frames the level; this is the same framing maths the
// flat map uses, factored out so the panel and the screen can never
// disagree about where a point on the map is in the world.
function frameMapCam(aspect) {
  const c = level.baseCentre || { x: 0, z: 0 };
  mapCam.position.set(c.x, 60, c.z);
  mapCam.lookAt(c.x, 0, c.z);
  const ext = level.mapExtent || LEVEL_SIZE * 0.62;
  if (aspect >= 1) {
    mapCam.top = ext; mapCam.bottom = -ext;
    mapCam.left = -ext * aspect; mapCam.right = ext * aspect;
  } else {
    mapCam.left = -ext; mapCam.right = ext;
    mapCam.top = ext / aspect; mapCam.bottom = -ext / aspect;
  }
  mapCam.updateProjectionMatrix();
}

// A point on the panel, in 0..1 from the top left, back to the ground it
// stands for.
//
// The map camera looks straight down with up = -Z, which means screen-down
// is world +Z: the image is NOT mirrored top to bottom, and v maps
// straight onto Z. The first version of this inverted v "because screen
// coordinates run downwards", which flipped every point across the middle
// of the level. Nothing on screen would have said so, and every drone
// would have flown to the wrong side. The vrprobe checks both axes
// against the camera's own projection matrix now, at off-centre points,
// because a symmetric frustum maps the centre to the centre no matter
// which signs are wrong.
function panelToWorld(u, v) {
  const x = mapCam.position.x + (mapCam.left + u * (mapCam.right - mapCam.left));
  const z = mapCam.position.z + (mapCam.bottom + v * (mapCam.top - mapCam.bottom));
  return { x, z };
}

// And back again, so a placed target can be drawn on the panel.
function worldToPanel(x, z) {
  const u = (x - mapCam.position.x - mapCam.left) / (mapCam.right - mapCam.left);
  const v = (z - mapCam.position.z - mapCam.bottom) / (mapCam.top - mapCam.bottom);
  return { u, v };
}

// Open or close the panel. Opening borrows the map's whole setup: the
// ceiling comes off, the fog is suspended, the markers turn on.
function toggleStrategy(on) {
  const s = getStrategy();
  if (on === s.open) return s.open;
  if (on) {
    frameMapCam(1);                    // the panel is square-ish
    level.group.traverse((o) => {
      if (o.userData && o.userData.ceiling) o.visible = false;
    });
    mapSavedFog = scene.fog;
    scene.fog = null;
    mapMarkers.visible = true;
    strategyTarget = null;
    s.target = null;
    s.show(camera);
    audio.play('wristping');
  } else {
    s.hide();
    level.group.traverse((o) => {
      if (o.userData && o.userData.ceiling) o.visible = true;
    });
    if (mapSavedFog) { scene.fog = mapSavedFog; mapSavedFog = null; }
    mapMarkers.visible = false;
  }
  return s.open;
}

// There used to be a second button here, MINE, which teleported a mine
// onto the map for 12 scrap. Ola: "MINE and DRONE:MINE read as
// duplicates." They were worse than duplicates. The drone carried the
// same mine to the same place for 10, so the plain button was more
// expensive AND less interesting, and nothing on screen said what the
// difference was, because there wasn't one. Remote mine delivery is the
// drone's job now, which is also what makes the drone worth owning.
//
// The drone button doubles as the payload selector: click it again to
// cycle what it will carry. One button, no submenu, and the price is
// always on the label.
const DRONE_PAYLOADS = ['mine', 'tar', 'spike', 'lure', 'fetch'];
const PAYLOAD_LABEL = {
  mine: 'MINE', tar: 'TAR', spike: 'SPIKES', lure: 'FLARE', fetch: 'FETCH',
};
let dronePayload = 'mine';

// Fetching your own loot is free; everything else is the payload price
// plus the launch fee. One function, so the button label and the
// affordability guard can never disagree again.
function dronePayloadCost(kind) {
  if (kind === 'fetch') return TUNING.economy.droneDeploy;
  return (TUNING.economy.dronePayload[kind] || 0) + TUNING.economy.droneDeploy;
}

function refreshDroneButton() {
  const cost = dronePayloadCost(dronePayload);
  const grounded = level.droneAllowed === false;
  $('btn-map-drone').classList.toggle('disabled', grounded);
  $('btn-map-drone').textContent = grounded
    ? 'DRONE: NO SIGNAL UNDERGROUND'
    : dronePayload === 'fetch'
      ? 'DRONE: FETCH LOOT - free'
      : `DRONE: ${PAYLOAD_LABEL[dronePayload]} - ${cost}`;
}

function setMapMode(mode) {
  mapMode = mode;
  $('btn-map-ping').classList.toggle('on', mode === 'ping');
  $('btn-map-drone').classList.toggle('on', mode === 'drone');
  refreshDroneButton();
}
$('btn-map-ping').addEventListener('click', () => setMapMode('ping'));
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
    frameMapCam(innerWidth / innerHeight);
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
  } else if (mapMode === 'drone') {
    if (level.droneAllowed === false) {
      showToast('No signal down here. The drone stays topside.', 2200);
      return;
    }
    // You pay for the PAYLOAD, not the launch: droneDeploy is 0 by design.
    // Checking the launch fee meant this guard could never fire, so the
    // client played the launch sound and announced "Drone away" while the
    // host silently refused the order and nothing ever arrived.
    const cost = dronePayloadCost(dronePayload);
    if (scrap < cost) {
      showToast(`Not enough scrap (${cost} needed)`, 2000);
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
  // NEVER LEAVE A PANEL BETWEEN THE PLAYER AND THEIR OWN EMERGENCY. Ola
  // had to die to get rid of the strategy map; dying must not be able to
  // leave him behind it either, since the downed panel appears in the
  // same space.
  if (down && strategy && strategy.open) toggleStrategy(false);
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
          // VR has no toast, so the confirmation has to be in the world.
          if (vrInput && vrInput.active) showPickupFlash(label);
        }
        break;
      }
      case 'door':
        // Every peer opens its own copy: geometry is never networked.
        setDoorOpen(level, ev.i, true);
        audio.play('doors');
        showToast('The door is open. Move.', 1800);
        break;
      case 'route':
        showCenterText('GET TO THE LIFT', 2.2);
        audio.stinger('night');
        break;
      case 'push':
        // Advancing is what summons them, so the game says so: the player
        // has to learn that moving forward is what turns the pressure up.
        showToast('They heard you move.', 1800);
        audio.play('groan');
        break;
      case 'fielddrop':
        showToast('Supplies down in the field. Send the drone.', 2400);
        break;
      case 'fetchmiss':
        showToast('Nothing there to pick up.', 1600);
        break;
      case 'nofunds':
        // The host refused the order. Without this the client had already
        // said "Drone away" and played the launch sound.
        if (ev.by === (role === 'client' ? net?.myId : 'H')) {
          showToast(`Not enough scrap (${ev.need} needed)`, 2000);
          audio.play('dryfire');
        }
        break;
      case 'delivered':
        audio.play('pickup');
        showToast('Drone delivered the crate.', 1800);
        break;
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
        const at = [seg ? seg.x : 0, 1, seg ? seg.z : 0];
        if (ev.broke) {
          audio.play('wallbreak', at);
          showToast('BREACH! The wall is down.', 2200);
          if (!(vrInput && vrInput.active)) addShake(0.05);
        } else if (!ev.fix) {
          // Escalate with the damage: a body blow while the section holds,
          // wood splintering once it is nearly through. The player must be
          // able to hear WHICH part of the base is about to go without
          // turning to look at it.
          const f = seg ? seg.hp / seg.maxHp : 1;
          audio.play(f < 0.4 ? 'wallcrack' : 'wallhit', at);
          if (f < 0.25 && !(vrInput && vrInput.active)) addShake(0.012);
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
      case 'respawn':
        // The authoritative "you are on your feet again". Sent by the one
        // reset path for every restart and level change, so the client can
        // never be left believing it is still down.
        if (ev.id === (role === 'client' ? net?.myId : 'H')) {
          setDowned(false);
          myHp = ev.hp;
          hud.setHealth(myHp);
          if (ev.at) placePlayer(ev.at[0], ev.at[2]);
          playerVel.set(0, 0, 0);
          arsenal.cancelReload && arsenal.cancelReload();
          updateLowHpVignette();
        }
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
        victorySummary =
          `${wn} night${wn === 1 ? '' : 's'} survived. ${wk} zombie${wk === 1 ? '' : 's'} down. `
          + `${st.scrap || 0} scrap left unspent.`;
        // The same sentence reaches VR through the wrist and the panel:
        // score is state, and state must not exist only in the DOM.
        $('win-stats').textContent = victorySummary;
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
      case 'trap':
        // The payload landing, twenty metres out. You could hear the drone
        // leave and then nothing arrived.
        audio.play('dronedrop', ev.p);
        break;
      case 'mined': {
        const me = role === 'client' ? net?.myId : 'H';
        if (ev.by === me) showToast('Mine placed (arms in 1s)', 1500);
        audio.play('minebeep', ev.p || null);
        break;
      }
      // The mine is live. Placement and arming used to sound identical
      // (they were the same beep) and only one of them was true.
      case 'armed': {
        audio.play('minearmed', ev.p || null);
        break;
      }
      // The drone has the crate. Nothing announced the one moment of the
      // fetch errand worth watching, so from inside the base it flew out,
      // hovered, and came back, and you learned whether it worked when it
      // landed.
      case 'grabbed': {
        const me = role === 'client' ? net?.myId : 'H';
        audio.play('grab', ev.p || null);
        if (ev.by === me) showToast('Drone has the crate.', 1400);
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
      default:
        // A sim event with no case here is a feature that was built and
        // then never reached the player. Nine of them were hiding behind
        // this switch until an audit went looking. Silence is not a
        // sensible default for a message somebody deliberately sent.
        console.warn('[events] unhandled sim event:', ev.e, ev);
        break;
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
let touchInput = null;             // set when the touch layer is in use
if (!PHOTOMODE && !UISTATE) {
  if (PLATFORM === 'desktop') inputs.push(new KeyboardInput(inputCtx));
  if (PLATFORM !== 'desktop') {
    touchInput = new TouchInput(inputCtx);
    inputs.push(touchInput);
  }
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
// Watch the floor we booted on. loadLevel() picks up every later floor,
// but nothing calls it for the first one: it is built at module scope.
if (HOT && !LEVELPREVIEW) startHotReload().watch(levelIndex);

if (LEVELPREVIEW) {
  // A diagram of the level, not a view of the game. The HUD, the lobby
  // and the player are all out of the way.
  $('hud').classList.add('hidden');
  for (const el of document.querySelectorAll('.panel')) el.classList.add('hidden');
  viewmodel.visible = false;
  rig.group.visible = false;
  preview = applyLevelPreview(level, { scene, camera, renderer });
  // ?levelpreview=N&hot=1 is the pairing this was built for: a labelled
  // diagram of the level that redraws itself as the data file is edited.
  if (HOT) startHotReload().watch(LEVELPREVIEW);
}
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
      // OLA: "it should be DAY when the zombies come, when you are on the
      // surface." Our whole art direction is zombies in daylight, and a
      // holdout level's tension comes from SEEING them cross 40 m of open
      // ground. Darkness belongs to the underground traverse levels.
      // Surface levels only take on a low afternoon light as waves climb.
      nightTarget = clipDef ? 0
        : level.daylight ? Math.min(0.26, 0.05 * ((lastWave && lastWave.n) || 1))
        : 1;
      closeShop();
      break;
    case 'elevator':
      nightTarget = level.daylight ? 0.2 : 0.35;
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

// ---- The debug menu -----------------------------------------------------
// Everything the game has, reachable in one place, on every platform.
let debugMenu = null;
function getDebugMenu() {
  if (debugMenu) return debugMenu;
  const give = (w) => () => {
    if (!sim) return;
    const p = sim.players.get('H');
    if (!p) return;
    if (!p.inv.w.includes(w)) p.inv.w.push(w);
    p.inv.active = w;
    const def = TUNING.weapons[w];
    if (def && def.magazine) {
      p.inv.a[w] = [def.magazine, def.reserveMax === Infinity ? -1 : def.reserveMax];
    }
    arsenal.syncFromInv && arsenal.syncFromInv(p.inv);
    arsenal.active = w;
    arsenal.onHudChange();
    showToast(`Given: ${def ? def.name : w}`, 1400);
  };
  const actions = [
    { label: 'Give SHOTGUN', run: give('shotgun') },
    { label: 'Give SMG', run: give('smg') },
    { label: 'Give AK', run: give('ak') },
    { label: 'Give DUAL PISTOLS', run: give('akimbo') },
    { label: '+500 scrap', run: () => {
      if (!sim) return;
      const p = sim.players.get('H');
      if (p) p.inv.s += 500;
      showToast('+500 scrap', 1200);
    } },
    { label: 'Fill ammo and kit', run: () => {
      if (!sim) return;
      const p = sim.players.get('H');
      if (!p) return;
      p.inv.k = 2; p.inv.m = 6; p.inv.g = 5; p.inv.gs = 3; p.inv.gm = 3;
      arsenal.debugRefillAll && arsenal.debugRefillAll();
      window.__zhr.debugRefill();
      showToast('Ammo and kit filled', 1400);
    } },
    { label: 'Heal to full', run: () => { if (sim) sim.healPlayer && sim.healPlayer('H'); forceLocalRevive(); } },
    { label: 'REVIVE ME', run: () => { forceLocalRevive(); showToast('Back on your feet.', 1400); } },
    { label: 'Kill everything', run: () => { if (sim) sim.debugKillAllNow ? sim.debugKillAllNow() : window.__zhr.debugKillAll(); } },
    { label: 'Skip to the next wave', run: () => { if (sim) sim.forceNight(); } },
    { label: 'Floor 1: THE FIELD (holdout)', run: () => window.__zhr.debugGotoLevel(1) },
    { label: 'Floor 2: THE UNDERWORKS (traverse)', run: () => window.__zhr.debugGotoLevel(2) },
    { label: 'Floor 4: the old yard', run: () => window.__zhr.debugGotoLevel(4) },
    { label: 'Floor 5: the trench', run: () => window.__zhr.debugGotoLevel(5) },
    { label: 'Floor 6: the wagon', run: () => window.__zhr.debugGotoLevel(6) },
    { label: 'Floor 12: THE BUTCHER', run: () => window.__zhr.debugGotoFinal() },
    { label: 'Repair the base', run: () => { window.__zhr.debugRepairAll(); showToast('Base repaired', 1200); } },
    // ---- Wrist calibration. Read the two characters out loud. ----
    // The wrist display's home position is DERIVED now (see wrist.js), so
    // these are a nudge rather than a search. The card they drive floats
    // in front of your face, because the last version put the readout on
    // the arm, which is the thing you could not see.
    { label: 'Wrist: move AROUND the arm', run: () => {
      if (!vrInput) return;
      showToast(`Wrist at ${vrInput.calibrateWrist('pip', 1)}`, 2200);
    } },
    { label: 'Wrist: change the ANGLE', run: () => {
      if (!vrInput) return;
      showToast(`Wrist at ${vrInput.calibrateWrist('tilt', 1)}`, 2200);
    } },
    { label: 'Wrist: BACK TO DEFAULT', run: () => {
      if (!vrInput) return;
      showToast(`Wrist reset to ${vrInput.resetWrist()}`, 2600);
    } },
    { label: 'Wrist: done, hide the card', run: () => {
      if (!vrInput) return;
      showToast(`Saved: wrist at ${vrInput.finishWristCalibration()}`, 3000);
    } },
    { label: 'Close', run: () => getDebugMenu().toggle() },
  ];
  const status = () => {
    const w = lastWave || {};
    return [
      ['level', `${levelIndex} ${level.archetype || level.type || ''}`],
      ['phase', w.ph || '-'],
      ['hp', String(myHp)],
      ['downed', myDown ? 'YES' : 'no'],
      ['left', w.left === undefined ? '-' : String(w.left)],
      ['scrap', String(scrap)],
      // The wrist coordinate lives HERE, on the surface he is already
      // looking at to step it. Every confirmation in the calibration flow
      // went through showToast, and a toast is DOM, and DOM does not
      // exist inside a headset: the last step of the calibration said
      // "Saved" to nobody.
      ['wrist', vrInput && vrInput.wrist ? vrInput.wrist.label() : '-'],
    ];
  };
  debugMenu = new DebugMenu(actions, status);
  debugMenu.hint = 'VR: left stick up/down to move, TRIGGER to pick, Y to close.'
    + '   Desktop: arrows and Enter, F8 to close.';
  return debugMenu;
}

function toggleDebugMenu() {
  const m = getDebugMenu();
  // In VR it hangs in front of the player; flat, it hangs off the camera
  // the same way, so there is exactly one implementation.
  m.attachTo(camera);
  const open = m.toggle();
  if (open) m.draw();
  return open;
}

// ---- VR readouts --------------------------------------------------------
// RULE (Ola's VR playtest): nothing important may exist only as flat HUD
// text. Everything a flat player reads off the screen has to reach a VR
// player, so this mirrors the whole HUD onto the wrist and the ammo count
// onto the weapon.
//
// The objective is deliberately in plain words rather than a phase name:
// "GO TO THE LIFT" tells you what to do, "elevator" does not.
function vrObjective(w) {
  if (!w) return { objective: 'STAND BY', sub: '' };
  const label = level.waveLabel || 'NIGHT';
  switch (w.ph) {
    case 'lobby':
      return { objective: 'STAND BY', sub: 'waiting for the host' };
    case 'day': {
      // A damaged wall is a job with a deadline, so it says so and goes
      // amber. An intact one is just prep.
      const hurt = level.baseWall && level.baseWall.integrity() < 0.98;
      return {
        objective: hurt ? 'REPAIR THE WALL' : level.baseWall ? 'DIG IN' : 'LAY YOUR TRAPS',
        sub: `${label.toLowerCase()} ${w.n + 1} in ${w.t}s`,
        urgency: hurt ? 'warn' : 'normal',
      };
    }
    case 'countdown':
      return {
        objective: 'THEY ARE COMING', sub: `${label} ${w.n + 1} in ${w.t}`,
        urgency: 'warn',
      };
    case 'night': {
      const wall = level.baseWall ? level.baseWall.integrity() : 1;
      return {
        objective: wall < 0.35 ? 'THE WALL IS FAILING' : 'HOLD THE LINE',
        sub: `${label} ${w.n}`,
        urgency: wall < 0.35 ? 'danger' : wall < 0.6 ? 'warn' : 'normal',
      };
    }
    case 'route':
      // No clock and no wave counter: the objective IS the direction.
      return {
        objective: 'GET TO THE LIFT',
        sub: 'the far corner, south-east',
        urgency: w.left > 8 ? 'danger' : w.left > 3 ? 'warn' : 'normal',
      };
    case 'elevator':
      return { objective: 'GO TO THE LIFT', sub: 'area cleared', urgency: 'normal' };
    case 'ride':
      return { objective: 'RIDING UP', sub: `floor ${w.lv + 1}` };
    case 'finale':
      return { objective: 'GET TO THE HELICOPTER', sub: 'extraction inbound', urgency: 'warn' };
    case 'victory':
      return { objective: 'EXTRACTED', sub: 'you made it out' };
    case 'gameover':
      return { objective: 'DOWN', sub: 'the run is over', urgency: 'danger' };
    default:
      return { objective: '', sub: '' };
  }
}

// EVERY STOPPED STATE HAS A WAY FORWARD IN VR.
//
// Being downed, losing, and winning are all DOM overlays in flat mode, and
// DOM does not exist in a headset: the player saw nothing and could do
// nothing. This maps each of those states onto the world-space panel, with
// the resolving actions on face buttons.
function updateVrPanel(w) {
  const panel = vrInput.getPanel();
  const ph = w && w.ph;
  if (ph === 'gameover') {
    panel.show('GAME OVER', [
      role === 'solo' || role === 'host'
        ? 'The base is lost. You can try this floor again.'
        : 'The host decides what happens next.',
      `You reached floor ${w.lv}.`,
    ], role === 'client' ? [
      { key: 'B', label: 'QUIT TO MENU', run: actQuitToMenu },
    ] : [
      { key: 'A', label: 'TRY THIS FLOOR AGAIN', run: actRetryLevel },
      { key: 'B', label: 'QUIT TO MENU', run: actQuitToMenu },
    ], 'danger');
    return;
  }
  if (ph === 'victory') {
    panel.show('EXTRACTED', [
      'You got out.',
      victorySummary || '',
    ], [
      { key: 'A', label: 'RUN IT AGAIN', run: actNewRun },
      { key: 'B', label: 'QUIT TO MENU', run: actQuitToMenu },
    ], 'good');
    return;
  }
  if (myDown) {
    // A player alone has nobody to revive them, so "wait for help" is not
    // a state, it is a trap. There is always a way back to playing.
    panel.show('YOU ARE DOWN', role === 'solo'
      ? ['Nobody is coming. Start this floor again.']
      : ['A teammate has to reach you and hold to revive.', 'Call out where you are.'],
      role === 'solo'
        ? [
          { key: 'A', label: 'START THIS FLOOR AGAIN', run: actRetryLevel },
          { key: 'B', label: 'QUIT TO MENU', run: actQuitToMenu },
        ]
        : [{ key: 'B', label: 'QUIT TO MENU', run: actQuitToMenu }], 'danger');
    return;
  }
  panel.hide();
}

function updateVrReadouts() {
  if (!vrInput || !vrInput.active) return;
  const w = lastWave;
  updateVrPanel(w);
  const info = arsenal.hudInfo();
  const { objective, sub, urgency } = vrObjective(w);
  const announced = vrInput.setWristState({
    objective, sub, urgency: urgency || 'normal',
    left: w && w.ph === 'night' ? w.left : null,
    hp: myHp, hpMax: 100,
    scrap,
    weapon: info.name,
    mag: info.mag, reserve: info.reserve, reloading: info.reloading,
    baseIntegrity: level.baseWall ? level.baseWall.integrity() : null,
    packs: info.packs, mines: info.mines || 0,
  }, lastDt);
  // The display earns its glance by telling you when to look at it.
  if (announced) audio.play('wristping');
  vrInput.setAmmoTag(info.mag, info.magMax, info.reloading);
  // A lit torch in bright daylight is absurd. On surface levels the hand
  // simply carries the tool; underground it actually lights the way.
  //
  // The toggle is the authority. This used to read `flashlightOn ||
  // level.lighting.dark`, which meant that underground the lamp was
  // permanently on and the switch did nothing, on exactly the levels
  // where you would want to turn it off. The level's darkness decides the
  // DEFAULT (set on arrival), not the current state.
  vrInput.setHandLight(!level.daylight && flashlightOn);
}

// ---- HUD phase text -----------------------------------------------------
function updateWaveHud(w) {
  if (!w) { hud.setWave('NIGHT 1'); return; }
  switch (w.ph) {
    case 'lobby': hud.setWave(role === 'client' ? 'WAITING FOR HOST' : 'NIGHT 1'); break;
    case 'day': {
      const nxt = (level.waveLabel || 'NIGHT').toLowerCase();
      hud.setWave(`FLOOR ${w.lv} - REGROUP - repair and lay traps - ${nxt} in ${w.t}s`);
      break;
    }
    case 'countdown':
      hud.setWave(`${level.waveLabel || 'NIGHT'} ${w.n + 1}`);
      showCenterText(String(w.t), 0.5);
      break;
    case 'night':
      hud.setWave(`${level.waveLabel || 'NIGHT'} ${w.n} - ${w.left} left`);
      break;
    case 'route':
      hud.setWave(`GET TO THE LIFT - ${w.left} on you`);
      break;
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
  lastDt = dt;
  last = now;

  if (!PHOTOMODE && !UISTATE) {
    for (const input of inputs) input.update(dt);
    const inVR = !!(vrInput && vrInput.active);
    if (!inVR) {
      if (!isPlaying()) rig.yaw += dt * 0.02;  // slow menu drift
      // Recoil recovery: the kick eases back toward the aim point.
      if (recoilHoldT > 0) recoilHoldT -= dt;
      else if (recoilRecover > 0) {
        const rec = Math.min(recoilRecover, dt * TUNING.weapons.recoil.recoverRate * 0.032);
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
      // DERIVED from state every frame. Ola stayed permanently short after
      // a fall because this was mutated once and left stale.
      const eyeTarget = controller.eyeHeight(myDown);
      camera.position.y += (eyeTarget - camera.position.y) * Math.min(1, dt * 2.4);
      const rollTarget = myDown ? 0.16 : 0;
      camera.rotation.z += (rollTarget - camera.rotation.z) * Math.min(1, dt * 2.4);
    }
    // ---- MOVEMENT: one controller, every platform ---------------------
    // Input reported where the player WANTS to go. The controller decides
    // where they actually end up: swept so nothing is tunnelled through,
    // ground taken from the feet, step-up and slope enforced, gravity and
    // landing real, and never stuck.
    let wishX = 0, wishZ = 0;
    for (const i of inputs) { wishX += i.wishX || 0; wishZ += i.wishZ || 0; }
    // A probe driving the controller directly owns it exclusively for the
    // duration. Two things stepping the same body interleave, and the
    // measurement stops meaning anything.
    if (probeDrivesMovement) { wishX = 0; wishZ = 0; }

    if (probeDrivesMovement) {
      rig.group.position.copy(controller.pos);
    } else if (inVR) {
      // ROOMSCALE. The player's real steps move the camera, not the rig,
      // so the body follows the CAMERA and any correction is applied back
      // to the rig. Sampling the rig origin samples a place the player is
      // not standing, which is what made ramps behave like ice.
      const cam = camera.getWorldPosition(tmpV2);
      const wantX = cam.x, wantZ = cam.z;
      controller.pos.x = wantX;
      controller.pos.z = wantZ;
      controller.step(level, dt, wishX, wishZ);
      // Whatever the controller refused, the rig gives back, so the
      // player's head cannot end up inside a wall.
      rig.group.position.x += controller.pos.x - wantX;
      rig.group.position.z += controller.pos.z - wantZ;
      rig.group.position.y = controller.pos.y;
    } else {
      controller.step(level, dt, wishX, wishZ);
      rig.group.position.copy(controller.pos);
    }

    if (controller.landed > 6) addShake(Math.min(0.05, controller.landed * 0.004));

    // Out of the world entirely. Put them back on their feet somewhere
    // valid: no player may ever be unable to continue.
    if (controller.fellOutOfWorld) {
      const spawn = level.playerSpawns[0];
      controller.place(level, spawn.x, spawn.z);
      rig.group.position.copy(controller.pos);
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

    // The flat-mode viewmodel is a camera-mounted gun. In VR your hands
    // already hold the weapon, so leaving it on gave the player a third
    // one floating in front of them.
    viewmodel.visible = !inVR;
    if (inVR && vrInput) vrInput.setReloadPose(arsenal, vrReloadHint);

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
      // Visuals straight from the authoritative sim, through the SAME row
      // builder the snapshot uses. Written out by hand here once, and the
      // host promptly fell a column behind the clients.
      const rows = [];
      for (const z of sim.zombies.values()) rows.push(zombieRow(z));
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
          DRONE_LOADS.indexOf(d.payload || 'mine'), d.phase === 'home' ? 1 : 0]);
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
          p: p.pos.toArray(), ry: p.ry, rx: p.rx, vr: p.vr, down: p.down,
          h: p.h, hl: p.hl, hr: p.hr, name: p.name,
        }, dt);
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
          updateAvatar(id, p, dt);
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
      // DERIVED, NOT LATCHED. A missed or reordered event must not be able
      // to leave the player pinned on the floor with the run over and the
      // game silent about it. The simulation is the truth; this follows it.
      const meId = role === 'client' ? net?.myId : 'H';
      const authoritative = role === 'client'
        ? (replica.latest && replica.latest.players && replica.latest.players[meId])
        : (sim && sim.players.get('H'));
      if (authoritative && !!authoritative.down !== myDown) setDowned(!!authoritative.down);

      updateWaveHud(lastWave);
      updateBaseHud();
      updateInteractions(dt);
      stepPickupFlash(dt);
      if (debugMenu && debugMenu.open) debugMenu.draw();
      if (strategy && strategy.open) {
        // The marker follows the GROUND it was placed on, not the pixel
        // that was clicked. Identical while the panel is open and the
        // framing is fixed, and correct if either ever changes, which is
        // the difference between a marker and a smudge.
        strategy.target = strategyTarget
          ? worldToPanel(strategyTarget.x, strategyTarget.z) : null;
        strategy.draw();
      }
      updateVrReadouts();
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
  //
  // NO HEADLAMP IN VR. Ola: "there is also a headlamp that should not
  // exist yet. Remove it." In a headset this light is mounted on your
  // face, which is both wrong and a spoiler for gear that has not been
  // earned: light comes from the hand that carries the torch. On a flat
  // screen there is no hand to carry it from, so the eye-mounted cone
  // stays and F is still its switch. A real headlamp is parked in
  // docs/TODO.md as a scrap unlock.
  const headLampAllowed = !(vrInput && vrInput.active);
  flashlight.intensity += (((flashlightOn && headLampAllowed) ? 15 : 0) - flashlight.intensity) * Math.min(1, dt * 10);
  beamMesh.material.opacity = (flashlight.intensity / 15) * (level.lighting.dark ? 0.055 : 0);

  updateMapMarkers();

  // Muzzle flash decay + explosion + ping VFX.
  if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - dt * 45);
  updateExplosions(dt);
  updatePings(dt);
  updateEffectVisuals(dt);
  updateCasings(dt);
  updateShotVfx(dt);

  if (preview) { preview.render(); return; }
  // The strategy panel is a second pass through the scene from above.
  // It has to happen BEFORE the main render and it must not photograph
  // itself; StrategyView handles both, and throttles itself to ~10 Hz
  // because a map is a readout, not an action view.
  if (strategy && strategy.open) strategy.renderMap(scene, mapCam, dt);
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
  // Move the local player the way a player moves: through the character
  // controller, which decides whether the step is legal.
  //
  // DEAD SINCE v0.17.0. This wrote straight into rig.group.position, and
  // since the controller took ownership of the body it copies its own
  // position over the rig on the next frame. Every write was silently
  // undone: groundprobe walked at a ramp for 22 steps without moving a
  // centimetre and reported "could not reach the top", and the pressure
  // bot's kiting had not happened for as long.
  debugMove: (dx, dz) => {
    const dt = 1 / 60;
    controller.step(level, dt, dx / dt, dz / dt);
    rig.group.position.copy(controller.pos);
    return controller.pos.toArray();
  },
  // Teleports go through the same door, so a probe cannot put the player
  // somewhere the controller does not know about.
  debugTeleport: (x, z) => placePlayer(x, z),
  debugLook: (x, z) => {
    rig.yaw = Math.atan2(rig.group.position.x - x, rig.group.position.z - z);
    rig.pitch = 0;
  },

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
    // loadLevel already calls sim.setLevel, which picks the phase. Calling
    // it a second time here cleared the supplies the first call had just
    // handed out.
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
        from: s.kind, ring: s.ring || null, dist: Math.hypot(s.x - c.x, s.z - c.z),
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
  baseCentre: () => (level.baseCentre ? [level.baseCentre.x, 0, level.baseCentre.z] : null),

  // Bodies must not occupy the same space. Reports the worst overlap in
  // the crowd as a fraction of the pair's combined radius.
  debugCrowding: () => {
    if (!sim) return null;
    const zs = [...sim.zombies.values()].filter((z) => z.alive);
    let worst = 0, overlapping = 0, pairs = 0;
    for (let i = 0; i < zs.length; i++) {
      for (let j = i + 1; j < zs.length; j++) {
        const ra = TUNING.enemies[zs[i].type].radius, rb = TUNING.enemies[zs[j].type].radius;
        const min = (ra + rb) * 0.82;
        const d = Math.hypot(zs[i].pos.x - zs[j].pos.x, zs[i].pos.z - zs[j].pos.z);
        pairs++;
        if (d >= min) continue;
        overlapping++;
        worst = Math.max(worst, (min - d) / min);
      }
    }
    return { count: zs.length, pairs, overlapping, worstOverlap: +worst.toFixed(3) };
  },
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
    // A slim post at the corner of the plate is furniture, not a
    // blockage. Only count solids that eat a real share of the zone.
    const zoneArea = 4 * z.hx * z.hz;
    const blockers = level.colliders.filter((c) => {
      if (c.playerOnly || c.dead) return false;
      if (!(c.tall || (c.top !== undefined && c.top > LOCO.stepUp))) return false;
      const ox = Math.min(c.x + c.hx, z.x + z.hx) - Math.max(c.x - c.hx, z.x - z.hx);
      const oz = Math.min(c.z + c.hz, z.z + z.hz) - Math.max(c.z - c.hz, z.z - z.hz);
      if (ox <= 0.05 || oz <= 0.05) return false;
      return (ox * oz) / zoneArea > 0.12;
    });
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

  // POCKET CHECK. Stand anywhere in the playable area: can you get back
  // to the middle?
  //
  // A gap between two solids narrower than the player's diameter pins the
  // player in place, because both colliders push and the pushes cancel.
  // It has shipped twice. Pairwise geometry over-reports (a tiled wall run
  // looks full of gaps) and a bot walking at the goal under-reports (an
  // L-shaped detour defeats it), so this floods the area with a
  // player-sized agent. Anything free but unreachable from the middle is
  // a trap.
  debugPockets: (cell = 0.2) => {
    // Flood the area the player may actually occupy. A square around them
    // would include ground outside the level's walls, which is
    // unreachable by definition and would be reported as a giant pocket.
    const c = level.objective === 'reach-exit' && level.playerSpawns[0]
      ? { x: level.playerSpawns[0].x, z: level.playerSpawns[0].z }
      : (level.baseCentre || { x: 0, z: 0 });
    const half = (level.playableHalf || 4) + 0.6;
    const bounds = level.playBounds || {
      minX: c.x - half, maxX: c.x + half, minZ: c.z - half, maxZ: c.z + half,
    };
    const nav = new NavGrid(bounds, cell);
    // forPlayer: the player DOES collide with player-only barriers, which
    // the horde walks straight through.
    // Doors are flooded OPEN, and the chasm is flooded as solid. A route
    // level deliberately starts with the squad sealed in an antechamber,
    // so a closed door is not a pocket: it is the level.
    const solids = level.colliders.filter((c) => c.door === undefined);
    nav.build(solids, LOCO.radius, voidBlocker(level), true);
    const reach = nav.reachableFrom(c.x, c.z);
    // Group the unreachable free cells into connected islands and measure
    // each. A one or two cell island is grid-inflation rounding, not a
    // place a player can stand; a real trap is at least a body wide.
    const seen = new Uint8Array(nav.w * nav.h);
    const pockets = [];
    let free = 0;
    for (let cz = 0; cz < nav.h; cz++) {
      for (let cx = 0; cx < nav.w; cx++) {
        const i = nav.idx(cx, cz);
        if (nav.blocked[i]) continue;
        free++;
        if (reach[i] || seen[i]) continue;
        // Flood this island.
        const queue = [i];
        seen[i] = 1;
        let n = 0, sx = 0, sz = 0;
        for (let head = 0; head < queue.length; head++) {
          const j = queue[head];
          const jx = j % nav.w, jz = (j - jx) / nav.w;
          n++; sx += nav.worldX(jx); sz += nav.worldZ(jz);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = jx + dx, nz = jz + dz;
            if (!nav.inBounds(nx, nz)) continue;
            const k = nav.idx(nx, nz);
            if (seen[k] || nav.blocked[k] || reach[k]) continue;
            seen[k] = 1;
            queue.push(k);
          }
        }
        const area = n * cell * cell;
        // A player occupies about 0.32 m^2. Anything smaller is a sliver
        // between two inflated obstacles, which nobody can occupy.
        if (area >= 0.3) {
          pockets.push({ at: [+(sx / n).toFixed(1), +(sz / n).toFixed(1)], area: +area.toFixed(2) });
        }
      }
    }
    return { tested: free, stuck: pockets };
  },

  // ---- VR probe surface ----
  // A real XR session cannot start headlessly, but every line of VR
  // interface logic can run without one. These drive it so that "downed in
  // VR is a softlock" is caught by a test rather than by Ola putting the
  // headset on.
  debugEnterVR: (on = true) => {
    if (!vrInput) return false;
    vrInput.debugForceActive(on);
    return vrInput.active === on;
  },
  debugVrPanel: () => {
    if (!vrInput || !vrInput.panel) return null;
    const p = vrInput.panel;
    return {
      open: p.open,
      // The rendered text, read back from the same canvas the player sees,
      // so the test cannot pass on a panel that was never drawn.
      title: p._key ? p._key.split('|')[0] : '',
      actions: p.actions.map((a) => `${a.key}: ${a.label}`),
      visible: p.mesh.visible,
    };
  },
  debugVrPress: (key) => (vrInput && vrInput.panel ? vrInput.panel.press(key) : false),
  // Press a face button through the real gamepad loop, by hand and index.
  debugVrFaceButton: (hand, index) => (vrInput ? vrInput.debugPressButton(hand, index) : false),
  // Turn the head away from whatever it is looking at, so a "look away"
  // rule can be tested without pretending to be the gesture code.
  debugLookAway: () => {
    rig.yaw += Math.PI;
    rig.group.rotation.y = rig.yaw;
    camera.rotation.y = 0;
    camera.updateMatrixWorld(true);
    return rig.yaw;
  },
  // Press it the way a controller does: through the gamepad loop, which
  // is the only route a player has.
  debugVrButtonA: () => (vrInput ? vrInput.debugPressButton('right', 4) : false),
  debugVrButtonB: () => (vrInput ? vrInput.debugPressButton('right', 5) : false),
  debugVrButtonY: () => (vrInput ? vrInput.debugPressButton('left', 5) : false),
  // The torch: is it lit, and does the empty hand's trigger work it?
  debugVrTrigger: (hand) => (vrInput ? vrInput.debugPullTrigger(hand) : null),
  // What the reload LOOKS like: where the magazine is and whether it is
  // in the gun at all. "Readable as a reload" is a claim about the mesh,
  // so this reports the mesh.
  debugReload: () => actions.reload(),
  // Is anything visibly attacking the base? Reports the ANIMATION state,
  // not the sim's intention: what a player at the far side of the field
  // would be able to see.
  debugAttackPose: () => {
    let attacking = 0, swinging = 0, spread = 0;
    const phases = [];
    for (const v of zombieStates.values()) {
      if (!v.attacking) continue;
      attacking++;
      if ((v.swingT || 0) > 0) { swinging++; phases.push((v.swingT % (Math.PI * 2)).toFixed(2)); }
    }
    // Are they hammering in lockstep? A crowd all swinging together reads
    // as one animation played on many bodies.
    if (phases.length > 1) {
      const nums = phases.map(Number);
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      spread = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    }
    return { attacking, swinging, spread: +spread.toFixed(2) };
  },
  debugReloadPose: () => {
    if (!vrInput) return null;
    for (const holder of vrInput.gripWeapons) {
      if (holder.userData.shown === 'light') continue;
      const mag = holder.userData.mag;
      return {
        roll: +(holder.userData.reloadRoll || 0).toFixed(3),
        magY: mag ? +(mag.position.y - (holder.userData.magHome || 0)).toFixed(4) : null,
        magIn: mag ? mag.visible : null,
      };
    }
    return null;
  },
  // The holster and the strategy view, as a player would meet them.
  debugReachHolster: () => (vrInput ? vrInput.debugReachHolster() : null),
  // The wrist display measured against the WEAPON's frame, which is the
  // one known to be right because Ola can see the gun and aim it.
  // Re-dress the VR hands after a weapon change, the way the game does.
  debugRedressHands: () => {
    if (!vrInput) return false;
    vrInput.setWeaponModel(arsenal.active);
    return true;
  },
  // How many gun BARRELS are actually on the controllers. The akimbo bug
  // was invisible to a count of hands: both hands held "a weapon", and
  // each of those weapons was two pistols.
  // COUNT THE GEOMETRY, NOT THE LABEL.
  //
  // The first version of this read `userData.shown`, which the dressing
  // code sets to 'pistol' as its FIRST act. So it reported two guns while
  // the very next line added the two-pistol mesh to each hand, and the
  // probe cheerfully certified a bug that was completely unfixed. That is
  // the exact failure QUALITY.md was written about, committed the same
  // day. A gun is a barrel in space, so count barrels in space.
  debugBarrelCount: () => {
    if (!vrInput) return 0;
    let n = 0;
    for (const holder of vrInput.gripWeapons) {
      if (holder.userData.shown === 'light') continue;
      // Distinct X offsets among the long thin parts: one pistol sits on
      // the holder's centre line, two sit either side of it.
      const xs = new Set();
      holder.traverse((o) => {
        if (!o.geometry || o.geometry.type !== 'BoxGeometry') return;
        const p = o.geometry.parameters;
        if (p.depth < 0.1 || p.width > 0.06) return;    // barrels/slides only
        xs.add(o.position.x.toFixed(2));
      });
      n += Math.max(1, xs.size);
    }
    return n;
  },
  // THE DISPLAY MEASURED AGAINST THE ACTUAL GUN.
  //
  // The first version of this compared the display's normal against a
  // hardcoded (0,1,0) while its own comment claimed it was checking
  // against the weapon's frame. There was no reference to the weapon in
  // it. It compared two constants and could not go red, which is exactly
  // how a 47-degree error in the premise survived: the grip's +Y and the
  // WEAPON's +Y are not the same direction, and the whole question is
  // which one the display is aligned to.
  //
  // So: take the real weapon holder, in world space, and ask whether the
  // display's face points the same way as the top of that gun.
  debugWristFrame: () => {
    if (!vrInput || !vrInput.wrist) return null;
    const g = vrInput.wrist.group;
    const frame = g.parent;
    if (!frame) return null;
    frame.updateWorldMatrix(true, true);
    g.updateWorldMatrix(true, false);
    // The gun the player can actually see, in the hand that has one.
    const gun = vrInput.gripWeapons.find((h) => h.userData.shown !== 'light')
      || vrInput.gripWeapons[0];
    if (!gun) return null;
    gun.updateWorldMatrix(true, false);
    const gunUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()));
    const gunBarrel = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()));
    const normal = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion()));
    const localPos = g.position.clone();
    return {
      pos: [+localPos.x.toFixed(3), +localPos.y.toFixed(3), +localPos.z.toFixed(3)],
      // 1.0 = the display faces exactly the way the top of the gun does.
      agreesWithGunUp: +normal.dot(gunUp).toFixed(3),
      // Should be near 0: a watch face is not pointing down the barrel.
      alongBarrel: +normal.dot(gunBarrel).toFixed(3),
      towardElbow: +localPos.z.toFixed(3),
      onTopOfArm: +localPos.y.toFixed(3),
    };
  },
  // Is the holster where a hip is, relative to the head?
  // WHICH SIDE, NOT JUST HOW FAR.
  //
  // The first version returned a scalar distance, and a holster on the
  // wrong hip is exactly the same distance away as one on the right hip.
  // It passed while the thing sat behind the player's left side, out of
  // reach of the hand that is supposed to use it. Reported in the head's
  // own frame now: right is positive, forward is positive.
  debugHolsterPlace: () => {
    if (!vrInput || !vrInput.holster) return null;
    vrInput.holster.updateWorldMatrix(true, false);
    const h = vrInput.holster.getWorldPosition(new THREE.Vector3());
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const floor = rig.group.position.y;
    // Into the head's frame: +x right of the player, +z in front.
    const local = camera.worldToLocal(h.clone());
    return {
      right: +local.x.toFixed(3),
      forward: +(-local.z).toFixed(3),
      horizontal: +Math.hypot(h.x - eye.x, h.z - eye.z).toFixed(3),
      heightFraction: +((h.y - floor) / Math.max(0.1, eye.y - floor)).toFixed(3),
      lit: !!vrInput._holsterLit,
    };
  },
  debugHolster: () => (vrInput ? {
    exists: !!vrInput.holster,
    visible: !!(vrInput.holster && vrInput.holster.visible),
    stowed: !!vrInput.holstered,
    // Where the weapon mesh actually is, which is the thing you see.
    onHip: !!(vrInput.holsterSlot && vrInput.holsterSlot.children.length > 0),
  } : null),
  debugStrategy: () => {
    if (!strategy) return { open: false };
    return {
      open: strategy.open,
      label: strategy.label,
      hint: strategy.hint,
      cursor: strategy.cursor ? [+strategy.cursor.u.toFixed(3), +strategy.cursor.v.toFixed(3)] : null,
      target: strategy.target ? [+strategy.target.u.toFixed(3), +strategy.target.v.toFixed(3)] : null,
      // Has the map image actually been rendered into the panel?
      painted: strategy.rt.texture.version > 0 || strategy._mapT >= 0,
      worldTarget: strategyTarget ? [+strategyTarget.x.toFixed(1), +strategyTarget.z.toFixed(1)] : null,
    };
  },
  // Point at a spot on the panel the way a hand does: through hitTest,
  // with a real ray, from where the pointing hand actually is.
  debugStrategyPointAt: (u, v) => {
    if (!strategy || !strategy.open) return null;
    strategy.group.updateWorldMatrix(true, false);
    const local = new THREE.Vector3((u - 0.5) * 0.92, (0.5 - v) * 0.72, 0);
    const world = strategy.group.localToWorld(local);
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = world.clone().sub(origin).normalize();
    actions.strategyPoint(origin, dir);
    return strategy.cursor ? [+strategy.cursor.u.toFixed(2), +strategy.cursor.v.toFixed(2)] : null;
  },
  debugStrategyClick: () => actions.strategyClick(),
  // IS THE PANEL ACTUALLY BLACK? Reads pixels back off the panel's own
  // render target, which is the thing the player is looking at. Ola:
  // "den är HELT svart." Nothing in the code said so; the map camera was
  // being ignored and the pass was drawing into the wrong buffer.
  debugStrategyPixels: () => {
    if (!strategy || !strategy.open) return null;
    const w = 24, h = 24;
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(strategy.rt,
      (strategy.rt.width - w) / 2, (strategy.rt.height - h) / 2, w, h, buf);
    let lit = 0, sum = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const v = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      sum += v;
      if (v > 12) lit++;
    }
    return {
      litFraction: +(lit / (w * h)).toFixed(3),
      meanBrightness: +(sum / (w * h)).toFixed(1),
      xrRestored: renderer.xr.enabled,
    };
  },
  // Hot reload, from the outside: how many rebuilds have happened, and
  // whether the last import complained.
  debugColliderCount: () => (level.colliders || []).length,
  debugSpawnCount: () => (level.zombieSpawns || []).length,
  debugScrapNow: () => scrap,
  debugHot: () => ({
    on: HOT, reloads: hotCount, error: hotError,
    watching: hotReload ? [...hotReload.watching] : [],
  }),
  debugPanelToWorld: (u, v) => panelToWorld(u, v),
  // The same question answered by the camera's own projection matrix,
  // for the probe to check my arithmetic against. If these two disagree,
  // every point placed on the panel lands somewhere other than where it
  // was pointed at, and nothing on screen would say so.
  debugProjectToPanel: (x, z) => {
    const p = new THREE.Vector3(x, 0, z).project(mapCam);
    return { u: (p.x + 1) / 2, v: (1 - p.y) / 2 };
  },
  debugArchetype: () => level.archetype || level.type || null,
  debugTorch: () => ({
    dark: !!level.lighting.dark,
    // What is actually shining, not what a flag says.
    hand: !!(vrInput && vrInput.handLightOn),
    head: flashlight.intensity > 1,
    toggle: flashlightOn,
  }),
  debugMenuState: () => {
    const m = debugMenu;
    return {
      open: !!(m && m.open),
      actions: m ? m.actions.length : 0,
      status: m && m.status ? m.status() : [],
    };
  },
  debugMenuPickLabel: (label) => {
    const m = getDebugMenu();
    const i = m.actions.findIndex((a) => a.label === label);
    if (i < 0) return false;
    m.index = i;
    m.open = true;
    m.activate();
    return true;
  },
  debugVrWrist: () => {
    if (!vrInput || !vrInput.wrist) return null;
    return { key: vrInput.wrist._key, attached: !!vrInput.wrist.group.parent };
  },
  // Point the weapon at the floor for `t` seconds of game time, the way
  // the reload gesture is actually performed.
  debugVrPointDown: (down = true) => {
    if (!vrInput || !vrInput.grips.length) return false;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(down ? -Math.PI / 2 : 0, 0, 0));
    const pose = (obj, quat) => {
      obj.matrix.compose(obj.position.set(0, 1.2, -0.3), quat, obj.scale.set(1, 1, 1));
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      obj.matrixWorldNeedsUpdate = true;
    };
    for (let i = 0; i < vrInput.grips.length; i++) {
      pose(vrInput.grips[i], q);
      pose(vrInput.controllers[i], q);
    }
    return true;
  },
  debugHands: () => (vrInput ? vrInput.gripWeapons.map((h) => h.userData.shown || null) : null),
  debugVrGesture: () => (vrInput ? {
    active: vrInput.active,
    downT: +(vrInput.downT || 0).toFixed(2),
    armed: vrInput.downArmed,
    fwdY: +(vrInput._fwd ? vrInput._fwd.y : 0).toFixed(2),
    grips: vrInput.grips.length,
  } : null),
  debugDown: () => myDown,
  // What a PLAYER can tell about their own state, rather than what a
  // variable says. Used by assertions that must prove the game is
  // playable, not that a flag flipped.
  debugCanPlay: async () => {
    const before = rig.group.position.clone();
    const beforeAmmo = arsenal.hudInfo().mag;
    // Can I move?
    debugKeepAvatars.size;
    rig.group.position.x += 0.6;
    const moved = Math.abs(rig.group.position.x - before.x) > 0.3;
    rig.group.position.copy(before);
    // Can I shoot?
    let fired = false;
    if (canAct()) {
      const ray = aimRay();
      if (ray) fired = arsenal.fire(ray.origin, ray.dir);
    }
    return {
      downed: myDown,
      hp: myHp,
      canAct: canAct(),
      canMove: moved,
      canShoot: !!fired,
      ammoBefore: beforeAmmo,
      ammoAfter: arsenal.hudInfo().mag,
    };
  },
  // What the interaction layer is currently offering, as the player sees
  // it. "Actionable, not just announced" is a claim that needs a test.
  debugInteraction: () => {
    if (!interact) return null;
    return {
      promptVisible: interact.prompt.visible,
      label: interact._labelKey.split('|')[0] || '',
      ringVisible: interact.ring.visible,
      highlightVisible: interact.highlight.visible,
      beacons: interact.beacons.size,
    };
  },
  debugRepairHold: (down) => { repairHeld = !!down; },
  debugClearItems: () => { if (sim) sim.items.clear(); },
  // Two stand-in teammates so avatars can be looked at without a second
  // headset in the room: one flat and walking, one with tracked hands.
  debugFakeMates: () => {
    const c = level.baseCentre || { x: 0, z: 0 };
    debugKeepAvatars.add('FAKE1').add('FAKE2');
    let t = 0;
    setInterval(() => {
      t += 0.05;
      updateAvatar('FAKE1', {
        p: [c.x - 1.5, 0, c.z + 0.4 + Math.sin(t) * 0.7], ry: 0.3, rx: 0,
        vr: false, down: false, name: 'OLA',
      }, 0.05);
      updateAvatar('FAKE2', {
        p: [c.x + 1.3, 0, c.z + 0.6], ry: -0.2, rx: -0.1, vr: true,
        name: 'MATE',
        h: { p: [c.x + 1.3, 1.62, c.z + 0.6], q: [0, 0, 0, 1] },
        hl: { p: [c.x + 0.9, 1.15 + Math.sin(t * 1.7) * 0.22, c.z + 0.1], q: [0, 0, 0, 1] },
        hr: { p: [c.x + 1.7, 1.30 + Math.cos(t * 1.3) * 0.2, c.z + 0.0], q: [0, 0, 0, 1] },
      }, 0.05);
    }, 50);
    return true;
  },
  debugDamageWall: (index, amount) => {
    if (sim && level.baseWall) sim.damageBaseWall(index, amount);
  },
  // Traverse probe surface.
  debugRoute: () => {
    if (!sim || !level.exitZone) return null;
    const zs = [...sim.zombies.values()].filter((z) => z.alive);
    return {
      phase: sim.wave.phase,
      doors: (level.doors || []).map((d) => ({ open: d.open, x: d.buttonX, z: d.buttonZ })),
      exit: { x: level.exitZone.x, z: level.exitZone.z },
      spawn: level.playerSpawns[0].toArray(),
      alive: zs.length,
      pushed: sim.wave.pushed || 0,
      inChasm: zs.filter((z) => level.voidAt && level.voidAt(z.pos.x, z.pos.z)).length,
      level: level.index,
    };
  },
  debugWallSeg: (index) => {
    const w = level.baseWall;
    if (!w) return null;
    const s = w.segments[index];
    return s ? { x: s.x, z: s.z, hp: s.hp, maxHp: s.maxHp } : null;
  },
  reloading: () => arsenal.reloading,
  debugEndRun: () => { if (sim) { sim.wave.phase = 'gameover'; sim.wave.t = 0; for (const p of sim.players.values()) { p.down = true; p.hp = 0; } } },
  // Down the player the way the game does, in the SIMULATION. Setting the
  // client flag alone no longer works, and should not: the client derives
  // that state now, so a faked flag is corrected on the next frame. A
  // probe that fakes the wrong layer proves nothing.
  // Take damage the way the game deals it, so a test can die for real.
  debugHurt: (n) => { if (sim) sim.damagePlayer('H', n); },
  debugSetDowned: (v) => {
    if (!sim) { setDowned(v); return; }
    const p = sim.players.get('H');
    if (!p) return;
    if (v) { p.down = true; p.hp = 0; sim.events.push({ e: 'down', id: 'H' }); }
    else { sim.resetPlayers(); }
  },

  // ---- Recoil probe surface ----
  tuning: () => TUNING,
  debugHeat: () => arsenal.heat,
  debugAim: () => ({ yaw: rig.yaw, pitch: rig.pitch }),
  debugSwitch: (w) => { arsenal.active = w; },
  // Top the weapon up and cancel any reload, so a probe measures recoil
  // and not the reload that happened to land in the middle of its burst.
  debugRefill: () => {
    arsenal.reloading = false;
    arsenal.reloadT = 0;
    for (const [w, a] of Object.entries(arsenal.ammo)) {
      const def = TUNING.weapons[w];
      if (def && def.magazine) a.mag = def.magazine;
    }
    arsenal.onHudChange();
  },
  debugResetRecoil: () => {
    arsenal.heat = 0; arsenal.shotIndex = 0;
    recoilRecover = 0; recoilHoldT = 0; rig.pitch = 0; rig.yaw = 0;
  },
  // force: ignore the mechanical cooldown so a probe fires exactly the
  // sequence it asked for. Without it the cooldown silently drops shots
  // and every measurement compares different shot indices.
  debugFireOnce: (force = false) => {
    if (force) { arsenal.cooldown = 0; arsenal.cooldownR = 0; }
    const ray = aimRay();
    if (ray) arsenal.fire(ray.origin, ray.dir);
  },

  // Walk a straight line through the level with the real character
  // controller and report every frame's ground height. Used to hunt
  // "the ramp is wonky and I fall through it": a fall shows up as a
  // sudden drop, a hole shows up as a Y that is not on any ramp step.
  debugWalkLine: (x0, z0, x1, z1, steps = 90) => {
    const save = rig.group.position.clone();
    const dx = (x1 - x0) / steps, dz = (z1 - z0) / steps;
    rig.group.position.set(x0, level.heightAt(x0, z0), z0);
    playerVel.set(0, 0, 0);
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const tx = x0 + dx * i, tz = z0 + dz * i;
      // Drive with velocity so the controller's own step logic decides,
      // exactly as it would for a walking player.
      const px = rig.group.position.x, pz = rig.group.position.z;
      playerVel.set((tx - px) * 60, playerVel.y, (tz - pz) * 60);
      moveAndCollide(level, rig.group.position, playerVel, 1 / 60, [], LOCO.radius);
      resolveCircle(rig.group.position, LOCO.radius, blockingFor(level, rig.group.position.y));
      out.push([
        +rig.group.position.x.toFixed(2),
        +rig.group.position.y.toFixed(2),
        +rig.group.position.z.toFixed(2),
      ]);
    }
    rig.group.position.copy(save);
    playerVel.set(0, 0, 0);
    return out;
  },

  // ---- Movement probe surface ----
  // Walk the real controller, with real input intent, and report what a
  // player would observe: where they ended up, whether they were stopped,
  // whether they fell, whether they landed, whether they got stuck.
  debugWalk: async (fromX, fromZ, toX, toZ, seconds = 2.5, speed = 4.0) => {
    probeDrivesMovement = true;
    placePlayer(fromX, fromZ);
    const start = controller.pos.clone();
    const dx = toX - fromX, dz = toZ - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const vx = (dx / d) * speed, vz = (dz / d) * speed;
    let blocked = 0, recovered = 0, maxFall = 0, landedAt = 0;
    let minY = Infinity, maxY = -Infinity;
    // Step by REAL elapsed time, so `seconds` means seconds of movement.
    // Stepping a fixed 1/60 per 16 ms of wall clock ran the simulation at
    // roughly half speed, and every distance assertion silently meant half
    // of what it said.
    const t0 = performance.now();
    let last = t0;
    while ((performance.now() - t0) / 1000 < seconds) {
      await new Promise((r) => setTimeout(r, 16));
      const now = performance.now();
      const step = Math.min(0.05, (now - last) / 1000);
      last = now;
      controller.step(level, step, vx, vz);
      rig.group.position.copy(controller.pos);
      if (controller.blocked) blocked++;
      if (controller.recovered) recovered++;
      if (controller.landed > 0) landedAt = controller.landed;
      maxFall = Math.max(maxFall, controller.airTime);
      minY = Math.min(minY, controller.pos.y);
      maxY = Math.max(maxY, controller.pos.y);
      if (controller.fellOutOfWorld) break;
    }
    probeDrivesMovement = false;
    return {
      from: [+start.x.toFixed(2), +start.y.toFixed(2), +start.z.toFixed(2)],
      to: [+controller.pos.x.toFixed(2), +controller.pos.y.toFixed(2), +controller.pos.z.toFixed(2)],
      travelled: +Math.hypot(controller.pos.x - start.x, controller.pos.z - start.z).toFixed(2),
      climbed: +(controller.pos.y - start.y).toFixed(2),
      lowestY: +minY.toFixed(2),
      // The HIGHEST point reached, which is what "did you get up there"
      // actually means. End-minus-start reads zero for anyone who walks
      // up something and off the far side.
      peakY: +maxY.toFixed(2),
      peakClimb: +(maxY - start.y).toFixed(2),
      blockedFrames: blocked,
      recoveredFrames: recovered,
      airTime: +maxFall.toFixed(2),
      landedAt: +landedAt.toFixed(1),
      grounded: controller.grounded,
      outOfWorld: controller.fellOutOfWorld,
      eyeHeight: +controller.eyeHeight(myDown).toFixed(2),
    };
  },
  debugStations: () => (level.gymStations || []),
  // Archetype parity surface: is loot on this level actually collectable?
  debugLoot: () => {
    if (!sim) return null;
    const items = [...sim.items.values()];
    return {
      total: items.length,
      field: items.filter((i) => i.field).length,
      confined: !!level.confined,
      droneAllowed: level.droneAllowed !== false,
    };
  },

  debugRamps: () => (level.ramps || []).map((r) => ({
    x: +r.x.toFixed(2), z: +r.z.toFixed(2), top: +r.top.toFixed(2),
    hx: +r.hx.toFixed(2), hz: +r.hz.toFixed(2),
  })),
  debugHeightAt: (x, z) => level.heightAt(x, z),
  debugVoidAt: (x, z) => (level.voidAt ? level.voidAt(x, z) : null),
  debugSimZombies: () => (sim ? [...sim.zombies.values()].filter((z) => z.alive)
    .map((z) => [+z.pos.x.toFixed(1), +z.pos.z.toFixed(1), +z.pos.y.toFixed(1), z.type]) : []),
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
  debugScrap: (n) => {
    if (!sim) return false;
    for (const p of sim.players.values()) p.inv.s = n;
    scrap = n;
    hud.setScrap(scrap);
    return true;
  },
  debugStrategyOpen: (on) => toggleStrategy(on),
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
  // What a PLAYER can see of the minefield: the meshes on the ground, not
  // the simulation's bookkeeping. A probe that reads sim.mines would pass
  // while the visuals were left behind as ghosts.
  mines: () => {
    const out = [];
    for (const [id, g] of mineVisuals) out.push({ id, pos: g.position.toArray() });
    return out;
  },
  // Place a mine at a spot through the real action path, so the phase
  // gates, inventory and host validation all apply exactly as they do for
  // a player pressing the button.
  debugPlaceMineAt: (x, z) => {
    if (!sim) return false;
    const before = mineVisuals.size;
    actions.mineAt(new THREE.Vector3(x, level.heightAt(x, z), z));
    return before;
  },
  // Where the body actually is, and what the health bar actually reads.
  playerPos: () => rig.group.position.toArray(),
  debugHealth: () => myHp,
  debugGiveMines: (n) => {
    const p = sim && sim.players.get('H');
    if (!p) return false;
    p.inv.m = n;
    arsenal.syncFromHost(p.inv);
    return true;
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
