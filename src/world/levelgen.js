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
import { noiseTexture, plankTexture, metalTexture, sandbagTexture, facadeTexture } from './textures.js';
import { mergeStaticMeshes } from './merge.js';

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

// Boxes scale their UVs by physical size so a tiling texture has ONE
// world-space scale everywhere (mismatched tiling across differently
// sized walls was the most-flagged texture flaw in the critic pass).
// BoxGeometry vertex order: +x,-x (d*h faces), +y,-y (w*d), +z,-z (w*h).
function scaleBoxUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    // Clamp thin faces: a 0.08 m edge would sample a 1-pixel smear.
    const uw = Math.max(faceDims[f][0], 0.5), vh = Math.max(faceDims[f][1], 0.5);
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * uw * 0.5, uv.getY(i) * vh * 0.5);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function box(group, w, h, d, material, x, y, z, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (material.map) scaleBoxUVs(geo, w, h, d);
  const m = new THREE.Mesh(geo, material);
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
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), MATS.sandGround);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
  ground.receiveShadow = quality === 'DESKTOP';
  g.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 600), mat(PALETTE.road, 1.0));
  road.rotation.x = -Math.PI / 2;
  road.position.set(rng.pick([-18, 18]), 0, 0);
  g.add(road);

  // Base floor
  const floor = box(g, A, 0.2, A, MATS.concrete, 0, 0, 0);
  floor.receiveShadow = quality === 'DESKTOP';

  // Sandbag perimeter with a gap per side (entries). Sandbags are LOW:
  // they block walking but not bullets. Everything scales with the chosen
  // play-area footprint (SMALL layouts skip clutter entirely).
  const wallMat = MATS.sandbag;
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
    const crateMat = MATS.crate;
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
    // Explosive barrels: shootable, chain into the horde. Placed near the
    // wall gaps where the zombies funnel in (the whole point of them).
    for (const e of level.entries) {
      if (!rng.chance(0.7)) continue;
      const bx = e.x * 0.72 + rng.range(-0.8, 0.8);
      const bz = e.z * 0.72 + rng.range(-0.8, 0.8);
      level.barrels.push({ x: bx, z: bz });
    }
  }

  // Foreground scatter: debris ring just outside the walls so every shot
  // has a near layer (critic pass: "no foreground layer at all").
  const debrisMat = MATS.planksOld;
  const rockMat = mat(0x9a8d76, 1.0);
  for (let i = 0; i < 10; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = half + rng.range(1.5, 9);
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    if (rng.chance(0.5)) {
      box(g, rng.range(0.6, 1.4), 0.06, rng.range(0.15, 0.3), debrisMat, x, 0.03, z, rng.range(0, Math.PI));
    } else {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rng.range(0.15, 0.45), 0), rockMat);
      rock.position.set(x, 0.12, z);
      rock.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
      g.add(rock);
    }
  }
  // Tire tracks on the road: two long dark strips
  for (const off of [-1.1, 1.1]) {
    const track = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 600),
      new THREE.MeshBasicMaterial({ color: 0x55514a, transparent: true, opacity: 0.5, depthWrite: false }));
    track.rotation.x = -Math.PI / 2;
    track.position.set(road.position.x + off, 0.012, 0);
    g.add(track);
  }

  buildWasteland(g, rng, {});

  // Midground kit (the critic's three-depth-layers demand): a fence line
  // along the road, debris clusters and scrub tufts between the base and
  // the horizon so no sightline crosses empty sand.
  {
    const postMat = mat(0x4f4336, 1.0);
    for (let i = -6; i <= 6; i++) {
      const px = road.position.x + (road.position.x > 0 ? 4 : -4);
      box(g, 0.12, 1.1, 0.12, postMat, px, 0.55, i * 9 + rng.range(-1, 1));
    }
    const scrubMat = mat(0x7a7d4a, 1.0);
    for (let i = 0; i < 26; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(half + 4, half + 30);
      const sx = Math.cos(ang) * dist, sz = Math.sin(ang) * dist;
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(rng.range(0.25, 0.5), rng.range(0.3, 0.6), 5), scrubMat);
      tuft.position.set(sx, 0.15, sz);
      tuft.rotation.y = rng.range(0, 3);
      g.add(tuft);
    }
    for (let i = 0; i < 4; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(half + 6, half + 22);
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      for (let j = 0; j < 3; j++) {
        box(g, rng.range(0.4, 1.2), rng.range(0.2, 0.5), rng.range(0.4, 1.0),
          rng.chance(0.5) ? MATS.crate : mat(0x8a8578),
          cx + rng.range(-1.2, 1.2), 0.2, cz + rng.range(-1.2, 1.2), rng.range(0, 3));
      }
    }
  }

  // THE high-rise looms right behind the elevator: the base is its ground
  // floor, and the tower explains where the elevator goes.
  buildHighRise(g, 0, -half - 10);

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
    daySky: 0x0a1018, dayHaze: 0x101828,
    fogNear: 5, fogFar: 30, sunDay: 0.0, hemiDay: 0.42, dark: true,
  };

  const floorMat = MATS.basementFloor;
  const wallMat = MATS.basementWall;
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
    const shelfMat = MATS.crate;
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
  // Explosive barrels by the doorways (basement chokepoints)
  for (const e of level.entries) {
    if (rng.chance(0.6)) level.barrels.push({ x: e.x * 0.7, z: e.z * 0.7 });
  }

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

  const floorMat = MATS.parquet;
  const wallMat = MATS.plaster;

  // Room floor and ceiling
  const floor = box(g, A, 0.2, A, floorMat, 0, -0.1, 0);
  floor.receiveShadow = quality === 'DESKTOP';
  box(g, A, 0.15, A, mat(0x6d6355, 1.0), 0, 2.8, 0);
  // Interior fill: window bounce light (the sun itself cannot reach in
  // without shadows, so the room needs its own warmth to stay readable).
  for (const lx of [-3, 3]) {
    const fill = new THREE.PointLight(0xffeecd, 1.4, 18);
    fill.position.set(lx, 2.2, 2.0);
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
  // Window frames (dark trim around each opening) + warm light pools on
  // the floor under the windows to sell the light coming in.
  const frameMat = mat(0x4a4038, 0.85);
  let fx = -half + pierW + winW / 2;
  for (let i = 0; i < nWin; i++) {
    box(g, winW + 0.12, 0.08, 0.3, frameMat, fx, sillH + 0.02, half);        // sill trim
    box(g, winW + 0.12, 0.08, 0.3, frameMat, fx, 2.52, half);                // top trim
    box(g, 0.08, 1.6, 0.3, frameMat, fx - winW / 2, sillH + 0.78, half);
    box(g, 0.08, 1.6, 0.3, frameMat, fx + winW / 2, sillH + 0.78, half);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(winW * 1.2, 2.6),
      new THREE.MeshBasicMaterial({ color: 0xffe8b8, transparent: true, opacity: 0.16, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(fx - 1.1, 0.015, half - 1.6);   // skewed with the sun
    g.add(pool);
    fx += winW + pierW;
  }
  // Baseboards where floor meets the walls
  for (const [bx, bz, bw, brot] of [[0, -half + 0.15, A, 0], [-half + 0.15, 0, A, 1], [half - 0.15, 0, A, 1]]) {
    box(g, brot ? 0.06 : bw, 0.14, brot ? bw : 0.06, frameMat, bx, 0.07, bz);
  }

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
    const deskMat = MATS.crate;
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
  // A guaranteed skyline framed by the windows: two facade towers dead
  // ahead plus randomized filler blocks. Lamp posts line the street.
  {
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(10, 22, 9), MATS.facade);
    scaleBoxUVs(t1.geometry, 2, 11, 2);
    t1.position.set(-6, streetY + 11, half + 24);
    g.add(t1);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(12, 30, 10), MATS.facade);
    scaleBoxUVs(t2.geometry, 2.4, 15, 2);
    t2.position.set(9, streetY + 15, half + 34);
    g.add(t2);
    for (const lx of [-8, 0, 8]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 5), mat(0x3a3a3a));
      pole.position.set(lx, streetY + 2.5, half + 8);
      g.add(pole);
    }
  }
  const facadeMat = mat(0x8f8578);
  for (let i = 0; i < 4; i++) {
    const w = rng.range(8, 16), h = rng.range(6, STOREY + 6), d = rng.range(8, 14);
    const x = rng.pick([-1, 1]) * rng.range(20, 60);
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
    daySky: 0x16203a, dayHaze: 0x1b2742,
    fogNear: 8, fogFar: 60, sunDay: 0.35, hemiDay: 0.5, dark: true,
  };
  const dirtMat = MATS.dirt;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 2, half * 2 + 2), MATS.basementFloor);
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
    daySky: 0x16203a, dayHaze: 0x1b2742,
    fogNear: 8, fogFar: 60, sunDay: 0.35, hemiDay: 0.5, dark: true,
  };

  const dirtMat = MATS.dirt;
  const floorMat = MATS.basementFloor;

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

  // Duckboard runs along every lane (intentional foreground layer),
  // overhead support beams, sandbag silhouettes on the trench rim.
  for (const lz of laneZ) {
    box(g, A - 2, 0.06, 1.6, MATS.planksOld, 0, 0.04, lz);
  }
  const beamMat = mat(0x3c332a, 1.0);
  for (const lz of laneZ) {
    for (const bx of [-half / 2, half / 2]) {
      box(g, 0.18, 0.18, 2.6, beamMat, bx, 2.3, lz);
      box(g, 0.15, 2.3, 0.15, beamMat, bx - 1.0, 1.15, lz + 1.05);
      box(g, 0.15, 2.3, 0.15, beamMat, bx + 1.0, 1.15, lz - 1.05);
    }
  }
  for (let i = 0; i < 8; i++) {
    const along = rng.range(-half, half);
    const side = rng.pick([-1, 1]);
    box(g, rng.range(0.7, 1.1), 0.45, 0.5, MATS.sandbag, along, 2.55, side * (half + 0.7), rng.range(-0.2, 0.2));
  }
  // Flares: warm pools of light with visible sticks
  for (const i of [0, 1]) {
    const x = rng.range(-half + 2, half - 2);
    const z = laneZ[rng.int(0, 2)];
    const flare = new THREE.PointLight(0xff7030, 2.6, 10, 1.6);
    flare.position.set(x, 0.3, z);
    g.add(flare);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 5),
      new THREE.MeshStandardMaterial({ color: 0xff5020, emissive: 0xff4010, emissiveIntensity: 1.5 }));
    stick.position.set(x, 0.12, z);
    stick.rotation.z = 0.4;
    g.add(stick);
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
  const bed = box(g, W, 0.24, L, MATS.planksOld, 0, 0.38, 0);
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
  box(g, 1.0, 0.9, 1.0, MATS.crate, 0, 0.95, 0);
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
    const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, SEG), MATS.sandGround);
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
    seg.traverse((o) => { o.userData.dynamic = true; });   // scrolls; never merge
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

// ---- Boss arena (the Butcher's floor) -----------------------------------
// A walled slaughteryard on the roof level: pillars for cover against the
// charge, torch light, the elevator dead ahead. One night, one Butcher.
function buildBossArena(level, rng) {
  const g = level.group;
  const A = Math.max(CONFIG.PLAY_AREA + 4, 12);
  const half = A / 2;
  level.floorY = 0;
  level.heightAt = () => 0;
  level.lighting = {
    daySky: 0x6a5a72, dayHaze: 0x8a6a5c,
    fogNear: 18, fogFar: 120, sunDay: 1.5, hemiDay: 0.85, dark: false,
  };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(A + 2, A + 2), MATS.concrete);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  // High walls, two door gaps (the Butcher's escort trickles in)
  for (const [side, rot] of [[[0, -half], 0], [[0, half], 0], [[-half, 0], 1], [[half, 0], 1]]) {
    const [dx, dz] = side;
    const hasDoor = rot === 1;   // side doors only; north wall hosts the elevator
    const len = A;
    if (!hasDoor) {
      box(g, rot ? 0.4 : len, 3.2, rot ? len : 0.4, MATS.basementWall, dx, 1.6, dz);
      level.colliders.push(rot
        ? { x: dx, z: dz, hx: 0.2, hz: half, tall: true }
        : { x: dx, z: dz, hx: half, hz: 0.2, tall: true });
    } else {
      const segLen = (len - 2.0) / 2;
      for (const sign of [-1, 1]) {
        const off = sign * (1.0 + segLen / 2);
        const x = rot ? dx : dx + off;
        const z = rot ? dz + off : dz;
        box(g, rot ? 0.4 : segLen, 3.2, rot ? segLen : 0.4, MATS.basementWall, x, 1.6, z);
        level.colliders.push(rot
          ? { x, z, hx: 0.2, hz: segLen / 2, tall: true }
          : { x, z, hx: segLen / 2, hz: 0.2, tall: true });
      }
      const entry = new THREE.Vector3(dx, 0, dz);
      level.entries.push(entry);
      level.zombieSpawns.push(entry.clone());
    }
  }
  // Cover pillars: survive the charge by putting stone between you and it
  const pillarSpots = [[-half / 2, -half / 2], [half / 2, -half / 2], [-half / 2, half / 2], [half / 2, half / 2]];
  for (const [px, pz] of pillarSpots) {
    box(g, 0.9, 3.2, 0.9, MATS.basementWall, px, 1.6, pz);
    level.colliders.push({ x: px, z: pz, hx: 0.45, hz: 0.45, tall: true });
  }
  // Torches: violet-dusk arena mood
  // Barrels in the boss arena: the Butcher's charge can detonate them
  for (const [bx, bz] of [[-half / 2 + 1.6, 0], [half / 2 - 1.6, 0], [0, half / 2]]) {
    level.barrels.push({ x: bx, z: bz });
  }
  for (const [tx, tz] of [[-half + 1, -half + 1], [half - 1, -half + 1], [-half + 1, half - 1], [half - 1, half - 1]]) {
    const torch = new THREE.PointLight(0xff9040, 1.6, 10);
    torch.position.set(tx, 2.4, tz);
    g.add(torch);
    box(g, 0.1, 0.8, 0.1, mat(0x3a2c20), tx, 2.0, tz);
  }

  level.elevator = makeElevator();
  level.elevator.group.position.set(0, 0, -half + 1.3);
  g.add(level.elevator.group);
  addElevatorColliders(level, 0, -half + 1.3);
  level.elevatorZone = { x: 0, z: Math.max(-CONFIG.PLAY_AREA / 2 + 0.9, -half + 3.0), hx: 1.3, hz: 0.9 };

  const qb = Math.min(half * 0.3, 2);
  level.playerSpawns = [
    new THREE.Vector3(0, 0, qb + 1), new THREE.Vector3(qb, 0, qb),
    new THREE.Vector3(-qb, 0, qb), new THREE.Vector3(0, 0, qb + 2),
    new THREE.Vector3(qb, 0, qb + 2),
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
    colliders: [], entries: [], zombieSpawns: [], playerSpawns: [],
    barrels: [],   // explosive barrels: {x, z} seeded by the generator
    elevator: null, elevatorZone: null,
    floorY: 0, heightAt: () => 0, lighting: null,
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
