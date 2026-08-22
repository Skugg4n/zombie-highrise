// World builder. Phase 0: one deterministic MEDIUM ground-level layout,
// "zombies in daylight": warm sun, light haze, fortified base with open
// sightlines out across a wasteland. No randomness here yet; the Phase 1
// level generator will replace the fixed layout with seeded generation.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export const PALETTE = {
  sky: 0xa8c8e0,
  haze: 0xd6c9a8,
  sand: 0xc9b088,
  concrete: 0x9a938a,
  sandbag: 0xb0a070,
  wood: 0x8a6f4d,
  hills: 0xb8a583,
  road: 0x6f6a62,
  grass: 0xa3a860,
};

// Walkable height at a world position. Phase 0 terrain: the base floor
// slab is 0.1 m above the surrounding ground plane.
export function terrainHeight(x, z) {
  const half = CONFIG.PLAY_AREA / 2;
  return (Math.abs(x) < half && Math.abs(z) < half) ? 0.1 : 0;
}

export function buildWorld(scene, quality) {
  const world = { meshes: [] };
  const add = (m) => { scene.add(m); world.meshes.push(m); return m; };

  // --- Sky, haze, light -------------------------------------------------
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.haze, 60, 260);

  const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x8a7a5a, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe8c0, 2.2);
  sun.position.set(40, 60, 25);
  scene.add(sun);
  world.sun = sun;

  if (quality === 'DESKTOP') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 30;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 150;
  }

  const mat = (color, rough = 0.9) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0 });

  // --- Ground far plane -------------------------------------------------
  const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1), mat(PALETTE.sand)));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = quality === 'DESKTOP';

  // --- Road running past the base --------------------------------------
  const road = add(new THREE.Mesh(new THREE.PlaneGeometry(7, 600), mat(PALETTE.road, 1.0)));
  road.rotation.x = -Math.PI / 2;
  road.position.set(-18, 0.0, 0);

  // --- Base floor (the physical play area) ------------------------------
  const A = CONFIG.PLAY_AREA;
  const floor = add(new THREE.Mesh(new THREE.BoxGeometry(A, 0.2, A), mat(PALETTE.concrete)));
  floor.position.y = 0.1 - 0.1; // top surface at y = 0.1
  floor.position.y = 0.0;
  floor.receiveShadow = quality === 'DESKTOP';

  // --- Sandbag perimeter with firing gaps -------------------------------
  // Low walls (1.0 m) around the base, gaps on each side to shoot and walk
  // through. Built from merged boxes via instancing-lite: few big boxes.
  const wallMat = mat(PALETTE.sandbag);
  const H = 1.0, T = 0.6;
  const segs = [];
  const half = A / 2;
  // Each side: two wall segments leaving a 3 m gap in the middle.
  const segLen = (A - 3) / 2;
  for (const [dx, dz, rot] of [[0, -half, 0], [0, half, 0], [-half, 0, Math.PI / 2], [half, 0, Math.PI / 2]]) {
    for (const sign of [-1, 1]) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(segLen, H, T), wallMat);
      const off = sign * (1.5 + segLen / 2);
      if (rot === 0) seg.position.set(dx + off, H / 2, dz);
      else seg.position.set(dx, H / 2, dz + off);
      seg.rotation.y = rot;
      seg.castShadow = seg.receiveShadow = quality === 'DESKTOP';
      segs.push(add(seg));
    }
  }

  // --- Crates inside the base ------------------------------------------
  const crateMat = mat(PALETTE.wood);
  const cratePositions = [[-4, 0, -3, 0.9], [-3.2, 0, -3.4, 0.7], [5, 0, 4, 1.1], [4.4, 0.0, 2.9, 0.8], [0.5, 0, 5.5, 0.9]];
  for (const [x, , z, s] of cratePositions) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    c.position.set(x, s / 2, z);
    c.rotation.y = (x * 7 + z * 13) % 1; // deterministic slight rotation
    c.castShadow = c.receiveShadow = quality === 'DESKTOP';
    add(c);
  }

  // --- Distant hills and ruins (background depth layer) -----------------
  const hillMat = mat(PALETTE.hills);
  const hillDefs = [[-120, 200, 60, 22], [80, 230, 90, 30], [200, 80, 70, 18], [-220, -60, 100, 26], [40, -240, 80, 24], [-90, -190, 55, 16]];
  for (const [x, z, r, h] of hillDefs) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), hillMat);
    hill.position.set(x, 0, z);
    add(hill);
  }
  // Ruined building silhouettes (midground layer)
  const ruinMat = mat(0x8f8578);
  const ruinDefs = [[-45, -60, 8, 14, 10], [-60, 30, 10, 20, 8], [55, -45, 9, 9, 9], [70, 55, 7, 16, 7]];
  for (const [x, z, w, h, d] of ruinDefs) {
    const ruin = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ruinMat);
    ruin.position.set(x, h / 2, z);
    add(ruin);
  }

  // --- Dead trees (midground) -------------------------------------------
  const treeMat = mat(0x6b5a44);
  const treeDefs = [[-25, 20], [30, -28], [22, 35], [-35, -22]];
  for (const [x, z] of treeDefs) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 6, 5), treeMat);
    trunk.position.set(x, 3, z);
    trunk.rotation.z = 0.06 * ((x + z) % 3 - 1);
    add(trunk);
  }

  // --- Spawn points -----------------------------------------------------
  world.playerSpawns = [
    new THREE.Vector3(0, 0.1, 2),
    new THREE.Vector3(2, 0.1, -1),
    new THREE.Vector3(-2, 0.1, -1),
    new THREE.Vector3(0, 0.1, -3),
  ];
  world.zombieSpawn = new THREE.Vector3(-30, 0, 20); // walks in from the road
  world.floorY = 0.1;

  return world;
}
