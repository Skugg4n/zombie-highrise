// Level generator. Every peer builds the SAME level locally from the
// shared (runSeed, levelIndex) pair; geometry is never networked.
//
// Level types cycle with height: level 1 ground, 2 basement, 3 upper
// floor, 4 ground, ... (ground roughly every 3rd, per the vision doc).
// Every layout fits the physical play footprint (CONFIG.PLAY_AREA) and
// follows "shoot far, walk near": tight walkable space, long sightlines.
//
// A Level object owns: one THREE.Group (whole level, easy dispose),
// colliders ({x,z,hx,hz,tall}) where tall=true also blocks bullets,
// entries (where zombies enter the playable area), far zombie spawns,
// player spawns, the elevator, and lighting parameters for the day/night
// controller in main.js.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeRng } from '../util/rng.js';

export const PALETTE = {
  daySky: 0xa8c8e0, dayHaze: 0xd6c9a8,
  nightSky: 0x101a2e, nightHaze: 0x18223a,
  sand: 0xc9b088, concrete: 0x9a938a, sandbag: 0xb0a070,
  wood: 0x8a6f4d, hills: 0xb8a583, road: 0x6f6a62,
  basementWall: 0x6e6a63, basementFloor: 0x55524c,
  interiorWall: 0x8f8274, interiorFloor: 0x7a6f5e,
  metal: 0x5a5d63, metalDark: 0x3a3d42, rust: 0x7d5636,
};

// Six-level cycle keeps "ground roughly every 3rd" while weaving in the
// Phase 2 set pieces: 1 ground, 2 basement, 3 upper, 4 ground, 5 trench
// (tight, night, flashlight), 6 wagon (moving platform), then repeat.
export const LEVEL_TYPES = ['ground', 'basement', 'upper', 'ground', 'trench', 'wagon'];
export function levelTypeFor(levelIndex) {
  return LEVEL_TYPES[(levelIndex - 1) % LEVEL_TYPES.length];
}

const mat = (color, rough = 0.9, metal = 0.0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function box(group, w, h, d, material, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  group.add(m);
  return m;
}

// ---- The elevator (shared by every level) -------------------------------
// Worn metal cab, two sliding doors, an interior lamp. The cab IS the shop
// and the transition between levels; it sits at the edge of the play area.
export function makeElevator() {
  const g = new THREE.Group();
  const shell = mat(PALETTE.metal, 0.6, 0.5);
  const dark = mat(PALETTE.metalDark, 0.7, 0.3);
  const W = 2.6, H = 2.5, D = 2.2, T = 0.08;

  box(g, W, T, D, dark, 0, T / 2, 0);                    // floor
  box(g, W, T, D, dark, 0, H - T / 2, 0);                // ceiling
  box(g, W, H, T, shell, 0, H / 2, -D / 2);              // back
  box(g, T, H, D, shell, -W / 2, H / 2, 0);              // left
  box(g, T, H, D, shell, W / 2, H / 2, 0);               // right
  // Door frame header
  box(g, W, 0.35, T, shell, 0, H - 0.175, D / 2);
  // Sliding doors (front, facing +Z)
  const doorL = box(g, W / 2 - 0.05, H - 0.35, 0.06, dark, -W / 4, (H - 0.35) / 2, D / 2);
  const doorR = box(g, W / 2 - 0.05, H - 0.35, 0.06, dark, W / 4, (H - 0.35) / 2, D / 2);
  // Rusty accent strips and a button panel
  box(g, 0.3, 0.5, 0.03, mat(PALETTE.rust, 0.8), W / 2 - 0.16, 1.3, D / 2 - 0.35);
  const lamp = new THREE.PointLight(0xfff2d0, 1.1, 5);
  lamp.position.set(0, H - 0.25, 0);
  g.add(lamp);

  const api = {
    group: g, lamp,
    // t: 0 closed .. 1 open
    setDoors(t) {
      const slide = t * (W / 2 - 0.1);
      doorL.position.x = -W / 4 - slide;
      doorR.position.x = W / 4 + slide;
    },
  };
  api.setDoors(1);
  return api;
}

// The cab blocks movement and bullets as one solid block (the doors face
// the boarding zone; boarding is standing in front of the open doors).
function addElevatorColliders(level, x, z) {
  level.colliders.push({ x, z, hx: 1.35, hz: 1.2, tall: true });
}

// ---- Wasteland backdrop (ground + upper share it) -----------------------
function buildWasteland(group, rng, { ruinCount = 5, hillCount = 6 }) {
  const hillMat = mat(PALETTE.hills);
  for (let i = 0; i < hillCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(90, 240);
    const r = rng.range(45, 100), h = rng.range(14, 30);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), hillMat);
    hill.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
    group.add(hill);
  }
  const ruinMat = mat(0x8f8578);
  for (let i = 0; i < ruinCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(38, 80);
    const w = rng.range(6, 12), h = rng.range(7, 22), d = rng.range(6, 12);
    box(group, w, h, d, ruinMat, Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist, rng.range(0, Math.PI));
  }
  const treeMat = mat(0x6b5a44);
  for (let i = 0; i < 5; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(20, 40);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, rng.range(4, 7), 5), treeMat);
    trunk.position.set(Math.cos(ang) * dist, 2.5, Math.sin(ang) * dist);
    trunk.rotation.z = rng.range(-0.08, 0.08);
    group.add(trunk);
  }
}

// ---- Ground level -------------------------------------------------------
function buildGround(level, rng, quality) {
  const g = level.group;
  const A = CONFIG.PLAY_AREA, half = A / 2;
  level.floorY = 0.1;
  level.heightAt = (x, z) => (Math.abs(x) < half && Math.abs(z) < half ? 0.1 : 0);
  level.lighting = {
    daySky: PALETTE.daySky, dayHaze: PALETTE.dayHaze,
    fogNear: 60, fogFar: 260, sunDay: 2.2, hemiDay: 0.9, dark: false,
  };

  // Ground plane and a road
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(PALETTE.sand));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
  ground.receiveShadow = quality === 'DESKTOP';
  g.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 600), mat(PALETTE.road, 1.0));
  road.rotation.x = -Math.PI / 2;
  road.position.set(rng.pick([-18, 18]), 0, 0);
  g.add(road);

  // Base floor
  const floor = box(g, A, 0.2, A, mat(PALETTE.concrete), 0, 0, 0);
  floor.receiveShadow = quality === 'DESKTOP';

  // Sandbag perimeter with a gap per side (entries). Sandbags are LOW:
  // they block walking but not bullets. Everything scales with the chosen
  // play-area footprint (SMALL layouts skip clutter entirely).
  const wallMat = mat(PALETTE.sandbag);
  const H = 1.0, T = 0.6;
  const gap = Math.min(3, Math.max(1.2, A / 5));
  const segLen = (A - gap) / 2;
  for (const [side, rot] of [[[0, -half], 0], [[0, half], 0], [[-half, 0], Math.PI / 2], [[half, 0], Math.PI / 2]]) {
    const [dx, dz] = side;
    if (segLen > 0.4) {
      for (const sign of [-1, 1]) {
        const off = sign * (gap / 2 + segLen / 2);
        const x = rot === 0 ? dx + off : dx;
        const z = rot === 0 ? dz : dz + off;
        const seg = box(g, segLen, H, T, wallMat, x, H / 2, z, rot);
        seg.castShadow = seg.receiveShadow = quality === 'DESKTOP';
        level.colliders.push(rot === 0
          ? { x, z, hx: segLen / 2, hz: T / 2, tall: false }
          : { x, z, hx: T / 2, hz: segLen / 2, tall: false });
      }
    }
    level.entries.push(new THREE.Vector3(dx, 0.1, dz));
  }

  // Crates and barrels inside (only when the footprint has room)
  if (A >= 8) {
    const crateMat = mat(PALETTE.wood);
    const barrelMat = mat(PALETTE.rust, 0.7, 0.2);
    for (let i = 0; i < Math.round(A / 3); i++) {
      const s = rng.range(0.6, 1.1);
      const x = rng.range(-half + 2, half - 2), z = rng.range(-half + 2, half - 2);
      if (Math.abs(x) < 2 && Math.abs(z) < 2) continue;  // keep centre open
      box(g, s, s, s, crateMat, x, s / 2 + 0.1, z, rng.range(0, 1));
      level.colliders.push({ x, z, hx: s / 2, hz: s / 2, tall: false });
    }
    for (let i = 0; i < 3; i++) {
      const x = rng.range(-half + 2, half - 2), z = rng.range(-half + 2, half - 2);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 8), barrelMat);
      b.position.set(x, 0.55, z);
      g.add(b);
      level.colliders.push({ x, z, hx: 0.35, hz: 0.35, tall: false });
    }
  }

  buildWasteland(g, rng, {});

  // Elevator just beyond the north gap, doors facing into the base. The
  // BOARDING ZONE sits inside the footprint (roomscale players can only
  // physically reach the playable area): standing in front of the open
  // doors counts as boarding.
  level.elevator = makeElevator();
  level.elevator.group.position.set(0, 0.1, -half - 1.2);
  g.add(level.elevator.group);
  addElevatorColliders(level, 0, -half - 1.2);
  level.elevatorZone = { x: 0, z: -half + 0.9, hx: 1.3, hz: 0.9 };

  // Spawns (fractions of the footprint so every play size works)
  const q = half * 0.3;
  level.playerSpawns = [
    new THREE.Vector3(0, 0.1, q), new THREE.Vector3(q, 0.1, -q * 0.5),
    new THREE.Vector3(-q, 0.1, -q * 0.5), new THREE.Vector3(0, 0.1, -q),
    new THREE.Vector3(q, 0.1, q),
  ];
  // Far spawns: the horde walks in from the wasteland (visible at range).
  for (let i = 0; i < 8; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(26, 42);
    level.zombieSpawns.push(new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist));
  }
}

// ---- Basement level -----------------------------------------------------
function buildBasement(level, rng) {
  const g = level.group;
  const A = CONFIG.PLAY_AREA + 4;    // walls sit just outside the footprint
  const half = A / 2;
  level.floorY = 0.0;
  level.heightAt = () => 0;
  level.lighting = {
    daySky: 0x07090c, dayHaze: 0x0a0c10,
    fogNear: 4, fogFar: 26, sunDay: 0.0, hemiDay: 0.25, dark: true,
  };

  const floorMat = mat(PALETTE.basementFloor, 1.0);
  const wallMat = mat(PALETTE.basementWall, 0.95);
  const ceilMat = mat(0x4a4741, 1.0);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(A, A), floorMat);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(A, A), ceilMat);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 2.6;
  g.add(ceil);

  // Perimeter walls with 3 doorway entries (dark openings). The north
  // side (index 0) hosts the elevator and stays solid. NOTE: an earlier
  // version shuffled sides with Array.sort and a random comparator, which
  // is ENGINE-DEFINED and desynced peers on different browsers.
  const doorSides = [1, 2, 3];
  const sides = [
    { x: 0, z: -half, hx: half, hz: 0.15, rot: 0 },
    { x: 0, z: half, hx: half, hz: 0.15, rot: 0 },
    { x: -half, z: 0, hx: 0.15, hz: half, rot: 1 },
    { x: half, z: 0, hx: 0.15, hz: half, rot: 1 },
  ];
  sides.forEach((s, i) => {
    const hasDoor = doorSides.includes(i);
    const len = half * 2;
    if (!hasDoor) {
      box(g, s.rot ? 0.3 : len, 2.6, s.rot ? len : 0.3, wallMat, s.x, 1.3, s.z);
      level.colliders.push({ x: s.x, z: s.z, hx: s.hx, hz: s.hz, tall: true });
    } else {
      // Two wall segments leaving a 1.6 m doorway in the middle.
      const segLen = (len - 1.6) / 2;
      for (const sign of [-1, 1]) {
        const off = sign * (0.8 + segLen / 2);
        const x = s.rot ? s.x : s.x + off;
        const z = s.rot ? s.z + off : s.z;
        box(g, s.rot ? 0.3 : segLen, 2.6, s.rot ? segLen : 0.3, wallMat, x, 1.3, z);
        level.colliders.push(s.rot
          ? { x, z, hx: 0.15, hz: segLen / 2, tall: true }
          : { x, z, hx: segLen / 2, hz: 0.15, tall: true });
      }
      // Door lintel + pitch-black doorway plane (reads as a hole)
      box(g, s.rot ? 0.3 : 1.6, 0.5, s.rot ? 1.6 : 0.3, wallMat, s.x, 2.35, s.z);
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.05),
        new THREE.MeshBasicMaterial({ color: 0x000000 }));
      dark.position.set(s.x, 1.05, s.z);
      if (s.rot) dark.rotation.y = Math.PI / 2 * (s.x > 0 ? -1 : 1);
      else if (s.z > 0) dark.rotation.y = Math.PI;
      dark.position.x += s.rot ? (s.x > 0 ? -0.16 : 0.16) : 0;
      dark.position.z += s.rot ? 0 : (s.z > 0 ? -0.16 : 0.16);
      g.add(dark);
      const entry = new THREE.Vector3(s.x, 0, s.z);
      level.entries.push(entry);
      level.zombieSpawns.push(entry.clone());
    }
  });

  // Pillar grid + shelving clutter (never near the elevator or its zone)
  const pillarMat = mat(0x5e5a52, 1.0);
  const elevX = 0, elevZ = -half + 1.3;
  const zoneZ = Math.max(-CONFIG.PLAY_AREA / 2 + 0.9, -half + 3.0);
  for (const px of [-half / 2, half / 2]) {
    for (const pz of [-half / 2, half / 2]) {
      const x = px + rng.range(-1, 1), z = pz + rng.range(-1, 1);
      if (Math.hypot(x - elevX, z - elevZ) < 2.6) continue;
      if (Math.hypot(x - elevX, z - zoneZ) < 2.2) continue;
      box(g, 0.6, 2.6, 0.6, pillarMat, x, 1.3, z);
      level.colliders.push({ x, z, hx: 0.3, hz: 0.3, tall: true });
    }
  }
  if (A >= 10) {
    const shelfMat = mat(PALETTE.wood, 1.0);
    for (let i = 0; i < 4; i++) {
      const x = rng.range(-half + 2, half - 2), z = rng.range(-half + 2, half - 2);
      if (Math.abs(x) < 2.5 && Math.abs(z) < 2.5) continue;
      box(g, 1.6, 1.8, 0.5, shelfMat, x, 0.9, z, rng.pick([0, Math.PI / 2]));
      level.colliders.push({ x, z, hx: 0.8, hz: 0.8, tall: false });
    }
  }

  // Sparse hanging work lamps (the flashlight does the real work)
  for (let i = 0; i < 2; i++) {
    const x = rng.range(-half / 2, half / 2), z = rng.range(-half / 2, half / 2);
    const lamp = new THREE.PointLight(0xffd9a0, 1.1, 11);
    lamp.position.set(x, 2.3, z);
    g.add(lamp);
    box(g, 0.25, 0.1, 0.25, mat(0x333333), x, 2.45, z);
  }

  // Elevator against the north wall, doors facing into the room (+Z is
  // the cab's door side; no rotation needed). Boarding zone inside the
  // play footprint so roomscale players can reach it.
  const playHalf = CONFIG.PLAY_AREA / 2;
  level.elevator = makeElevator();
  level.elevator.group.position.set(0, 0, -half + 1.3);
  g.add(level.elevator.group);
  addElevatorColliders(level, 0, -half + 1.3);
  level.elevatorZone = { x: 0, z: Math.max(-playHalf + 0.9, -half + 3.0), hx: 1.3, hz: 0.9 };

  const qb = half * 0.28;
  level.playerSpawns = [
    new THREE.Vector3(0, 0, qb), new THREE.Vector3(qb, 0, -qb * 0.5),
    new THREE.Vector3(-qb, 0, -qb * 0.5), new THREE.Vector3(0, 0, -qb),
    new THREE.Vector3(qb, 0, qb),
  ];
}

// ---- Upper floor --------------------------------------------------------
function buildUpper(level, rng, quality) {
  const g = level.group;
  const A = CONFIG.PLAY_AREA + 2;
  const half = A / 2;
  const STOREY = 12;                 // how high up we are
  level.floorY = 0;
  // Room and balcony are at 0; everything beyond the walls drops to the
  // street (so grenades over the balcony fall and burn down there, and
  // nothing floats at window height).
  const inHalf = A / 2 + 0.6;
  level.heightAt = (x, z) => {
    if (Math.abs(x) <= inHalf && Math.abs(z) <= inHalf) return 0;
    if (Math.abs(x) <= A * 0.3 && z > A / 2 && z < A / 2 + 2.5) return 0;   // balcony
    return -STOREY;
  };
  level.lighting = {
    daySky: PALETTE.daySky, dayHaze: PALETTE.dayHaze,
    fogNear: 70, fogFar: 300, sunDay: 2.0, hemiDay: 0.8, dark: false,
  };

  const floorMat = mat(PALETTE.interiorFloor, 0.95);
  const wallMat = mat(PALETTE.interiorWall, 0.95);

  // Room floor and ceiling
  const floor = box(g, A, 0.2, A, floorMat, 0, -0.1, 0);
  floor.receiveShadow = quality === 'DESKTOP';
  box(g, A, 0.15, A, mat(0x6d6355, 1.0), 0, 2.8, 0);
  // Interior fill: window bounce light (the sun itself cannot reach in
  // without shadows, so the room needs its own warmth to stay readable).
  for (const lx of [-3, 3]) {
    const fill = new THREE.PointLight(0xffeecd, 0.85, 14);
    fill.position.set(lx, 2.3, 1.5);
    g.add(fill);
  }

  // South side: window wall with sills (shoot out, low collider) + balcony
  const sillH = 1.0;
  const winW = Math.min(1.8, A / 3);
  const nWin = Math.max(1, Math.min(3, Math.floor(A / 4)));
  const gapTotal = A - nWin * winW;
  const pierW = gapTotal / (nWin + 1);
  let cx = -half + pierW / 2;
  for (let i = 0; i <= nWin; i++) {
    box(g, pierW, 2.8, 0.25, wallMat, cx, 1.4, half);
    level.colliders.push({ x: cx, z: half, hx: pierW / 2, hz: 0.125, tall: true });
    cx += pierW + winW;
  }
  // Continuous sill under the windows (low: blocks walking, not shooting)
  box(g, A, sillH, 0.25, wallMat, 0, sillH / 2, half);
  level.colliders.push({ x: 0, z: half, hx: half, hz: 0.125, tall: false });
  // Window headers
  box(g, A, 0.5, 0.25, wallMat, 0, 2.55, half);

  // Balcony outside the window wall with a railing
  const balc = box(g, A * 0.6, 0.15, 2.2, mat(PALETTE.concrete), 0, -0.075, half + 1.35);
  balc.receiveShadow = quality === 'DESKTOP';
  box(g, A * 0.6, 0.9, 0.08, mat(PALETTE.metalDark, 0.6, 0.4), 0, 0.45, half + 2.4);

  // Other three walls, two with stairwell door entries
  const walls = [
    { x: 0, z: -half, rot: 0, door: true },
    { x: -half, z: 0, rot: 1, door: true },
    { x: half, z: 0, rot: 1, door: false },
  ];
  for (const w of walls) {
    const len = A;
    if (!w.door) {
      box(g, w.rot ? 0.25 : len, 2.8, w.rot ? len : 0.25, wallMat, w.x, 1.4, w.z);
      level.colliders.push(w.rot
        ? { x: w.x, z: w.z, hx: 0.125, hz: half, tall: true }
        : { x: w.x, z: w.z, hx: half, hz: 0.125, tall: true });
    } else {
      const segLen = (len - 1.6) / 2;
      for (const sign of [-1, 1]) {
        const off = sign * (0.8 + segLen / 2);
        const x = w.rot ? w.x : w.x + off;
        const z = w.rot ? w.z + off : w.z;
        box(g, w.rot ? 0.25 : segLen, 2.8, w.rot ? segLen : 0.25, wallMat, x, 1.4, z);
        level.colliders.push(w.rot
          ? { x, z, hx: 0.125, hz: segLen / 2, tall: true }
          : { x, z, hx: segLen / 2, hz: 0.125, tall: true });
      }
      box(g, w.rot ? 0.25 : 1.6, 0.6, w.rot ? 1.6 : 0.25, wallMat, w.x, 2.5, w.z);
      const entry = new THREE.Vector3(w.x, 0, w.z);
      level.entries.push(entry);
      level.zombieSpawns.push(entry.clone());
    }
  }

  // Interior clutter: desks, filing cabinets (skipped in tight footprints)
  if (A >= 9) {
    const deskMat = mat(PALETTE.wood, 0.9);
    for (let i = 0; i < 4; i++) {
      const x = rng.range(-half + 2, half - 3), z = rng.range(-half + 2, half - 3);
      if (Math.abs(x) < 2 && Math.abs(z) < 2) continue;
      box(g, 1.4, 0.75, 0.7, deskMat, x, 0.375, z, rng.pick([0, Math.PI / 2]));
      level.colliders.push({ x, z, hx: 0.7, hz: 0.7, tall: false });
    }
  }

  // The world below: street, opposing buildings, wasteland horizon
  const streetY = -STOREY;
  const street = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(PALETTE.road, 1.0));
  street.rotation.x = -Math.PI / 2; street.position.y = streetY;
  g.add(street);
  const facadeMat = mat(0x8f8578);
  for (let i = 0; i < 6; i++) {
    const w = rng.range(8, 16), h = rng.range(6, STOREY + 6), d = rng.range(8, 14);
    const x = rng.range(-60, 60);
    const z = half + rng.range(18, 60);
    box(g, w, h, d, facadeMat, x, streetY + h / 2, z, 0);
  }
  // Our own building's facade below the balcony
  box(g, A + 6, STOREY, 3, mat(PALETTE.interiorWall), 0, streetY + STOREY / 2 - 0.2, half + 0.5 - 1.5 + 1.5);

  // Elevator on the windowless east wall, doors facing -X into the room.
  // Boarding zone in front of the doors, inside the play footprint.
  level.elevator = makeElevator();
  level.elevator.group.position.set(half - 1.6, 0, half / 2);
  level.elevator.group.rotation.y = -Math.PI / 2;
  g.add(level.elevator.group);
  addElevatorColliders(level, half - 1.6, half / 2);
  level.elevatorZone = { x: half - 3.2, z: half / 2, hx: 1.3, hz: 1.1 };

  const qu = half * 0.3;
  level.playerSpawns = [
    new THREE.Vector3(0, 0, qu), new THREE.Vector3(qu, 0, 0),
    new THREE.Vector3(-qu, 0, 0), new THREE.Vector3(0, 0, -qu),
    new THREE.Vector3(-qu, 0, qu),
  ];
  // NOTE: street-level "target practice" spawns were removed: the sim's
  // heightAt() would teleport them to room height where they float at the
  // windows and bite through the sill (review find). Street ambience
  // returns as pure visuals in the Phase 3 polish pass; all real pressure
  // comes through the stairwell doors.
}

// ---- Trench (tight, night, flashlight) ----------------------------------
// A serpentine dirt trench carved through a raised night field. Corridors
// are the walkable cells; everything else is dirt wall (tall colliders).
// Compact variant for SMALL/MEDIUM play areas: one straight trench lane
// that fits the physical footprint (the serpentine needs 8 m+).
function buildTrenchSmall(level, rng) {
  const g = level.group;
  const play = CONFIG.PLAY_AREA;
  const half = play / 2 + 1;                 // walls just outside the footprint
  level.floorY = 0;
  level.heightAt = () => 0;
  level.lighting = {
    daySky: 0x141d30, dayHaze: 0x18223a,
    fogNear: 6, fogFar: 55, sunDay: 0.0, hemiDay: 0.32, dark: true,
  };
  const dirtMat = mat(0x4e4436, 1.0);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 2, half * 2 + 2), mat(0x3c352b, 1.0));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(0x2c3226, 1.0));
  field.rotation.x = -Math.PI / 2;
  field.position.y = 2.3;
  g.add(field);
  // North and south dirt walls form the lane; east end open (entry),
  // west end holds the elevator.
  for (const z of [-half, half]) {
    box(g, half * 2 + 2, 2.4, 1.6, dirtMat, 0, 1.2, z);
    level.colliders.push({ x: 0, z, hx: half + 1, hz: 0.8, tall: true });
  }
  const flare = new THREE.PointLight(0xff7030, 1.6, 8);
  flare.position.set(0, 0.3, 0);
  g.add(flare);
  box(g, 0.05, 0.25, 0.05, mat(0xff5020, 0.5), 0, 0.12, 0);

  level.elevator = makeElevator();
  level.elevator.group.position.set(-half - 1.2, 0, 0);
  level.elevator.group.rotation.y = Math.PI / 2;   // doors face +X down the lane
  g.add(level.elevator.group);
  addElevatorColliders(level, -half - 1.2, 0);
  level.elevatorZone = { x: -play / 2 + 0.9, z: 0, hx: 1.2, hz: 1.0 };

  const entry = new THREE.Vector3(half + 0.5, 0, 0);
  level.entries.push(entry);
  level.zombieSpawns.push(entry.clone());
  level.playerSpawns = [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.8, 0, 0.5),
    new THREE.Vector3(-0.8, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(-0.5, 0, 0.5),
  ];
}

function buildTrench(level, rng) {
  if (CONFIG.PLAY_AREA < 8) { buildTrenchSmall(level, rng); return; }
  const g = level.group;
  const A = CONFIG.PLAY_AREA;                // serpentine fits the footprint
  const half = A / 2;
  level.floorY = 0;
  level.heightAt = () => 0;
  level.lighting = {
    daySky: 0x141d30, dayHaze: 0x18223a,
    fogNear: 6, fogFar: 55, sunDay: 0.0, hemiDay: 0.32, dark: true,
  };

  const dirtMat = mat(0x4e4436, 1.0);
  const floorMat = mat(0x3c352b, 1.0);

  // Floor of the whole trench area + raised field beyond
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(A + 2, A + 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(0x2c3226, 1.0));
  field.rotation.x = -Math.PI / 2;
  field.position.y = 2.3;
  g.add(field);
  // Carve a hole illusion: the field plane sits above; the trench area is
  // sunk. Rim walls around the whole area:
  for (const [x, z, w, d] of [
    [0, -half - 1, A + 4, 2], [0, half + 1, A + 4, 2],
    [-half - 1, 0, 2, A + 4], [half + 1, 0, 2, A + 4]]) {
    box(g, w, 2.4, d, dirtMat, x, 1.2, z);
    level.colliders.push({ x, z, hx: w / 2, hz: d / 2, tall: true });
  }

  // Serpentine: three lanes (south, middle, north) joined by connectors at
  // alternating ends. Dirt blocks fill the gaps between lanes.
  const laneZ = [-A / 3, 0, A / 3];
  const laneHalfW = 1.15;
  // Lane0<->lane1 connector is ALWAYS on the east side: the elevator sits
  // at lane 0's west end and its collider would seal a west connector
  // (softlock found in review). Only the second connector varies.
  const conn = [1, rng.chance(0.5) ? -1 : 1];
  // Between lane 0-1 and 1-2, place a dirt block covering everything
  // except the connector opening.
  const connectorPoints = [];
  for (let i = 0; i < 2; i++) {
    const zMid = (laneZ[i] + laneZ[i + 1]) / 2;
    const gapX = conn[i] * (half - 1.6);
    connectorPoints.push(new THREE.Vector3(gapX, 0, zMid));
    const blockD = (laneZ[i + 1] - laneZ[i]) - laneHalfW * 2;
    // Two blocks: from -half to gap-1.4, and gap+1.4 to half
    const leftW = (gapX - 1.4) - (-half);
    if (leftW > 0.5) {
      const cx = -half + leftW / 2;
      box(g, leftW, 2.4, blockD, dirtMat, cx, 1.2, zMid);
      level.colliders.push({ x: cx, z: zMid, hx: leftW / 2, hz: blockD / 2, tall: true });
    }
    const rightW = half - (gapX + 1.4);
    if (rightW > 0.5) {
      const cx = gapX + 1.4 + rightW / 2;
      box(g, rightW, 2.4, blockD, dirtMat, cx, 1.2, zMid);
      level.colliders.push({ x: cx, z: zMid, hx: rightW / 2, hz: blockD / 2, tall: true });
    }
  }

  // Duckboards, crates, a flare or two
  for (let i = 0; i < 3; i++) {
    const lane = rng.int(0, 2);
    const x = rng.range(-half + 2, half - 2);
    box(g, 1.2, 0.06, 1.8, mat(PALETTE.wood, 1.0), x, 0.04, laneZ[lane]);
  }
  for (const i of [0, 1]) {
    const x = rng.range(-half + 2, half - 2);
    const z = laneZ[rng.int(0, 2)];
    const flare = new THREE.PointLight(0xff7030, 1.6, 8);
    flare.position.set(x, 0.3, z);
    g.add(flare);
    box(g, 0.05, 0.25, 0.05, mat(0xff5020, 0.5), x, 0.12, z);
  }

  // Entries: the two open lane-ends without the elevator; elevator takes
  // the south-west lane end.
  level.elevator = makeElevator();
  level.elevator.group.position.set(-half + 1.2, 0, laneZ[0]);
  level.elevator.group.rotation.y = Math.PI / 2;   // doors face +X into the lane
  g.add(level.elevator.group);
  addElevatorColliders(level, -half + 1.2, laneZ[0]);
  level.elevatorZone = { x: -half + 3.0, z: laneZ[0], hx: 1.2, hz: 1.0 };

  for (const e of [[half - 0.6, laneZ[0]], [-half + 0.6, laneZ[2]], [half - 0.6, laneZ[2]]]) {
    const entry = new THREE.Vector3(e[0], 0, e[1]);
    level.entries.push(entry);
    level.zombieSpawns.push(entry.clone());
  }
  // Connector openings double as routing waypoints so zombies can walk
  // the serpentine hop by hop (entries are used as goals when line of
  // sight is blocked); they are NOT spawn points.
  for (const c of connectorPoints) level.entries.push(c);

  const qt = half * 0.25;
  level.playerSpawns = [
    new THREE.Vector3(0, 0, laneZ[1]), new THREE.Vector3(qt, 0, laneZ[1]),
    new THREE.Vector3(-qt, 0, laneZ[1]), new THREE.Vector3(0, 0, laneZ[0]),
    new THREE.Vector3(qt, 0, laneZ[0]),
  ];
}

// ---- Wagon (moving platform) --------------------------------------------
// A flatbed rail wagon rolling through the night wasteland. Players stand
// on the bed; the world scrolls past; zombies lunge in over the open ends.
function buildWagon(level, rng) {
  const g = level.group;
  const A = CONFIG.PLAY_AREA;
  const W = Math.max(3, Math.min(A * 0.8, 5));    // bed width
  const L = Math.max(6, A);                       // bed length
  level.floorY = 0.5;
  level.heightAt = (x, z) => (Math.abs(x) < W / 2 && Math.abs(z) < L / 2 ? 0.5 : 0);
  level.lighting = {
    daySky: 0x2c3450, dayHaze: 0x2a3048,
    fogNear: 25, fogFar: 160, sunDay: 0.5, hemiDay: 0.5, dark: false,
  };

  // Bed, rails, wheels
  const bed = box(g, W, 0.24, L, mat(PALETTE.wood, 0.95), 0, 0.38, 0);
  bed.receiveShadow = false;
  const railMat = mat(PALETTE.metalDark, 0.5, 0.6);
  for (const dx of [-0.8, 0.8]) {
    box(g, 0.12, 0.1, 400, railMat, dx, 0.05, 0);
  }
  for (const dz of [-L / 3, L / 3]) {
    for (const dx of [-0.8, 0.8]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), railMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(dx, 0.28, dz);
      g.add(wheel);
    }
  }
  // Side railings: low, block walking off the sides (not the ends)
  for (const dx of [-W / 2, W / 2]) {
    box(g, 0.08, 0.85, L, mat(PALETTE.rust, 0.8), dx, 0.92, 0);
    level.colliders.push({ x: dx, z: 0, hx: 0.06, hz: L / 2, tall: false });
  }
  // A crate to duck behind
  box(g, 1.0, 0.9, 1.0, mat(PALETTE.wood), 0, 0.95, 0);
  level.colliders.push({ x: 0, z: 0, hx: 0.5, hz: 0.5, tall: false });
  // Lantern on a pole
  const lamp = new THREE.PointLight(0xffd9a0, 1.2, 10);
  lamp.position.set(0, 2.4, -L / 4);
  g.add(lamp);
  box(g, 0.06, 2.0, 0.06, railMat, 0, 1.4, -L / 4);

  // Scrolling scenery: two long ground segments leapfrogging along Z,
  // dressed with hills/ruins. level.tick(dt) drives the motion.
  const SEG = 220;
  const segs = [];
  for (let i = 0; i < 2; i++) {
    const seg = new THREE.Group();
    const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, SEG), mat(PALETTE.sand));
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = -0.02;
    seg.add(groundPlane);
    const segRng = makeRng(1000 + i);
    for (let h = 0; h < 5; h++) {
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(segRng.range(30, 70), segRng.range(10, 24), 7),
        mat(PALETTE.hills));
      hill.position.set(segRng.pick([-1, 1]) * segRng.range(40, 120), 0, segRng.range(-SEG / 2, SEG / 2));
      seg.add(hill);
    }
    for (let r = 0; r < 3; r++) {
      const w = segRng.range(6, 12), hh = segRng.range(6, 16), d = segRng.range(6, 12);
      const ruin = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat(0x6f675c));
      ruin.position.set(segRng.pick([-1, 1]) * segRng.range(12, 60), hh / 2, segRng.range(-SEG / 2, SEG / 2));
      seg.add(ruin);
    }
    for (let t = 0; t < 4; t++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 5), mat(0x4a4038));
      pole.position.set(segRng.pick([-1, 1]) * 3.2, 2.5, segRng.range(-SEG / 2, SEG / 2));
      seg.add(pole);
    }
    seg.position.z = -i * SEG;
    g.add(seg);
    segs.push(seg);
  }
  const SPEED = 9;   // m/s, forward = -Z
  level.tick = (dt) => {
    for (const seg of segs) {
      seg.position.z += SPEED * dt;
      if (seg.position.z > SEG) seg.position.z -= SEG * 2;
    }
  };

  // No elevator on a wagon: the ride simply arrives (state.js handles it).
  level.elevator = null;
  level.elevatorZone = null;

  // Zombies vault in over the open ends of the bed.
  for (const ez of [-L / 2 - 1.5, L / 2 + 1.5]) {
    const entry = new THREE.Vector3(0, 0, ez);
    level.entries.push(entry);
    level.zombieSpawns.push(entry.clone());
    level.zombieSpawns.push(new THREE.Vector3(1.5, 0, ez * 1.2));
    level.zombieSpawns.push(new THREE.Vector3(-1.5, 0, ez * 1.2));
  }

  level.playerSpawns = [
    new THREE.Vector3(0, 0.5, 1.5), new THREE.Vector3(0.8, 0.5, -1.5),
    new THREE.Vector3(-0.8, 0.5, -1.5), new THREE.Vector3(0.8, 0.5, 1.5),
    new THREE.Vector3(-0.8, 0.5, 2.5),
  ];
}

// ---- Entry point --------------------------------------------------------
export function buildLevel(scene, quality, runSeed, levelIndex) {
  const type = levelTypeFor(levelIndex);
  const rng = makeRng((runSeed * 7919 + levelIndex * 104729) >>> 0);
  const level = {
    type, index: levelIndex,
    group: new THREE.Group(),
    colliders: [], entries: [], zombieSpawns: [], playerSpawns: [],
    elevator: null, elevatorZone: null,
    floorY: 0, heightAt: () => 0, lighting: null,
  };
  if (type === 'ground') buildGround(level, rng, quality);
  else if (type === 'basement') buildBasement(level, rng);
  else if (type === 'upper') buildUpper(level, rng, quality);
  else if (type === 'trench') buildTrench(level, rng);
  else buildWagon(level, rng);
  scene.add(level.group);
  return level;
}

export function disposeLevel(scene, level) {
  if (!level) return;
  scene.remove(level.group);
  level.group.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}
