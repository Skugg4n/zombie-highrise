// Bootstrap: renderer, platform detection, quality tier, world, inputs,
// net wiring and the frame loop. Special boots: ?photomode=N (deterministic
// critic captures), ?uistate=<name> (UI gallery with fake data),
// ?autohost=1 / ?autojoin=CODE (smoke test hooks).
import * as THREE from 'three';
import { CONFIG, VERSION, PARAMS, PHOTOMODE, UISTATE, FORCE_QUALITY } from './config.js';
import { buildWorld, terrainHeight } from './world/world.js';
import { makeZombieMesh, makeAvatarMesh, AVATAR_COLORS } from './world/actors.js';
import { applyPhotomode } from './views/photomode.js';
import { Net } from './net/net.js';
import { msg } from './net/protocol.js';
import { HostSim } from './game/state.js';
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

// ---- Renderer, scene, rig ----------------------------------------------
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
const world = buildWorld(scene, QUALITY);

// Player rig: group origin at the feet / XR floor origin. Flat modes put
// the camera at eye height and use rig.yaw/pitch; VR lets the headset
// drive the camera inside the group.
const rig = { group: new THREE.Group(), yaw: 0, pitch: 0, camera };
camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
rig.group.add(camera);
rig.group.position.copy(world.playerSpawns[0]);
scene.add(rig.group);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
// Backgrounded tabs suspend the animation loop; on return, restart the dt
// clock so the first frame is not a huge step (LESSONS.md).
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// ---- Actors -------------------------------------------------------------
const zombieMesh = makeZombieMesh();
zombieMesh.position.copy(world.zombieSpawn);
scene.add(zombieMesh);
let zombiePrev = zombieMesh.position.clone();
let zombieAnimT = 0;
let zombieDeathT = 0;

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
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
function updateAvatar(id, p) {
  const a = ensureAvatar(id);
  const parts = a.userData.parts;
  a.position.fromArray(p.p);
  a.rotation.y = p.ry || 0;
  parts.head.rotation.x = p.rx || 0;
  const isVR = !!(p.vr && p.h);
  parts.handL.visible = isVR && !!p.hl;
  parts.handR.visible = isVR && !!p.hr;
  if (isVR) {
    a.updateMatrixWorld(true);
    // Head height follows the tracked head (crouching reads over the net).
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

// ---- UI -----------------------------------------------------------------
const hud = new Hud();
const lobby = new LobbyUI({
  onHost: startHosting,
  onJoin: startJoining,
  onSolo: startSolo,
  onStart: startPlaying,
  onLeave: leaveToMenu,
});

// ---- Game session state -------------------------------------------------
let role = null;             // null | 'solo' | 'host' | 'client'
let net = null;
let sim = null;              // HostSim (solo/host)
let replica = null;          // Replica (client)
let myHp = CONFIG.PLAYER_HP;
let lastSnapAt = 0;          // client: when the last snapshot arrived
let staleShown = false;
let toastTimer = 0;

function showToast(text, ms = 4000) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').classList.add('hidden');
}
const weapon = { ammo: CONFIG.PISTOL_MAG, reloading: false, reloadT: 0, cooldown: 0 };
const playerName = PARAMS.get('name') || 'Player';

function isPlaying() { return lobby.state === 'playing'; }

// Tear down any previous session completely before starting a new one.
// Orphaned Nets keep live Peers registered at the broker and their stale
// callbacks would fire into the new session's UI.
function resetSession() {
  if (net) net.leave();          // leave() detaches all callbacks first
  net = null; sim = null; replica = null; role = null;
  myHp = CONFIG.PLAYER_HP;
  weapon.ammo = CONFIG.PISTOL_MAG;
  weapon.reloading = false; weapon.reloadT = 0; weapon.cooldown = 0;
  lastSnapAt = 0;
  pruneAvatars(new Set());
  lobby.setMenuBusy(false);
}

function startSolo() {
  resetSession();
  role = 'solo';
  sim = new HostSim(world);
  sim.addPlayer('H', playerName, PLATFORM);
  hud.setRoom(null);
  startPlaying();
}

function startHosting() {
  resetSession();
  role = 'host';
  lobby.setMenuBusy(true, 'Contacting the connection broker...');
  net = new Net();
  sim = new HostSim(world);
  sim.addPlayer('H', playerName, PLATFORM);
  net.onHostReady = (code) => { lobby.setMenuBusy(false); lobby.showCode(code); hud.setRoom(code); };
  net.onPeerJoin = (id, hi) => {
    sim.addPlayer(id, hi.name, hi.platform);
    refreshHostPlayers();
  };
  net.onPeerLeave = (id) => { sim.removePlayer(id); refreshHostPlayers(); };
  net.onClientMessage = (id, m) => {
    if (m.t === 'pose') sim.updatePose(id, m);
    else if (m.t === 'shoot') sim.shoot(m.o, m.d);
  };
  net.onError = onNetError;
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
  net.onWelcome = (w) => { lobby.showConnected(w.code); hud.setRoom(w.code); };
  net.onSnapshot = (snap) => {
    lastSnapAt = performance.now();
    replica.push(snap);
    handleEvents(snap.ev || []);
    const me = snap.players?.[net.myId];
    if (me && me.hp !== myHp) { myHp = me.hp; hud.setHealth(myHp); }
  };
  net.onDisconnected = () => lobby.showError('Lost the connection to the host.');
  net.onError = onNetError;
  net.join(code, msg.hi(playerName, PLATFORM, VERSION));
}

function startPlaying() {
  lobby.setState('playing');
  hud.setHealth(myHp);
  hud.setAmmo(weapon.ammo, CONFIG.PISTOL_MAG, false);
  hud.setWave('NIGHT 1');
}

function leaveToMenu() {
  resetSession();
  hud.setRoom(null);
  lobby.setState('menu');
}

function onNetError(text, fatal) {
  if (fatal) {
    // Fatal errors only happen before a session is established (broker
    // unreachable). Reset everything so the next attempt starts clean.
    resetSession();
    lobby.setState('menu');
    lobby.setJoinStatus(text, true);
    document.getElementById('menu-status').textContent = text;
  } else if (lobby.state === 'menu' || lobby.state === 'joining') {
    lobby.setJoinStatus(text, true);
    document.getElementById('menu-status').textContent = text;
  } else {
    showToast(text, 6000);
  }
}

// ---- Events from the sim / snapshots ------------------------------------
function handleEvents(evs) {
  for (const ev of evs) {
    switch (ev.e) {
      case 'zhit': flashZombie(0xff5040); break;
      case 'zdie': zombieDeathT = 0.45; break;
      case 'zspawn': zombieMesh.scale.set(1, 1, 1); break;
      case 'phit':
        if (role !== 'client' && ev.id === 'H') { myHp = ev.hp; hud.setHealth(myHp); }
        break;
      case 'join': if (role === 'host') refreshHostPlayers(); break;
    }
  }
}

let zombieFlashT = 0;
function flashZombie(color) {
  zombieFlashT = 0.12;
  for (const part of Object.values(zombieMesh.userData.parts)) {
    part.material.emissive?.setHex(color);
    part.material.emissiveIntensity = 0.8;
  }
}

// ---- Weapon -------------------------------------------------------------
function tryFire(origin, dir) {
  if (!isPlaying() || weapon.reloading || weapon.cooldown > 0) return;
  if (weapon.ammo <= 0) { reload(); return; }
  weapon.ammo--;
  weapon.cooldown = CONFIG.PISTOL_COOLDOWN_S;
  hud.setAmmo(weapon.ammo, CONFIG.PISTOL_MAG, false);
  flash.intensity = 10;
  flash.position.copy(origin).addScaledVector(dir, 0.3);
  const o = origin.toArray(), d = dir.toArray();
  if (role === 'client') net.sendToHost(msg.shoot(o, d));
  else if (sim) { sim.shoot(o, d); if (role === 'solo') handleEvents(sim.events.splice(0)); }
}

function reload() {
  if (weapon.reloading || weapon.ammo >= CONFIG.PISTOL_MAG) return;
  weapon.reloading = true;
  weapon.reloadT = CONFIG.PISTOL_RELOAD_S;
  hud.setAmmo(weapon.ammo, CONFIG.PISTOL_MAG, true);
}

// ---- Inputs -------------------------------------------------------------
const inputCtx = {
  rig, camera, renderer,
  dom: renderer.domElement,
  fire: tryFire,
  reload,
  isPlaying,
  getLocoMode: () => lobby.locoMode,
  onSessionChange: (active) => {
    if (active) {
      // Inside the headset the 2D lobby panels are invisible, so a player
      // entering VR from the lobby would be dead-ended. Entering VR while
      // hosting/connected starts the game; from the bare menu it starts a
      // solo practice session. (Session start itself is always the user's
      // own button press, per the WebXR gesture rule.)
      if (lobby.state === 'hosting' || lobby.state === 'connected') startPlaying();
      else if (lobby.state === 'menu') startSolo();
      return;
    }
    {
      // Back to flat controls: adopt whatever yaw the rig ended up with.
      rig.yaw = rig.group.rotation.y;
      rig.pitch = 0;
      camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
      camera.rotation.set(0, 0, 0);
    }
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

// ---- Pose reporting -----------------------------------------------------
function buildPose() {
  const inVR = !!(vrInput && vrInput.active);
  if (!inVR) {
    return {
      p: rig.group.position.toArray(), ry: rig.yaw, rx: rig.pitch, vr: false,
    };
  }
  const hp = camera.getWorldPosition(new THREE.Vector3());
  const hq = camera.getWorldQuaternion(new THREE.Quaternion());
  const e = new THREE.Euler().setFromQuaternion(hq, 'YXZ');
  const pose = {
    p: [hp.x, rig.group.position.y, hp.z], ry: e.y, rx: e.x, vr: true,
    h: { p: hp.toArray(), q: hq.toArray() },
  };
  // Hands come from the handedness map and only while tracked; an asleep
  // controller must not report a stale or identity transform.
  const hl = vrInput.getHandPose('left');
  const hr = vrInput.getHandPose('right');
  if (hl) pose.hl = hl;
  if (hr) pose.hr = hr;
  return pose;
}

// ---- Special boots ------------------------------------------------------
let photomodeHud = false;
if (PHOTOMODE) {
  // Deterministic scene: zombie mid-approach, one fake teammate, fixed cam.
  zombieMesh.position.set(-10, 0, 8);
  zombieMesh.rotation.y = Math.atan2(0 - -10, 0 - 8);
  zombieAnimT = 1.2;
  updateAvatar('photobot', { p: [-2, 0.1, -1], ry: 2.3, rx: 0, vr: false, hp: 100 });
  photomodeHud = applyPhotomode(PHOTOMODE, { camera, scene });
  scene.remove(rig.group);   // free camera, not the rig camera path
  scene.add(camera);
  if (photomodeHud) lobby.applyUIState('hud');
} else if (UISTATE) {
  lobby.applyUIState(UISTATE);
  camera.position.set(10, 1.7, 12);
  camera.lookAt(0, 1.2, 0);
  scene.remove(rig.group);
  scene.add(camera);
} else {
  lobby.setState('menu');
}

// ---- Frame loop ---------------------------------------------------------
let last = performance.now();
let poseAccum = 0, snapAccum = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!PHOTOMODE && !UISTATE) {
    // Inputs and flat-mode camera.
    for (const input of inputs) input.update(dt);
    const inVR = !!(vrInput && vrInput.active);
    if (!inVR) {
      if (!isPlaying()) rig.yaw += dt * 0.02;  // slow menu drift
      rig.group.rotation.y = rig.yaw;
      camera.rotation.x = rig.pitch;
    }
    // Terrain clamp under the player (head position in VR, rig in flat).
    const ref = inVR ? camera.getWorldPosition(tmpV) : rig.group.position;
    rig.group.position.y = terrainHeight(ref.x, ref.z);

    // Weapon timers.
    if (weapon.cooldown > 0) weapon.cooldown -= dt;
    if (weapon.reloading) {
      weapon.reloadT -= dt;
      if (weapon.reloadT <= 0) {
        weapon.reloading = false;
        weapon.ammo = CONFIG.PISTOL_MAG;
        hud.setAmmo(weapon.ammo, CONFIG.PISTOL_MAG, false);
      }
    }

    // Simulation / replication.
    if (sim) {
      sim.updatePose('H', buildPose());
      // The world only simulates once the host is actually playing; poses
      // still sync so lobby members see each other, but the zombie neither
      // walks nor bites anyone who is still in a lobby panel.
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
      // Visuals from the authoritative sim.
      if (!zombieDeathT) zombieMesh.position.copy(sim.zombie.pos);
      zombieMesh.visible = sim.zombie.alive || zombieDeathT > 0;
      const keep = new Set();
      for (const [id, p] of sim.players) {
        if (id === 'H') continue;
        keep.add(id);
        updateAvatar(id, {
          p: p.pos.toArray(), ry: p.ry, rx: p.rx, vr: p.vr, h: p.h, hl: p.hl, hr: p.hr,
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
        if (s.z) {
          if (!zombieDeathT) zombieMesh.position.fromArray(s.z.p);
          zombieMesh.visible = s.z.alive || zombieDeathT > 0;
        }
      }
      // Stale-connection feedback (LESSONS.md: show "reconnecting" instead
      // of silently freezing when the host tab is backgrounded).
      const stale = lastSnapAt > 0 && performance.now() - lastSnapAt > 4000;
      if (stale && !staleShown) { staleShown = true; showToast('Connection stalled, waiting for the host...', 0); }
      else if (!stale && staleShown) { staleShown = false; hideToast(); }
    }
  }

  // Zombie shuffle animation (all roles, local cosmetic). Faces its
  // direction of travel; clients derive it from position deltas.
  const zDelta = tmpV.copy(zombieMesh.position).sub(zombiePrev);
  const zMoved = zDelta.lengthSq() > 1e-8;
  if (zMoved) zombieMesh.rotation.y = Math.atan2(zDelta.x, zDelta.z);
  zombiePrev.copy(zombieMesh.position);
  // In photomode the pose is set ONCE (fixed zombieAnimT at boot) and never
  // advanced: captures must be pixel-deterministic across iterations.
  if (zMoved && !PHOTOMODE) zombieAnimT += dt * 5.5;
  if (zMoved || PHOTOMODE) {
    const s = Math.sin(zombieAnimT);
    const parts = zombieMesh.userData.parts;
    parts.legL.rotation.x = s * 0.45;
    parts.legR.rotation.x = -s * 0.45;
    parts.armL.position.y = 1.22 + s * 0.03;
    parts.armR.position.y = 1.22 - s * 0.03;
    parts.torso.rotation.z = s * 0.06;
  }

  // Zombie hit flash / death shrink.
  if (zombieFlashT > 0) {
    zombieFlashT -= dt;
    if (zombieFlashT <= 0) {
      for (const part of Object.values(zombieMesh.userData.parts)) {
        part.material.emissive?.setHex(0x000000);
      }
    }
  }
  if (zombieDeathT > 0) {
    zombieDeathT -= dt;
    const k = Math.max(0.05, zombieDeathT / 0.45);
    zombieMesh.scale.set(1, k, 1);
    if (zombieDeathT <= 0) {
      zombieDeathT = 0;   // exactly 0: a negative value would freeze the zombie forever
      zombieMesh.visible = false;
      zombieMesh.scale.set(1, 1, 1);
    }
  }

  // Muzzle flash decay.
  if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - dt * 80);

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
  ammo: () => weapon.ammo,
  myPos: () => rig.group.position.toArray(),
  remotePlayers: () => {
    const out = {};
    for (const [id, a] of avatars) out[id] = a.position.toArray();
    return out;
  },
  zombie: () => ({ pos: zombieMesh.position.toArray(), visible: zombieMesh.visible }),
  debugMove: (dx, dz) => { rig.group.position.x += dx; rig.group.position.z += dz; },
  debugShootZombie: () => {
    const c = zombieMesh.position.clone(); c.y += 1.1;
    const o = camera.getWorldPosition(new THREE.Vector3());
    const d = c.sub(o).normalize();
    tryFire(o, d);
  },
  renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
};

// Smoke test hooks.
if (PARAMS.get('autohost')) startHosting();
else if (PARAMS.get('autojoin')) startJoining(PARAMS.get('autojoin').toUpperCase());
