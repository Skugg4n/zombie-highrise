// Level generator. Every peer builds the SAME level locally from the
// shared (runSeed, levelIndex) pair; geometry is never networked.
//
// PLAYTEST LAW (Ola, 2026-08-23): the physical play area constrains ONLY
// where a roomscale VR player may walk. It NEVER constrains the level.
// Levels are large (LEVEL_SIZE), open and multi-route for every platform:
// corridors, connected spaces, cover, verticality and long sightlines.
// The roomscale zone is a marked patch of floor placed inside them.
//
// A Level object owns: one THREE.Group (whole level, easy dispose),
// colliders ({x,z,hx,hz,tall}) where tall=true also blocks bullets,
// ramps (walkable tops), entries (where zombies enter), spawnSources
// (the VISIBLE fiction for each entry: stairwell, shaft, breach, gate),
// player spawns, barrels, the elevator and per-level lighting.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeRng } from '../util/rng.js';
import { noiseTexture, plankTexture, metalTexture, sandbagTexture, facadeTexture } from './textures.js';
import { mergeStaticMeshes } from './merge.js';
import {
  LEVEL_SIZE, scaleBoxUVs, box, wall, cover, platform, railing,
  stairwell, openShaft, breach, facadeClimb, roomscaleZone, makeHeightAt,
} from './kit.js';

export { LEVEL_SIZE };

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
// 12-level supercycle: two runs of the 6-type rotation, with the second
// wagon slot replaced by the BOSS arena (floors 12, 24, ...). Peaks and
// breathers by construction: wagon = breather, boss = peak.
export const LEVEL_TYPES = [
  'ground', 'basement', 'upper', 'ground', 'trench', 'wagon',
  'ground', 'basement', 'upper', 'ground', 'trench', 'boss',
];
// A run is exactly FINAL_LEVEL floors long: floor 12 is the Butcher's
// arena, and beating it triggers the roof finale (the run's win state).
export const FINAL_LEVEL = LEVEL_TYPES.length;
export function levelTypeFor(levelIndex) {
  return LEVEL_TYPES[(levelIndex - 1) % LEVEL_TYPES.length];
}

const mat = (color, rough = 0.9, metal = 0.0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const matT = (map, rough = 0.9, metal = 0.0, color = 0xffffff) =>
  new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: metal });

// Shared procedural materials (built once, reused by every level build).
export const MATS = {
  get sandGround() { return this._sg || (this._sg = matT(noiseTexture('sand-ground', 0xc9b088, [0xb89e76, 0xd8c29a, 0xa8906a], { repeat: 90, density: 1200 }), 1.0)); },
  get concrete() { return this._co || (this._co = matT(noiseTexture('concrete', 0x9a938a, [0x8a847c, 0xa8a29a, 0x7e7870], { repeat: 5, density: 1400, alpha: 0.2 }), 0.95)); },
  get sandbag() { return this._sb || (this._sb = matT(sandbagTexture('sandbag', 0xb0a070), 1.0)); },
  get crate() { return this._cr || (this._cr = matT(plankTexture('crate', 0x8a6f4d, 0x5c4630), 0.95)); },
  get basementWall() { return this._bw || (this._bw = matT(noiseTexture('bwall', 0x6e6a63, [0x5c584f, 0x7c786f, 0x4c4841], { repeat: 3, density: 1600, alpha: 0.22 }), 1.0)); },
  get basementFloor() { return this._bf || (this._bf = matT(noiseTexture('bfloor', 0x55524c, [0x45423c, 0x63605a, 0x39362f], { repeat: 8, density: 1600, alpha: 0.25 }), 1.0)); },
  get plaster() { return this._pl || (this._pl = matT(noiseTexture('plaster', 0x8f8274, [0x7f7264, 0x9f9284, 0x6f6254], { repeat: 3, density: 900, alpha: 0.15 }), 0.95)); },
  get parquet() { return this._pq || (this._pq = matT(plankTexture('parquet', 0x7a6a52, 0x54462f, { planks: 8, repeat: 1 }), 0.9)); },
  get metalShell() { return this._ms || (this._ms = matT(metalTexture('elev', 0x5a5d63, { repeat: 2 }), 0.55, 0.5)); },
  get metalDoor() { return this._md || (this._md = matT(metalTexture('door', 0x42454b, { repeat: 2 }), 0.6, 0.4)); },
  get dirt() { return this._di || (this._di = matT(noiseTexture('dirt', 0x4e4436, [0x3e3628, 0x5e5244, 0x2f2a1f], { repeat: 4, density: 1800, alpha: 0.25 }), 1.0)); },
  get planksOld() { return this._po || (this._po = matT(plankTexture('oldplanks', 0x6e5a40, 0x463a26, { planks: 6, repeat: 2 }), 1.0)); },
  get facade() { return this._fa || (this._fa = new THREE.MeshStandardMaterial({ map: facadeTexture('tower', 0x5c554c), roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.0, emissiveMap: facadeTexture('tower', 0x5c554c, { emissiveOnly: true }) })); },
};

// The game's namesake: a tall high-rise silhouette with a lit window grid
// and a broken roofline. The whole run happens inside this building; it
// anchors every exterior shot.
function buildHighRise(group, x, z, { w = 15, h = 48, d = 13 } = {}) {
  const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MATS.facade);
  // The facade texture tiles per ~4.8 m floor via UV scaling.
  scaleBoxUVs(tower.geometry, w / 5, h / 24, d / 5);
  tower.position.set(x, h / 2, z);
  group.add(tower);
  // Broken roofline: offset slabs + a water tank + antenna
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 2.6, d * 0.7),
    new THREE.MeshStandardMaterial({ color: 0x4c463e, roughness: 0.95 }));
  slab.position.set(x - w * 0.18, h + 1.3, z);
  group.add(slab);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x6a5644, roughness: 0.8 }));
  tank.position.set(x + w * 0.24, h + 1.5, z + d * 0.15);
  group.add(tank);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 7, 4),
    new THREE.MeshStandardMaterial({ color: 0x333333 }));
  antenna.position.set(x + w * 0.1, h + 3.5, z - d * 0.2);
  group.add(antenna);
}

// ---- The elevator (shared by every level) -------------------------------
// Worn metal cab, two sliding doors, an interior lamp. The cab IS the shop
// and the transition between levels; it sits at the edge of the play area.
export function makeElevator() {
  const g = new THREE.Group();
  const shell = MATS.metalShell;
  const dark = MATS.metalDoor;
  const W = 2.6, H = 2.5, D = 2.2, T = 0.08;

  box(g, W, T, D, dark, 0, T / 2, 0);                    // floor
  box(g, W, T, D, dark, 0, H - T / 2, 0);                // ceiling
  box(g, W, H, T, shell, 0, H / 2, -D / 2);              // back
  box(g, T, H, D, shell, -W / 2, H / 2, 0);              // left
  box(g, T, H, D, shell, W / 2, H / 2, 0);               // right
  // Door frame header
  box(g, W, 0.35, T, shell, 0, H - 0.175, D / 2);
  // Sliding doors (front, facing +Z); dynamic: excluded from merging
  const doorL = box(g, W / 2 - 0.05, H - 0.35, 0.06, dark, -W / 4, (H - 0.35) / 2, D / 2);
  const doorR = box(g, W / 2 - 0.05, H - 0.35, 0.06, dark, W / 4, (H - 0.35) / 2, D / 2);
  doorL.userData.dynamic = true;
  doorR.userData.dynamic = true;
  // Flickering fluorescent tube (the lamp's visible source)
  const tube = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.05, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xf8f4e8, emissive: 0xfff4d8, emissiveIntensity: 1.4 }));
  tube.position.set(0, H - 0.12, 0);
  g.add(tube);
  // Button panel with two glowing buttons
  box(g, 0.22, 0.5, 0.03, MATS.metalDoor, W / 2 - 0.16, 1.25, D / 2 - 0.35);
  for (const [by, on] of [[1.35, true], [1.18, false]]) {
    const btn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8),
      new THREE.MeshStandardMaterial({
        color: 0x202020, emissive: on ? 0xffa030 : 0x203020, emissiveIntensity: on ? 1.2 : 0.4,
      }));
    btn.rotation.x = Math.PI / 2;
    btn.position.set(W / 2 - 0.16, by, D / 2 - 0.33);
    g.add(btn);
  }
  // Hazard stripe across the door sill
  const stripeC = document.createElement('canvas');
  stripeC.width = 64; stripeC.height = 16;
  const sc = stripeC.getContext('2d');
  sc.fillStyle = '#c8a020'; sc.fillRect(0, 0, 64, 16);
  sc.fillStyle = '#1c1c1c';
  for (let i = -1; i < 5; i++) {
    sc.beginPath();
    sc.moveTo(i * 16, 16); sc.lineTo(i * 16 + 8, 0);
    sc.lineTo(i * 16 + 16, 0); sc.lineTo(i * 16 + 8, 16);
    sc.fill();
  }
  const stripeTex = new THREE.CanvasTexture(stripeC);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, 0.18),
    new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.8 }));
  sill.position.set(0, T + 0.02, D / 2 - 0.06);
  g.add(sill);
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
  const holeMat = mat(0x1a1712, 1.0);
  for (let i = 0; i < ruinCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(38, 80);
    const w = rng.range(6, 12), h = rng.range(7, 22), d = rng.range(6, 12);
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    const ry = rng.range(0, Math.PI);
    const body = box(group, w, h, d, ruinMat, x, h / 2, z, ry);
    // Broken roofline: a second, offset shorter block on top
    box(group, w * rng.range(0.35, 0.6), rng.range(1.5, 3.5), d * rng.range(0.5, 0.9),
      ruinMat, x + rng.range(-w / 4, w / 4), h + 1, z, ry);
    // Dark window holes on the facade facing the base (rows of dark quads)
    const rows = Math.max(1, Math.floor(h / 5));
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < 2; cIdx++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2), holeMat);
        const lx = (cIdx - 0.5) * w * 0.4;
        const lyy = 2.5 + r * 5;
        win.position.set(
          x + Math.cos(ry) * lx - Math.sin(ry) * (d / 2 + 0.02),
          lyy,
          z - Math.sin(ry) * lx - Math.cos(ry) * (d / 2 + 0.02));
        win.rotation.y = ry + Math.PI;
        group.add(win);
      }
    }
    // Exposed rebar on the roof edge
    for (let rb = 0; rb < 3; rb++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, rng.range(0.8, 1.6), 4),
        mat(0x4a3626, 0.9));
      bar.position.set(x + rng.range(-w / 2, w / 2), h + rng.range(0.3, 0.7), z + rng.range(-d / 3, d / 3));
      bar.rotation.z = rng.range(-0.3, 0.3);
      group.add(bar);
    }
    void body;
  }
  // A wrecked car in the midground: the classic wasteland anchor prop
  {
    const cx = rng.range(-30, 30), cz = rng.pick([-1, 1]) * rng.range(18, 30);
    const bodyMat = mat(rng.pick([0x7d4a38, 0x4a5a68, 0x6a6a52]), 0.6, 0.3);
    box(group, 3.6, 0.75, 1.7, bodyMat, cx, 0.55, cz, rng.range(0, Math.PI));
    box(group, 2.0, 0.55, 1.5, bodyMat, cx, 1.15, cz, rng.range(0, Math.PI));
    for (const [dx, dz] of [[-1.2, -0.85], [1.2, -0.85], [-1.2, 0.85], [1.2, 0.85]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.22, 8), mat(0x1f1f1f, 1.0));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(cx + dx, 0.3, cz + dz);
      group.add(wheel);
    }
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

// =========================================================================
// LEVEL BUILDERS
//
// Rewritten after Ola's playtest. The old builders sized every level from
// CONFIG.PLAY_AREA, so picking SMALL gave a 3 m shoebox on every platform.
// Now: LEVEL_SIZE is fixed and generous, levels are multi-route with
// corridors, cover and verticality, and the play area only decides where
// the roomscale zone is painted. "Shoot far, walk near."
// =========================================================================

// ---- Ground level: a fortified compound with an outer yard --------------
function buildGround(level, rng, quality) {
  const g = level.group;
  const S = LEVEL_SIZE;              // 34 m compound, always
  const half = S / 2;
  level.floorY = 0;
  level.baseY = 0;

  level.lighting = {
    daySky: PALETTE.daySky, dayHaze: PALETTE.dayHaze,
    fogNear: 70, fogFar: 300, sunDay: 2.2, hemiDay: 0.95, dark: false,
  };

  // Open wasteland floor far past the compound: the long sightlines.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), MATS.sandGround);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = quality === 'DESKTOP';
  g.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 600), mat(PALETTE.road, 1.0));
  road.rotation.x = -Math.PI / 2;
  road.position.set(rng.pick([-1, 1]) * (half + 12), 0.01, 0);
  g.add(road);

  // Compound slab
  const slab = box(g, S, 0.2, S, MATS.concrete, 0, 0, 0);
  slab.receiveShadow = quality === 'DESKTOP';

  // Perimeter: tall wall segments with THREE gates. Gates are the only
  // ways in, and each is a visible, readable source of the horde.
  const wallMat = MATS.sandbag;
  const gates = [
    { x: 0, z: -half, ax: 'x' },
    { x: -half, z: 0, ax: 'z' },
    { x: half, z: 4, ax: 'z' },
  ];
  const GATE_W = 3.4;
  const isGate = (side, along) => gates.some((gt) =>
    gt.ax === side && Math.abs(along - (side === 'x' ? gt.x : gt.z)) < GATE_W / 2 + 0.1);
  // Build each side as a run of 1 m posts, skipping gate spans.
  for (const side of ['x', 'z']) {
    for (const sign of [-1, 1]) {
      for (let a = -half + 0.5; a <= half - 0.5; a += 1) {
        const onGate = gates.some((gt) => {
          const gtSide = gt.ax;
          const gtPos = gtSide === 'x' ? gt.z : gt.x;
          if (gtSide !== side) return false;
          if (Math.sign(gtPos) !== sign && Math.abs(gtPos) > 0.5) return false;
          const gtAlong = gtSide === 'x' ? gt.x : gt.z;
          return Math.abs(a - gtAlong) < GATE_W / 2;
        });
        if (onGate) continue;
        const x = side === 'x' ? a : sign * half;
        const z = side === 'x' ? sign * half : a;
        box(g, side === 'x' ? 1.02 : 0.7, 2.6, side === 'x' ? 0.7 : 1.02, wallMat, x, 1.3, z);
        level.colliders.push({
          x, z,
          hx: side === 'x' ? 0.51 : 0.35,
          hz: side === 'x' ? 0.35 : 0.51,
          tall: true,
        });
      }
    }
  }
  void isGate;
  // Gate frames + the entries themselves
  for (const gt of gates) {
    const gx = gt.ax === 'x' ? gt.x : gt.x;
    const gz = gt.ax === 'x' ? gt.z : gt.z;
    for (const s of [-1, 1]) {
      const px = gt.ax === 'x' ? gx + s * (GATE_W / 2 + 0.3) : gx;
      const pz = gt.ax === 'x' ? gz : gz + s * (GATE_W / 2 + 0.3);
      box(g, 0.5, 3.4, 0.5, MATS.metalShell, px, 1.7, pz);
      level.colliders.push({ x: px, z: pz, hx: 0.25, hz: 0.25, tall: true });
    }
    box(g, gt.ax === 'x' ? GATE_W + 1.0 : 0.4, 0.4, gt.ax === 'x' ? 0.4 : GATE_W + 1.0,
      MATS.metalShell, gx, 3.2, gz);
    level.entries.push(new THREE.Vector3(gx * 0.86, 0, gz * 0.86));
    level.spawnSources.push({ x: gx, z: gz, kind: 'gate' });
    // Far approach: the horde walks in from the wasteland through the gate
    const ox = gt.ax === 'x' ? gx : gx * 1.5;
    const oz = gt.ax === 'x' ? gz * 1.5 : gz;
    level.zombieSpawns.push(new THREE.Vector3(ox, 0, oz));
  }

  // Interior architecture: two inner buildings split the compound into
  // connected yards, so there is never one square to stand in.
  const bMat = MATS.plaster;
  // Building A (west), with a through-corridor
  wall(level, bMat, -8, -6, 12, 0.5, 3.2);
  wall(level, bMat, -8, 0.5, 12, 0.5, 3.2);
  wall(level, bMat, -14, -2.75, 0.5, 7, 3.2);
  wall(level, bMat, -2, -5, 0.5, 3, 3.2);      // leaves a doorway gap
  wall(level, bMat, -2, 0, 0.5, 1.4, 3.2);
  // Building B (east)
  wall(level, bMat, 8, 7, 0.5, 10, 3.2);
  wall(level, bMat, 13, 12.2, 10.5, 0.5, 3.2);
  wall(level, bMat, 13, 2.2, 10.5, 0.5, 3.2);

  // Watchtower: verticality with a real firing position over the walls.
  const towerX = 6, towerZ = -9;
  platform(level, MATS.planksOld, towerX, towerZ, 4.4, 4.4, 2.4, 'south');
  railing(level, MATS.metalDoor, towerX, towerZ - 2.2, 4.4, 0.12);
  railing(level, MATS.metalDoor, towerX - 2.2, towerZ, 0.12, 4.4);

  // Cover scattered along the fighting lanes
  const coverSpots = [
    [-4, 6, 2.4, 0.8], [1, 8, 0.8, 2.6], [4, 3, 2.2, 0.8],
    [-10, 6, 0.8, 2.4], [10, -4, 2.6, 0.8], [-6, -10, 2.2, 0.9],
    [2, -3, 0.9, 2.2], [-12, 10, 2.0, 0.9], [12, 8, 0.9, 2.4],
  ];
  for (const [cx, cz, cw, cd] of coverSpots) cover(level, MATS.sandbag, cx, cz, cw, cd);
  for (let i = 0; i < 8; i++) {
    const s = rng.range(0.7, 1.2);
    const cx = rng.range(-half + 3, half - 3), cz = rng.range(-half + 3, half - 3);
    if (Math.hypot(cx, cz) < 4) continue;
    cover(level, MATS.crate, cx, cz, s, s, s);
  }

  // Explosive barrels near the gates (where the horde funnels)
  for (const gt of gates) {
    if (!rng.chance(0.8)) continue;
    level.barrels.push({ x: gt.x * 0.7 + rng.range(-1.5, 1.5), z: gt.z * 0.7 + rng.range(-1.5, 1.5) });
  }

  buildWasteland(g, rng, {});
  buildHighRise(g, 0, -half - 16);

  // Elevator inside the compound, reachable from every yard.
  level.elevator = makeElevator();
  level.elevator.group.position.set(-half + 2.2, 0, half - 3.0);
  level.elevator.group.rotation.y = -Math.PI / 4;
  g.add(level.elevator.group);
  addElevatorColliders(level, -half + 2.2, half - 3.0);
  level.elevatorZone = { x: -half + 4.0, z: half - 4.6, hx: 1.9, hz: 1.9 };

  level.heightAt = makeHeightAt(level, 0);
  roomscaleZone(level, 0, 4);
  level.playerSpawns = [
    new THREE.Vector3(0, 0, 4), new THREE.Vector3(1.6, 0, 5.4),
    new THREE.Vector3(-1.6, 0, 5.4), new THREE.Vector3(1.6, 0, 2.6),
    new THREE.Vector3(-1.6, 0, 2.6),
  ];
}

// ---- Basement: a boiler-room maze of rooms and corridors ---------------
function buildBasement(level, rng) {
  const g = level.group;
  const S = LEVEL_SIZE;
  const half = S / 2;
  level.floorY = 0;
  level.baseY = 0;
  level.lighting = {
    daySky: 0x0a1018, dayHaze: 0x101828,
    fogNear: 7, fogFar: 44, sunDay: 0.0, hemiDay: 0.8, dark: true,
  };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), MATS.basementFloor);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(S, S), mat(0x3a3831, 1.0));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.0;
  ceil.userData.dynamic = true;   // never merged, so the map can hide it
  ceil.userData.ceiling = true;
  g.add(ceil);

  const wMat = MATS.basementWall;
  // Outer shell (solid; the ways in are the stairwell and the breaches)
  wall(level, wMat, 0, -half, S, 0.6, 3.0);
  wall(level, wMat, 0, half, S, 0.6, 3.0);
  wall(level, wMat, -half, 0, 0.6, S, 3.0);
  wall(level, wMat, half, 0, 0.6, S, 3.0);

  // Interior partitions forming rooms + corridors. Gaps are doorways.
  // Long spine corridor down the middle, rooms hanging off both sides.
  wall(level, wMat, -6, -3, 16, 0.5, 3.0);
  wall(level, wMat, 9, -3, 12, 0.5, 3.0);
  wall(level, wMat, -6, 3.5, 16, 0.5, 3.0);
  wall(level, wMat, 9, 3.5, 12, 0.5, 3.0);
  // Cross walls with doorway gaps
  wall(level, wMat, -12, -9, 0.5, 11, 3.0);
  wall(level, wMat, -2, -10.5, 0.5, 8, 3.0);
  wall(level, wMat, 6, -9, 0.5, 11, 3.0);
  wall(level, wMat, -12, 9.5, 0.5, 11, 3.0);
  wall(level, wMat, -2, 10.5, 0.5, 8, 3.0);
  wall(level, wMat, 8, 9.5, 0.5, 11, 3.0);
  wall(level, wMat, 13, 8, 8, 0.5, 3.0);
  wall(level, wMat, -13, -14, 8, 0.5, 3.0);

  // Pillars along the spine
  for (let px = -14; px <= 14; px += 7) {
    box(g, 0.7, 3.0, 0.7, wMat, px, 1.5, 0.25);
    level.colliders.push({ x: px, z: 0.25, hx: 0.35, hz: 0.35, tall: true });
  }

  // A raised maintenance deck: verticality in a basement
  platform(level, MATS.planksOld, 12, -11, 6, 5, 1.5, 'south');
  railing(level, MATS.metalDoor, 12, -13.4, 6, 0.12);

  // Cover: shelving, crates, pipe banks
  for (let i = 0; i < 14; i++) {
    const cx = rng.range(-half + 2.5, half - 2.5);
    const cz = rng.range(-half + 2.5, half - 2.5);
    if (Math.abs(cz) < 1.6) continue;           // keep the spine walkable
    const w = rng.chance(0.5) ? 1.8 : 0.7;
    cover(level, rng.chance(0.5) ? MATS.crate : MATS.planksOld, cx, cz, w, w === 1.8 ? 0.7 : 1.8);
  }
  // Pipes overhead so the ceiling reads as a boiler room
  for (let i = 0; i < 8; i++) {
    const pz = rng.range(-half + 2, half - 2);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, S - 2, 6), MATS.metalShell);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 2.6 + rng.range(-0.2, 0.2), pz);
    g.add(pipe);
  }

  // VISIBLE sources: a stairwell you can see people climbing out of, plus
  // two breached walls. Nothing appears from thin air.
  stairwell(level, wMat, MATS.metalDoor, -half + 4, half - 4, 0);
  breach(level, wMat, mat(0x4a463f, 1.0), 5, -half + 0.4, 3.4, 'x');
  breach(level, wMat, mat(0x4a463f, 1.0), half - 0.4, 6, 3.0, 'z');
  for (const e of level.entries) level.zombieSpawns.push(e.clone());

  // Work lamps: pools of warm light, never pure black
  for (const [lx, lz] of [[-10, 0], [-2, 0], [6, 0], [14, 2], [-14, 10], [2, 10], [12, 10], [-8, -10], [6, -12], [-14, -6]]) {
    const lamp = new THREE.PointLight(0xffd9a0, 1.9, 16);
    lamp.position.set(lx, 2.7, lz);
    g.add(lamp);
    box(g, 0.26, 0.1, 0.26, mat(0x2a2a2a), lx, 2.86, lz);
  }

  level.barrels.push({ x: 4, z: -6 }, { x: -8, z: 7 });

  level.elevator = makeElevator();
  level.elevator.group.position.set(-half + 2.4, 0, -half + 3.0);
  level.elevator.group.rotation.y = Math.PI / 2;
  g.add(level.elevator.group);
  addElevatorColliders(level, -half + 2.4, -half + 3.0);
  level.elevatorZone = { x: -half + 4.6, z: -half + 3.0, hx: 1.8, hz: 1.8 };

  level.heightAt = makeHeightAt(level, 0);
  roomscaleZone(level, -6, 0);
  level.playerSpawns = [
    new THREE.Vector3(-6, 0, 0), new THREE.Vector3(-4.4, 0, 1.2),
    new THREE.Vector3(-7.6, 0, 1.2), new THREE.Vector3(-4.4, 0, -1.2),
    new THREE.Vector3(-7.6, 0, -1.2),
  ];
}

// ---- Upper floor: offices, a corridor ring and a balcony ---------------
// The playtest question was "where do the zombies even come from up here?"
// Answer, visibly: the stairwell, the open elevator shaft, and the facade.
function buildUpper(level, rng, quality) {
  const g = level.group;
  const S = LEVEL_SIZE;
  const half = S / 2;
  const STOREY = 24;
  level.floorY = 0;
  level.baseY = 0;
  level.lighting = {
    daySky: PALETTE.daySky, dayHaze: PALETTE.dayHaze,
    fogNear: 60, fogFar: 280, sunDay: 2.0, hemiDay: 0.85, dark: false,
  };

  const floor = box(g, S, 0.3, S, MATS.parquet, 0, -0.15, 0);
  floor.receiveShadow = quality === 'DESKTOP';
  const upCeil = box(g, S, 0.2, S, mat(0x6d6355, 1.0), 0, 3.1, 0);
  upCeil.userData.dynamic = true;
  upCeil.userData.ceiling = true;

  const wMat = MATS.plaster;
  // North / east / west shell walls (south is the window wall + balcony)
  wall(level, wMat, 0, -half, S, 0.5, 3.0);
  wall(level, wMat, -half, -4, 0.5, S - 8, 3.0);
  wall(level, wMat, half, -4, 0.5, S - 8, 3.0);

  // South window wall: piers with wide openings, chest-high sills.
  const winW = 4.0, pierW = 2.2;
  let cx = -half + pierW / 2;
  while (cx < half) {
    wall(level, wMat, cx, half, pierW, 0.4, 3.0);
    cx += pierW + winW;
  }
  // Continuous sill: blocks walking out, not shooting out.
  cover(level, wMat, 0, half, S, 0.4, 1.0);
  box(g, S, 0.5, 0.4, wMat, 0, 2.75, half);

  // Balcony strip beyond the windows, with a railing and ONE breached
  // section where the climbers come over.
  const balc = box(g, S * 0.8, 0.2, 3.0, MATS.concrete, 0, -0.1, half + 1.7);
  balc.receiveShadow = quality === 'DESKTOP';
  const railMat = MATS.metalDoor;
  const climbX = rng.range(-6, 6);
  for (let bx = -S * 0.4 + 1; bx < S * 0.4; bx += 2) {
    if (Math.abs(bx - climbX) < 1.6) continue;      // the breached span
    box(g, 1.9, 0.9, 0.1, railMat, bx, 0.45, half + 3.15);
  }
  facadeClimb(level, railMat, MATS.metalShell, climbX, half + 3.15);

  // Interior offices: rooms off a corridor ring, multiple routes.
  wall(level, wMat, -9, -8, 14, 0.5, 3.0);
  wall(level, wMat, 10, -8, 12, 0.5, 3.0);
  wall(level, wMat, -16, -3, 0.5, 10, 3.0);
  wall(level, wMat, -2, -12, 0.5, 8, 3.0);
  wall(level, wMat, 4, -3, 0.5, 10, 3.0);
  wall(level, wMat, 12, -13, 0.5, 8, 3.0);
  wall(level, wMat, -8, 3, 10, 0.5, 3.0);
  wall(level, wMat, 9, 3, 10, 0.5, 3.0);
  wall(level, wMat, -13, 7, 0.5, 8, 3.0);
  wall(level, wMat, 13, 7, 0.5, 8, 3.0);

  // A mezzanine over the west offices: verticality + a sniping perch.
  platform(level, MATS.planksOld, -12, 10, 7, 6, 1.6, 'east');
  railing(level, railMat, -12, 13, 7, 0.12);

  // Office furniture as cover
  for (let i = 0; i < 16; i++) {
    const dx = rng.range(-half + 2, half - 2), dz = rng.range(-half + 2, half - 3);
    if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
    const long = rng.chance(0.5);
    cover(level, MATS.crate, dx, dz, long ? 1.8 : 0.8, long ? 0.8 : 1.8, 0.78);
  }

  // VISIBLE sources on a high floor
  stairwell(level, wMat, MATS.metalDoor, -half + 4.5, -half + 4.5, 0);
  openShaft(level, wMat, MATS.metalShell, half - 5, -half + 3);
  for (const e of level.entries) level.zombieSpawns.push(e.clone());

  // The city below and around, seen through the windows
  const streetY = -STOREY;
  const street = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(PALETTE.road, 1.0));
  street.rotation.x = -Math.PI / 2;
  street.position.y = streetY;
  g.add(street);
  for (const [tx, tz, tw, th, td] of [
    [-14, half + 40, 14, 30, 12], [12, half + 52, 16, 40, 14],
    [30, half + 30, 12, 24, 12], [-34, half + 34, 12, 26, 12]]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), MATS.facade);
    scaleBoxUVs(t.geometry, tw / 5, th / 5, td / 5);
    t.position.set(tx, streetY + th / 2, tz);
    g.add(t);
  }
  // Interior fill light so the room reads without shadow maps
  for (const lx of [-8, 8]) {
    const fill = new THREE.PointLight(0xffeecd, 1.3, 22);
    fill.position.set(lx, 2.5, 6);
    g.add(fill);
  }

  // Outside the walls it is a long way down.
  const inHalf = half + 0.4;
  level.heightAt = (x, z) => {
    if (Math.abs(x) <= inHalf && z <= inHalf && z >= -inHalf) return makeHeightAt(level, 0)(x, z);
    if (Math.abs(x) <= S * 0.4 && z > half && z < half + 3.3) return 0;   // balcony
    return -STOREY;
  };

  level.barrels.push({ x: half - 6, z: -half + 6 }, { x: -6, z: -6 });

  level.elevator = makeElevator();
  level.elevator.group.position.set(half - 3.0, 0, half - 6);
  level.elevator.group.rotation.y = -Math.PI / 2;
  g.add(level.elevator.group);
  addElevatorColliders(level, half - 3.0, half - 6);
  level.elevatorZone = { x: half - 5.2, z: half - 6, hx: 1.8, hz: 1.9 };

  roomscaleZone(level, 0, 8);
  level.playerSpawns = [
    new THREE.Vector3(0, 0, 8), new THREE.Vector3(1.8, 0, 9.2),
    new THREE.Vector3(-1.8, 0, 9.2), new THREE.Vector3(1.8, 0, 6.8),
    new THREE.Vector3(-1.8, 0, 6.8),
  ];
}

// ---- Trench: a long serpentine network with dugouts and firing steps ---
function buildTrench(level, rng) {
  const g = level.group;
  const S = LEVEL_SIZE;
  const half = S / 2;
  level.floorY = 0;
  level.baseY = 0;
  level.lighting = {
    daySky: 0x16203a, dayHaze: 0x1b2742,
    fogNear: 9, fogFar: 80, sunDay: 0.45, hemiDay: 0.78, dark: true,
  };

  const floorMat = MATS.basementFloor;
  const dirtMat = MATS.dirt;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S + 4, S + 4), floorMat);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  // The raised field above the trench line
  const field = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x2c3226, 1.0));
  field.rotation.x = -Math.PI / 2;
  field.position.y = 2.6;
  g.add(field);

  // Serpentine: four lanes joined by alternating connectors, plus two
  // dugout side rooms. Every lane is 2.6 m wide.
  const laneZ = [-11, -3.6, 3.6, 11];
  const LANE_HW = 1.3;
  const conn = [1, -1, 1];
  const connX = [];
  for (let i = 0; i < 3; i++) {
    const zMid = (laneZ[i] + laneZ[i + 1]) / 2;
    const gapX = conn[i] * (half - 4);
    connX.push({ x: gapX, z: zMid });
    const blockD = (laneZ[i + 1] - laneZ[i]) - LANE_HW * 2;
    const leftW = (gapX - 1.5) - (-half);
    if (leftW > 0.5) wall(level, dirtMat, -half + leftW / 2, zMid, leftW, blockD, 2.6);
    const rightW = half - (gapX + 1.5);
    if (rightW > 0.5) wall(level, dirtMat, gapX + 1.5 + rightW / 2, zMid, rightW, blockD, 2.6);
  }
  // Rim walls
  wall(level, dirtMat, 0, -half - 1, S + 4, 2, 2.6);
  wall(level, dirtMat, 0, half + 1, S + 4, 2, 2.6);
  wall(level, dirtMat, -half - 1, 0, 2, S + 4, 2.6);
  wall(level, dirtMat, half + 1, 0, 2, S + 4, 2.6);

  // Firing steps: raised ledges you climb to shoot over the parapet.
  for (const [fx, fz] of [[-half + 5, laneZ[0]], [half - 5, laneZ[3]], [0, laneZ[1]]]) {
    platform(level, MATS.planksOld, fx, fz - 0.9, 3.4, 0.9, 0.9, 'south');
  }
  // Duckboards along every lane
  for (const lz of laneZ) box(g, S - 3, 0.06, 1.7, MATS.planksOld, 0, 0.04, lz);
  // Overhead beams + sandbags on the rim
  for (const lz of laneZ) {
    for (const bx of [-half / 2, half / 2]) {
      box(g, 0.18, 0.18, 2.8, mat(0x3c332a, 1.0), bx, 2.5, lz);
      box(g, 0.15, 2.5, 0.15, mat(0x3c332a, 1.0), bx - 1.1, 1.25, lz + 1.15);
    }
  }
  for (let i = 0; i < 14; i++) {
    box(g, rng.range(0.7, 1.1), 0.45, 0.5, MATS.sandbag,
      rng.range(-half, half), 2.85, rng.pick([-1, 1]) * (half + 1), rng.range(-0.2, 0.2));
  }
  // Cover inside the lanes
  for (let i = 0; i < 10; i++) {
    const lz = laneZ[rng.int(0, 3)];
    cover(level, MATS.crate, rng.range(-half + 3, half - 3), lz + rng.range(-0.5, 0.5), 0.8, 0.8, 0.8);
  }
  // Flares
  for (let i = 0; i < 3; i++) {
    const fx = rng.range(-half + 3, half - 3), fz = laneZ[rng.int(0, 3)];
    const flare = new THREE.PointLight(0xff7030, 2.8, 12, 1.6);
    flare.position.set(fx, 0.35, fz);
    g.add(flare);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 5),
      new THREE.MeshStandardMaterial({ color: 0xff5020, emissive: 0xff4010, emissiveIntensity: 1.6 }));
    stick.position.set(fx, 0.14, fz);
    stick.rotation.z = 0.4;
    g.add(stick);
  }

  // VISIBLE sources: open trench mouths at three lane ends, framed by
  // timber so they read as tunnels rather than gaps.
  for (const [ex, ez] of [[half - 0.5, laneZ[0]], [-half + 0.5, laneZ[3]], [half - 0.5, laneZ[2]]]) {
    box(g, 0.3, 2.6, 0.25, mat(0x3c332a, 1.0), ex, 1.3, ez - 1.5);
    box(g, 0.3, 2.6, 0.25, mat(0x3c332a, 1.0), ex, 1.3, ez + 1.5);
    box(g, 0.35, 0.3, 3.2, mat(0x3c332a, 1.0), ex, 2.6, ez);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x04060a }));
    dark.position.set(ex + Math.sign(ex) * 0.16, 1.2, ez);
    dark.rotation.y = Math.PI / 2;
    g.add(dark);
    const entry = new THREE.Vector3(ex * 0.94, 0, ez);
    level.entries.push(entry);
    level.zombieSpawns.push(entry.clone());
    level.spawnSources.push({ x: ex, z: ez, kind: 'tunnel' });
  }
  // Connector openings are routing waypoints, not spawns.
  for (const c of connX) level.entries.push(new THREE.Vector3(c.x, 0, c.z));

  level.barrels.push({ x: -half + 6, z: laneZ[1] }, { x: half - 6, z: laneZ[2] });

  level.elevator = makeElevator();
  level.elevator.group.position.set(-half + 1.6, 0, laneZ[0]);
  level.elevator.group.rotation.y = Math.PI / 2;
  g.add(level.elevator.group);
  addElevatorColliders(level, -half + 1.6, laneZ[0]);
  level.elevatorZone = { x: -half + 4.0, z: laneZ[0], hx: 1.8, hz: 1.3 };

  level.heightAt = makeHeightAt(level, 0);
  roomscaleZone(level, 0, laneZ[1]);
  level.playerSpawns = [
    new THREE.Vector3(0, 0, laneZ[1]), new THREE.Vector3(1.5, 0, laneZ[1]),
    new THREE.Vector3(-1.5, 0, laneZ[1]), new THREE.Vector3(3, 0, laneZ[1]),
    new THREE.Vector3(-3, 0, laneZ[1]),
  ];
}

// ---- Wagon: a rolling train of connected cars --------------------------
function buildWagon(level, rng) {
  const g = level.group;
  const W = 5.4;                     // car width
  const CAR_L = 11;                  // car length
  const CARS = 3;
  const TOTAL = CAR_L * CARS + 2 * (CARS - 1);
  level.floorY = 0.5;
  level.baseY = 0.5;
  level.lighting = {
    daySky: 0x2c3450, dayHaze: 0x2a3048,
    fogNear: 25, fogFar: 170, sunDay: 0.6, hemiDay: 0.55, dark: false,
  };

  const railMat = mat(PALETTE.metalDark, 0.5, 0.6);
  // Cars laid along Z, joined by gangways: corridors, not one square.
  for (let c = 0; c < CARS; c++) {
    const cz = (c - (CARS - 1) / 2) * (CAR_L + 2);
    box(g, W, 0.24, CAR_L, MATS.planksOld, 0, 0.38, cz);
    level.colliders.push({ x: 0, z: cz, hx: W / 2, hz: CAR_L / 2, tall: false, top: 0.5 });
    level.ramps.push({ x: 0, z: cz, hx: W / 2, hz: CAR_L / 2, top: 0.5 });
    // Side railings (walk-blocking, not shot-blocking)
    for (const dx of [-W / 2, W / 2]) {
      box(g, 0.1, 0.95, CAR_L, mat(PALETTE.rust, 0.8), dx, 1.0, cz);
      level.colliders.push({ x: dx, z: cz, hx: 0.07, hz: CAR_L / 2, tall: false });
    }
    // Wheels + a lantern per car
    for (const dz of [-CAR_L / 3, CAR_L / 3]) {
      for (const dx of [-0.9, 0.9]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10), railMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(dx, 0.3, cz + dz);
        g.add(wheel);
      }
    }
    const lamp = new THREE.PointLight(0xffd9a0, 1.3, 12);
    lamp.position.set(0, 2.6, cz);
    g.add(lamp);
    box(g, 0.06, 2.1, 0.06, railMat, 0, 1.55, cz);
    // Cargo cover, different per car so they read as different spaces
    if (c === 0) {
      cover(level, MATS.crate, -1.4, cz + 2, 1.4, 1.4, 1.0);
      cover(level, MATS.crate, 1.5, cz - 2.5, 1.2, 1.8, 1.0);
    } else if (c === 1) {
      cover(level, MATS.crate, 0, cz, 2.2, 1.2, 1.0);
      level.barrels.push({ x: -1.6, z: cz + 3.5 });
    } else {
      cover(level, MATS.crate, -1.5, cz - 1, 1.2, 2.0, 1.0);
      cover(level, MATS.crate, 1.6, cz + 2.5, 1.2, 1.2, 1.0);
    }
    // Gangway to the next car
    if (c < CARS - 1) {
      const gz = cz + CAR_L / 2 + 1;
      box(g, 2.2, 0.2, 2.2, railMat, 0, 0.4, gz);
      level.colliders.push({ x: 0, z: gz, hx: 1.1, hz: 1.1, tall: false, top: 0.5 });
      level.ramps.push({ x: 0, z: gz, hx: 1.1, hz: 1.1, top: 0.5 });
      for (const dx of [-1.25, 1.25]) {
        box(g, 0.08, 0.9, 2.2, railMat, dx, 0.95, gz);
        level.colliders.push({ x: dx, z: gz, hx: 0.06, hz: 1.1, tall: false });
      }
    }
  }
  // Long rails under everything
  for (const dx of [-0.9, 0.9]) box(g, 0.14, 0.1, 500, railMat, dx, 0.05, 0);

  // Scrolling scenery (two leapfrogging segments)
  const SEG = 240;
  const segs = [];
  for (let i = 0; i < 2; i++) {
    const seg = new THREE.Group();
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(400, SEG), MATS.sandGround);
    gp.rotation.x = -Math.PI / 2;
    gp.position.y = -0.02;
    seg.add(gp);
    const sr = makeRng(1000 + i);
    for (let h = 0; h < 6; h++) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(sr.range(30, 70), sr.range(10, 26), 7), mat(PALETTE.hills));
      hill.position.set(sr.pick([-1, 1]) * sr.range(40, 130), 0, sr.range(-SEG / 2, SEG / 2));
      seg.add(hill);
    }
    for (let r = 0; r < 4; r++) {
      const hh = sr.range(6, 18);
      const ruin = new THREE.Mesh(new THREE.BoxGeometry(sr.range(6, 12), hh, sr.range(6, 12)), mat(0x6f675c));
      ruin.position.set(sr.pick([-1, 1]) * sr.range(12, 60), hh / 2, sr.range(-SEG / 2, SEG / 2));
      seg.add(ruin);
    }
    for (let t = 0; t < 6; t++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 5), mat(0x4a4038));
      pole.position.set(sr.pick([-1, 1]) * 3.4, 2.5, sr.range(-SEG / 2, SEG / 2));
      seg.add(pole);
    }
    seg.position.z = -i * SEG;
    seg.traverse((o) => { o.userData.dynamic = true; });
    g.add(seg);
    segs.push(seg);
  }
  const SPEED = 11;
  level.tick = (dt) => {
    for (const seg of segs) {
      seg.position.z += SPEED * dt;
      if (seg.position.z > SEG) seg.position.z -= SEG * 2;
    }
  };

  // VISIBLE sources: they clamber over the couplings at both ends and
  // haul themselves over the side rails at marked bent sections.
  for (const ez of [-TOTAL / 2 - 1.2, TOTAL / 2 + 1.2]) {
    box(g, 1.4, 0.5, 0.5, railMat, 0, 0.45, ez);
    const entry = new THREE.Vector3(0, 0.5, ez * 0.94);
    level.entries.push(entry);
    level.zombieSpawns.push(entry.clone());
    level.spawnSources.push({ x: 0, z: ez, kind: 'coupling' });
  }
  for (const [cx, cz] of [[-W / 2, -4], [W / 2, 5]]) {
    facadeClimb(level, mat(PALETTE.rust, 0.8), railMat, cx, cz);
    level.zombieSpawns.push(new THREE.Vector3(cx * 1.1, 0.5, cz));
  }

  level.elevator = null;
  level.elevatorZone = null;
  level.heightAt = (x, z) => {
    const onCar = Math.abs(x) < W / 2 && Math.abs(z) < TOTAL / 2 + 0.6;
    return onCar ? 0.5 : 0;
  };
  roomscaleZone(level, 0, 0);
  level.playerSpawns = [
    new THREE.Vector3(0, 0.5, 1.5), new THREE.Vector3(1.2, 0.5, -1.5),
    new THREE.Vector3(-1.2, 0.5, -1.5), new THREE.Vector3(1.2, 0.5, 1.5),
    new THREE.Vector3(-1.2, 0.5, 3),
  ];
}

// ---- Boss arena: the Butcher's roof slaughteryard -----------------------
function buildBossArena(level, rng) {
  const g = level.group;
  const S = LEVEL_SIZE;
  const half = S / 2;
  level.floorY = 0;
  level.baseY = 0;
  level.lighting = {
    daySky: 0x6a5a72, dayHaze: 0x8a6a5c,
    fogNear: 20, fogFar: 140, sunDay: 1.5, hemiDay: 0.9, dark: false,
  };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S + 2, S + 2), MATS.concrete);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const wMat = MATS.basementWall;
  // Parapet walls with two big gates
  wall(level, wMat, 0, -half, S, 0.5, 3.4);
  wall(level, wMat, -half, 0, 0.5, S, 3.4);
  wall(level, wMat, half, 0, 0.5, S, 3.4);
  for (const s of [-1, 1]) {
    wall(level, wMat, s * (half / 2 + 2.5), half, half - 5, 0.5, 3.4);
  }

  // A raised gantry ring: dodge the charge by going up.
  platform(level, MATS.planksOld, -half + 5, -half + 7, 7, 8, 1.8, 'east');
  railing(level, MATS.metalDoor, -half + 5, -half + 3, 7, 0.12);
  platform(level, MATS.planksOld, half - 5, half - 7, 7, 8, 1.8, 'west');
  railing(level, MATS.metalDoor, half - 5, half - 3, 7, 0.12);

  // Cover pillars: the charge has to be dodged around something.
  for (const [px, pz] of [[-7, -5], [7, -5], [-7, 6], [7, 6], [0, 0]]) {
    wall(level, wMat, px, pz, 1.2, 1.2, 3.4);
  }
  // Meat hooks and chains: it is a slaughteryard
  for (let i = 0; i < 8; i++) {
    const hx = rng.range(-half + 3, half - 3), hz = rng.range(-half + 3, half - 3);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 4), MATS.metalShell);
    chain.position.set(hx, 2.6, hz);
    g.add(chain);
  }
  // Braziers
  for (const [tx, tz] of [[-half + 2, -half + 2], [half - 2, -half + 2], [-half + 2, half - 2], [half - 2, half - 2]]) {
    const torch = new THREE.PointLight(0xff9040, 2.2, 16);
    torch.position.set(tx, 2.6, tz);
    g.add(torch);
    box(g, 0.5, 0.5, 0.5, mat(0x3a2c20), tx, 0.25, tz);
  }

  // VISIBLE sources: two gates plus a shaft the escort climbs out of.
  for (const s of [-1, 1]) {
    const gx = s * (half / 2 - 2.0);
    box(g, 0.5, 3.6, 0.5, MATS.metalShell, gx - 1.7, 1.8, half);
    box(g, 0.5, 3.6, 0.5, MATS.metalShell, gx + 1.7, 1.8, half);
    const entry = new THREE.Vector3(gx, 0, half - 1.2);
    level.entries.push(entry);
    level.zombieSpawns.push(entry.clone());
    level.spawnSources.push({ x: gx, z: half, kind: 'gate' });
  }
  openShaft(level, wMat, MATS.metalShell, 0, -half + 4);
  level.zombieSpawns.push(new THREE.Vector3(0, 0, -half + 5.5));

  for (const [bx, bz] of [[-5, 0], [5, 0], [0, 8]]) level.barrels.push({ x: bx, z: bz });

  level.elevator = makeElevator();
  level.elevator.group.position.set(-half + 2.6, 0, -half + 3.0);
  level.elevator.group.rotation.y = Math.PI / 2;
  g.add(level.elevator.group);
  addElevatorColliders(level, -half + 2.6, -half + 3.0);
  level.elevatorZone = { x: -half + 5.0, z: -half + 3.0, hx: 1.9, hz: 1.9 };

  level.heightAt = makeHeightAt(level, 0);
  roomscaleZone(level, 0, 4);
  level.playerSpawns = [
    new THREE.Vector3(0, 0, 4), new THREE.Vector3(2, 0, 5.5),
    new THREE.Vector3(-2, 0, 5.5), new THREE.Vector3(2, 0, 2.5),
    new THREE.Vector3(-2, 0, 2.5),
  ];
}

// ---- The extraction helicopter (roof finale) ----------------------------
// Flies in from the horizon, hovers over the arena, and lifts away. Built
// once per finale and animated by main.js via api.update(t).
export function makeHelicopter() {
  const g = new THREE.Group();
  const bodyMat = mat(0x39433a, 0.7, 0.3);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x203038, roughness: 0.2, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.2, 4, 8), bodyMat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), glassMat);
  nose.position.x = 1.7;
  nose.scale.set(1.1, 0.85, 0.9);
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 3.2, 6), bodyMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -2.4;
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.5), bodyMat);
  fin.position.set(-3.7, 0.5, 0);
  g.add(fin);
  // Skids
  for (const dz of [-0.7, 0.7]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 5), bodyMat);
    skid.rotation.z = Math.PI / 2;
    skid.position.set(0, -1.0, dz);
    g.add(skid);
  }
  // Rotors (spun by update)
  const mainRotor = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.05, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x2a2f2b, transparent: true, opacity: 0.55 }));
    blade.rotation.y = (i / 4) * Math.PI * 2;
    mainRotor.add(blade);
  }
  mainRotor.position.y = 1.15;
  g.add(mainRotor);
  const tailRotor = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x2a2f2b, transparent: true, opacity: 0.55 }));
    blade.rotation.x = (i / 3) * Math.PI * 2;
    tailRotor.add(blade);
  }
  tailRotor.position.set(-3.7, 0.5, 0.3);
  g.add(tailRotor);
  // Searchlight pointing down at the roof
  const spot = new THREE.SpotLight(0xfff0d0, 6, 40, 0.5, 0.6, 1.0);
  spot.position.set(1.2, -0.7, 0);
  const target = new THREE.Object3D();
  target.position.set(1.2, -20, 0);
  g.add(spot, target);
  spot.target = target;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 2 }));
  beacon.position.set(-1.0, -1.05, 0);
  g.add(beacon);

  return {
    group: g,
    // t: 0..1 across the finale. Approach, hover, lift away.
    update(t, dt) {
      mainRotor.rotation.y += dt * 26;
      tailRotor.rotation.x += dt * 34;
      beacon.material.emissiveIntensity = 1.2 + Math.sin(performance.now() / 120) * 1.2;
      const approach = Math.min(1, t / 0.35);
      const leave = Math.max(0, (t - 0.75) / 0.25);
      const x = -70 + 70 * approach * approach + leave * 40;
      const y = 22 - 8 * approach + leave * 30;
      g.position.set(x, y, -6 + leave * -20);
      g.rotation.z = -0.12 * (1 - approach) - 0.18 * leave;
      g.rotation.y = 0.15 * leave;
      spot.intensity = 6 * approach * (1 - leave);
    },
  };
}

// ---- Entry point --------------------------------------------------------
export function buildLevel(scene, quality, runSeed, levelIndex) {
  const type = levelTypeFor(levelIndex);
  const rng = makeRng((runSeed * 7919 + levelIndex * 104729) >>> 0);
  const level = {
    type, index: levelIndex,
    group: new THREE.Group(),
    colliders: [], ramps: [], entries: [], zombieSpawns: [], playerSpawns: [],
    spawnSources: [],   // VISIBLE fiction for each entry (never thin air)
    barrels: [],        // explosive barrels: {x, z} seeded by the generator
    elevator: null, elevatorZone: null, roomZone: null,
    floorY: 0, baseY: 0, heightAt: () => 0, lighting: null,
  };
  if (type === 'ground') buildGround(level, rng, quality);
  else if (type === 'basement') buildBasement(level, rng);
  else if (type === 'upper') buildUpper(level, rng, quality);
  else if (type === 'trench') buildTrench(level, rng);
  else if (type === 'boss') buildBossArena(level, rng);
  else buildWagon(level, rng);
  // Bake all static geometry into one mesh per material (draw-call diet;
  // Quest 2 budget). Doors and scrolling scenery are marked dynamic.
  mergeStaticMeshes(level.group);
  if (quality === 'DESKTOP') {
    level.group.traverse((o) => {
      if (o.isMesh && o.userData.merged) { o.castShadow = true; o.receiveShadow = true; }
    });
  }
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
