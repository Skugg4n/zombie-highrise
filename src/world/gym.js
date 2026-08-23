// THE PHYSICS GYM. Reach it with ?gym=1.
//
// Every movement hazard the game has, in one room, so that movement can be
// tested in five seconds instead of by playing three levels and hoping.
// Ola walks it himself in VR and flat; `test/gymprobe.mjs` walks it
// headlessly on every change.
//
// This is the movement regression suite, permanently. When a movement bug
// is found anywhere, the fix is not complete until the gym has a station
// that reproduces it.
//
// STATIONS, west to east:
//   1  RAMPS at 15, 30 and 50 degrees. The first two are walkable, the
//      third is a wall. All three must be solid FROM THE SIDE, which is
//      the bug that started this: entering a ramp from its high flank used
//      to put you inside it.
//   2  STAIRS, four steps at exactly the step-up limit.
//   3  A THIN WALL, 6 cm. Discrete collision tunnels straight through
//      this at walking speed; swept collision does not.
//   4  A PIT with a climbable edge on one side and a sheer drop on the
//      other. You can get out of the shallow end. You cannot climb out of
//      the deep end, but you can always be recovered.
//   5  A LEDGE to walk off, with a landing below.
//   6  A NARROW GAP, 0.7 m, wider than the body and narrower than
//      instinct suggests. Nobody may get wedged in it.
//   7  A MOVING PLATFORM that carries you.
//   8  A LOW CEILING you cannot stand under, so head clearance is real.
import * as THREE from 'three';
import { MATS, mat } from './materials.js';
import { box, platform, makeHeightAt, roomscaleZone } from './kit.js';

const FLOOR = 44;

// One station's worth of signage: a coloured post and a number, so a
// person walking the gym knows which hazard they are standing in.
function marker(level, n, x, z, colour) {
  const g = level.group;
  box(g, 0.12, 2.4, 0.12, mat(colour, 0.8), x, 1.2, z);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const t = c.getContext('2d');
  t.fillStyle = '#0d1014';
  t.fillRect(0, 0, 128, 128);
  t.fillStyle = '#' + colour.toString(16).padStart(6, '0');
  t.font = 'bold 92px system-ui, sans-serif';
  t.textAlign = 'center';
  t.textBaseline = 'middle';
  t.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  plate.position.set(x, 2.2, z);
  g.add(plate);
}

// A ramp at a given angle, built as a wedge of slabs like the real ones so
// it exercises the same code path platforms use.
function testRamp(level, x, z, degrees, id) {
  const rise = 2.0;
  const run = rise / Math.tan(degrees * Math.PI / 180);
  const steps = 10;
  const width = 2.4;
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    const h = rise * f;
    const sz = z + run * (1 - f);
    box(level.group, width, h, run / steps + 0.03, MATS.planksOld, x, h / 2, sz);
    level.ramps.push({
      x, z: sz, hx: width / 2, hz: run / steps / 2 + 0.015, top: h,
    });
  }
  // The landing at the top, so there is somewhere to arrive.
  box(level.group, width, rise, 1.6, MATS.concrete, x, rise / 2, z - 0.8);
  level.colliders.push({
    x, z: z - 0.8, hx: width / 2, hz: 0.8, tall: false, top: rise, walkable: true,
  });
  level.gymStations.push({ id, x, z: z + run * 0.5, top: rise, degrees });
}

export function buildGym(level, quality) {
  level.group.clear();
  level.colliders.length = 0;
  level.ramps.length = 0;
  level.gymStations = [];
  level.archetype = 'gym';
  level.daylight = true;
  level.waveLabel = 'TEST';
  level.droneAllowed = false;
  level.voids = [];
  level.lowered = [];
  level.doors = [];
  level.baseY = 0;
  level.floorY = 0;
  level.name = 'THE GYM';
  level.note = 'Every movement hazard in one room.';
  level.lighting = {
    daySky: 0x9fb8cc, dayHaze: 0xc8c2b4,
    fogNear: 40, fogFar: 140, sunDay: 2.2, hemiDay: 1.1, dark: false,
  };

  const floor = box(level.group, FLOOR, 0.2, FLOOR, MATS.concrete, 0, 0, 0);
  floor.receiveShadow = quality === 'DESKTOP';
  // A boundary wall so nobody wanders into the void by accident.
  for (const [wx, wz, ww, wd] of [
    [0, -FLOOR / 2, FLOOR, 0.4], [0, FLOOR / 2, FLOOR, 0.4],
    [-FLOOR / 2, 0, 0.4, FLOOR], [FLOOR / 2, 0, 0.4, FLOOR],
  ]) {
    box(level.group, ww, 3.2, wd, MATS.basementWall, wx, 1.6, wz);
    level.colliders.push({ x: wx, z: wz, hx: ww / 2, hz: wd / 2, tall: true });
  }

  // ---- 1. Ramps ----
  testRamp(level, -17, -2, 15, 'ramp15');
  testRamp(level, -13, -2, 30, 'ramp30');
  testRamp(level, -9, -2, 50, 'ramp50');
  marker(level, 1, -13, 4, 0x7fb069);

  // ---- 2. Stairs, each step exactly at the step-up limit ----
  // Ascending NORTHWARD, the direction you walk them from the open floor.
  // Built the other way round, the first step you meet is the tallest and
  // the staircase is correctly a wall.
  for (let i = 0; i < 4; i++) {
    const h = 0.44 * (i + 1);
    const z = 0.1 - i * 0.7;
    box(level.group, 2.4, h, 0.7, MATS.concrete, -4.5, h / 2, z);
    level.colliders.push({
      x: -4.5, z, hx: 1.2, hz: 0.35, tall: false, top: h, walkable: true,
    });
  }
  level.gymStations.push({ id: 'stairs', x: -4.5, z: -2.0, top: 1.76 });
  marker(level, 2, -4.5, 4, 0x7fb069);

  // ---- 3. A thin wall. Discrete collision tunnels through this. ----
  box(level.group, 3.0, 2.6, 0.06, MATS.metalShell, 0, 1.3, 0);
  level.colliders.push({ x: 0, z: 0, hx: 1.5, hz: 0.03, tall: true });
  level.gymStations.push({ id: 'thinwall', x: 0, z: 0 });
  marker(level, 3, 0, 4, 0xd83020);

  // ---- 4. A pit: climbable at one end, sheer at the other ----
  const pit = { x: 5.5, z: 0, w: 4.0, d: 4.0, depth: 2.4 };
  // A LOWERED FLOOR, not a void: this pit has a bottom you land on and a
  // stair out of it. A void is for holes with nothing underneath.
  level.lowered = [{
    x: pit.x, z: pit.z, hx: pit.w / 2 - 0.2, hz: pit.d / 2 - 0.2, floorY: -pit.depth,
  }];
  for (let ring = 0; ring < 4; ring++) {
    const y = -0.2 - ring * (pit.depth / 4);
    const h = pit.depth / 4;
    box(level.group, pit.w, h, 0.2, MATS.basementWall, pit.x, y - h / 2, pit.z - pit.d / 2);
    box(level.group, pit.w, h, 0.2, MATS.basementWall, pit.x, y - h / 2, pit.z + pit.d / 2);
    box(level.group, 0.2, h, pit.d, MATS.basementWall, pit.x - pit.w / 2, y - h / 2, pit.z);
    box(level.group, 0.2, h, pit.d, MATS.basementWall, pit.x + pit.w / 2, y - h / 2, pit.z);
  }
  box(level.group, pit.w, 0.2, pit.d, MATS.basementFloor, pit.x, -pit.depth, pit.z);
  // The climbable end: a stair out of the pit's north side.
  // Comfortably under the slope limit: at 0.42 rise per 0.42 tread it sat
  // exactly ON the limit, which is a coin toss rather than a staircase.
  for (let i = 0; i < 8; i++) {
    const y = -pit.depth + 0.32 * (i + 1);
    const z = pit.z - pit.d / 2 + 0.3 + i * 0.45;
    box(level.group, pit.w - 0.6, 0.3, 0.45, MATS.planksOld, pit.x, y, z);
    level.ramps.push({ x: pit.x, z, hx: (pit.w - 0.6) / 2, hz: 0.225, top: y + 0.15 });
  }
  level.gymStations.push({ id: 'pit', x: pit.x, z: pit.z, depth: pit.depth });
  marker(level, 4, 5.5, 4, 0xe0a33c);

  // ---- 5. A ledge to walk off ----
  platform(level, MATS.concrete, 11, -2, 4.0, 4.0, 1.9, 'south');
  level.gymStations.push({ id: 'ledge', x: 11, z: -2, top: 1.9 });
  marker(level, 5, 11, 4, 0x7fb069);

  // ---- 6. A narrow gap ----
  // 0.9 m: wider than the 0.64 m body, narrow enough to feel like a
  // squeeze. At 0.7 the clearance was 3 cm a side, which is a wedge
  // waiting to happen rather than a gap.
  const GAP = 0.9;
  for (const side of [-1, 1]) {
    const x = 16 + side * (GAP / 2 + 0.9);
    box(level.group, 1.8, 2.6, 2.4, MATS.basementWall, x, 1.3, 0);
    level.colliders.push({ x, z: 0, hx: 0.9, hz: 1.2, tall: true });
  }
  level.gymStations.push({ id: 'gap', x: 16, z: 0, width: GAP });
  marker(level, 6, 16, 4, 0xe0a33c);

  // ---- 7. A moving platform ----
  // Low enough to step onto: at 0.7 it was taller than the step-up limit,
  // so it was correctly refusing to be boarded.
  const mover = box(level.group, 3.0, 0.3, 3.0, MATS.metalDoor, -13, 0.25, 10);
  mover.userData.dynamic = true;
  const moverCollider = {
    x: -13, z: 10, hx: 1.5, hz: 1.5, tall: false, top: 0.4, walkable: true,
  };
  level.colliders.push(moverCollider);
  level.gymStations.push({ id: 'mover', x: -13, z: 10 });
  marker(level, 7, -13, 13.5, 0x5c9ead);

  // ---- 8. A low ceiling ----
  box(level.group, 5.0, 0.3, 3.0, MATS.basementWall, -4, 1.35, 10);
  for (const side of [-1, 1]) {
    box(level.group, 0.3, 1.2, 3.0, MATS.basementWall, -4 + side * 2.5, 0.6, 10);
    level.colliders.push({ x: -4 + side * 2.5, z: 10, hx: 0.15, hz: 1.5, tall: true });
  }
  level.gymStations.push({ id: 'ceiling', x: -4, z: 10, clearance: 1.2 });
  marker(level, 8, -4, 13.5, 0x5c9ead);

  level.voidAt = (x, z) => level.voids.some(
    (v) => Math.abs(x - v.x) < v.hx && Math.abs(z - v.z) < v.hz);
  level.heightAt = makeHeightAt(level, 0);
  level.navBounds = { minX: -26, maxX: 26, minZ: -26, maxZ: 26 };
  level.playBounds = { minX: -21, maxX: 21, minZ: -21, maxZ: 21 };
  level.playableHalf = 21;
  level.baseCentre = { x: 0, z: 8 };
  level.playerSpawns = [
    new THREE.Vector3(-19, 0, 8), new THREE.Vector3(-18, 0, 9),
    new THREE.Vector3(-20, 0, 9), new THREE.Vector3(-19, 0, 10),
  ];
  level.hordeAnchor = { x: 0, z: 8 };
  roomscaleZone(level, -19, 8);

  // The platform's motion, driven by the frame loop.
  let t = 0;
  level.tick = (dt) => {
    t += dt;
    const z = 10 + Math.sin(t * 0.5) * 1.6;
    mover.position.z = z;
    moverCollider.z = z;
  };
}
