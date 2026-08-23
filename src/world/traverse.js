// THE TRAVERSE FRAME (archetype B, docs/level-design.md, Ola's sketch L2).
//
// A route, not a siege. You arrive in one corner and must reach the exit
// in the opposite one. Underground and therefore DARK: this is where the
// flashlight and the claustrophobia live, and the contrast with the
// daylight holdout levels is the emotional rhythm of the whole campaign.
//
// The rules that make it work, from the design doc:
//   - Movement forward is the objective, not a survival timer. Waves come
//     because you ADVANCE, not because a clock ticks.
//   - Every zombie entrance is a visible hole. Nothing from nothing.
//   - The drone cannot fly down here, and the fiction says so.
//
// This file owns the ROUTE: the room, its dividing walls, the chasm you
// go around, the door you have to stop and open, the spawn holes, the
// arrival plate and the exit plate. The dressing is ordinary props from
// the level kit, described by the level's data file.
//
// THIS FILE IS MECHANISM, NOT LAYOUT. Every number that describes a
// particular level lives in src/world/levels/*.js. See docs/level-format.md.
import * as THREE from 'three';
import { MATS, mat } from './materials.js';
import { box } from './kit.js';

const WALL_H = 3.1;
const DOOR_H = 2.3;

// ---- The chasm ----------------------------------------------------------
// A hole in the floor with a real bottom a long way down. It has to be a
// genuine void rather than a dark texture: the character controller asks
// the level for the ground height, and a chasm answers "there isn't any".
function buildChasm(level, c) {
  const g = level.group;
  const hx = c.w / 2, hz = c.d / 2;
  const lip = mat(0x4a453d, 1.0);
  const deep = new THREE.MeshBasicMaterial({ color: 0x05060a });

  // A black plane far below, so looking in reads as depth and not as a
  // hole in the rendering.
  const floorFar = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.d), deep);
  floorFar.rotation.x = -Math.PI / 2;
  floorFar.position.set(c.x, -14, c.z);
  g.add(floorFar);

  // Broken edging all the way round, so the drop is visible from a
  // distance rather than discovered by falling into it.
  const step = 0.9;
  for (let t = -hx; t <= hx; t += step) {
    for (const side of [-1, 1]) {
      const h = 0.22 + ((Math.abs(t * 7) | 0) % 3) * 0.09;
      box(g, step * 1.02, h, 0.34, lip, c.x + t, h / 2, c.z + side * hz);
    }
  }
  for (let t = -hz; t <= hz; t += step) {
    for (const side of [-1, 1]) {
      const h = 0.22 + ((Math.abs(t * 5) | 0) % 3) * 0.09;
      box(g, 0.34, h, step * 1.02, lip, c.x + side * hx, h / 2, c.z + t);
    }
  }
  // Inner walls of the shaft, so the edge has thickness.
  for (const [sx, sz, sw, sd] of [
    [c.x, c.z - hz, c.w, 0.2], [c.x, c.z + hz, c.w, 0.2],
    [c.x - hx, c.z, 0.2, c.d], [c.x + hx, c.z, 0.2, c.d],
  ]) {
    box(g, sw, 4, sd, mat(0x2a2721, 1.0), sx, -2, sz);
  }

  level.voids.push({ x: c.x, z: c.z, hx, hz });
}

// ---- The door -----------------------------------------------------------
// A slab that slides up out of the way, opened by holding a button beside
// it. The design doc asks for "a moment of standing still and defending",
// and a hold is exactly that moment.
function buildDoor(level, d, index) {
  const g = level.group;
  const along = d.along || 'x';
  const w = along === 'x' ? d.width : 0.3;
  const dep = along === 'x' ? 0.3 : d.width;

  // The frame, so the opening reads as a door and not as a gap.
  const frameMat = MATS.metalShell;
  for (const side of [-1, 1]) {
    const ox = along === 'x' ? side * (d.width / 2 + 0.16) : 0;
    const oz = along === 'x' ? 0 : side * (d.width / 2 + 0.16);
    box(g, along === 'x' ? 0.32 : 0.42, WALL_H, along === 'x' ? 0.42 : 0.32,
      frameMat, d.x + ox, WALL_H / 2, d.z + oz);
    level.colliders.push({
      x: d.x + ox, z: d.z + oz,
      hx: (along === 'x' ? 0.32 : 0.42) / 2, hz: (along === 'x' ? 0.42 : 0.32) / 2,
      tall: true,
    });
  }
  box(g, along === 'x' ? d.width + 0.6 : 0.42, 0.4, along === 'x' ? 0.42 : d.width + 0.6,
    frameMat, d.x, WALL_H - 0.2, d.z);

  // The slab itself. Dynamic, because it moves.
  const slab = box(g, w, DOOR_H, dep, MATS.metalDoor, d.x, DOOR_H / 2, d.z);
  slab.userData.dynamic = true;
  // Hazard stripes across it, so a closed door reads as "this is the way".
  const stripe = box(g, along === 'x' ? w * 0.9 : 0.34, 0.22, along === 'x' ? 0.34 : dep * 0.9,
    mat(0xc8a020, 0.9), d.x, DOOR_H - 0.5, d.z);
  stripe.userData.dynamic = true;

  const collider = {
    x: d.x, z: d.z,
    hx: (along === 'x' ? w : dep) / 2 + 0.05,
    hz: (along === 'x' ? dep : w) / 2 + 0.05,
    tall: true, door: index,
  };
  level.colliders.push(collider);

  // The button, on a post you can walk up to.
  const bx = d.x + (d.button ? d.button.dx : (along === 'x' ? d.width / 2 + 0.9 : 0));
  const bz = d.z + (d.button ? d.button.dz : (along === 'x' ? 0 : d.width / 2 + 0.9));
  box(g, 0.16, 1.2, 0.16, frameMat, bx, 0.6, bz);
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.24, 0.1),
    new THREE.MeshStandardMaterial({
      color: 0x1a1f24, emissive: 0xff8020, emissiveIntensity: 1.5,
    }));
  panel.position.set(bx, 1.28, bz);
  panel.userData.dynamic = true;
  g.add(panel);
  level.colliders.push({ x: bx, z: bz, hx: 0.18, hz: 0.18, tall: false, top: 1.4 });

  level.doors.push({
    index, x: d.x, z: d.z, open: false,
    buttonX: bx, buttonZ: bz,
    label: d.label || 'HOLD TO OPEN THE DOOR',
    slab, stripe, panel, collider, baseY: DOOR_H / 2,
  });
}

// ---- A spawn hole -------------------------------------------------------
// Every entrance is something you can see. A hole in a wall, framed with
// broken edging, with darkness behind it.
function buildHole(level, h) {
  const g = level.group;
  const along = h.along || 'x';
  const w = h.width || 2.0;
  const dark = new THREE.MeshBasicMaterial({ color: 0x04050a });
  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(w, 2.0),
    dark);
  hole.position.set(h.x, 1.0, h.z);
  hole.rotation.y = along === 'x' ? 0 : Math.PI / 2;
  g.add(hole);
  // Broken edging around it.
  const rubble = mat(0x574f45, 1.0);
  for (let i = 0; i < 7; i++) {
    const t = (i / 6 - 0.5) * w;
    const hh = 0.2 + (i % 3) * 0.16;
    const ox = along === 'x' ? t : 0;
    const oz = along === 'x' ? 0 : t;
    box(g, 0.4, hh, 0.4, rubble, h.x + ox, 2.0 + hh / 2, h.z + oz, i * 0.4);
    box(g, 0.34, 0.3, 0.34, rubble,
      h.x + ox * 0.8 + (along === 'x' ? 0 : 0.5), 0.15, h.z + oz * 0.8 + (along === 'x' ? 0.5 : 0),
      i);
  }
  level.entries.push(new THREE.Vector3(h.x, 0, h.z));
  level.spawnSources.push({ x: h.x, z: h.z, kind: h.id || 'hole' });
  level.zombieSpawns.push(new THREE.Vector3(
    h.x + (along === 'x' ? 0 : (h.inward || -1) * 0.9),
    0,
    h.z + (along === 'x' ? (h.inward || -1) * 0.9 : 0)));
}

// ---- The frame ----------------------------------------------------------
export function traverseFrame(level, spec, ctx, { makeElevator, quality }) {
  const R = spec.route;
  const RX = R.at.x, RZ = R.at.z;
  const hw = R.size.w / 2, hd = R.size.d / 2;

  level.objective = 'reach-exit';
  level.voids = [];
  level.doors = [];
  level.playableHalf = Math.max(hw, hd);
  level.playBounds = {
    minX: RX - hw + 0.1, maxX: RX + hw - 0.1,
    minZ: RZ - hd + 0.1, maxZ: RZ + hd - 0.1,
  };
  level.baseCentre = { x: RX, z: RZ };

  // The floor, and a ceiling that the tactical map can see through.
  const floor = box(level.group, R.size.w, 0.2, R.size.d, MATS.basementFloor, RX, 0, RZ);
  floor.receiveShadow = quality === 'DESKTOP';

  // The outer walls. Openings are made by the spawn holes, which cut
  // their own darkness into them.
  for (const [wx, wz, ww, wd] of [
    [RX, RZ - hd, R.size.w + 0.6, 0.3], [RX, RZ + hd, R.size.w + 0.6, 0.3],
    [RX - hw, RZ, 0.3, R.size.d + 0.6], [RX + hw, RZ, 0.3, R.size.d + 0.6],
  ]) {
    box(level.group, ww, WALL_H, wd, MATS.basementWall, wx, WALL_H / 2, wz);
    level.colliders.push({ x: wx, z: wz, hx: ww / 2, hz: wd / 2, tall: true });
  }

  // Interior walls, frame-local.
  for (const w of (R.walls || [])) {
    const x = RX + w.x, z = RZ + w.z;
    box(level.group, w.w, WALL_H, w.d, MATS.basementWall, x, WALL_H / 2, z);
    level.colliders.push({ x, z, hx: w.w / 2, hz: w.d / 2, tall: true });
  }

  if (R.chasm) buildChasm(level, { ...R.chasm, x: RX + R.chasm.x, z: RZ + R.chasm.z });
  for (let i = 0; i < (R.doors || []).length; i++) {
    const d = R.doors[i];
    buildDoor(level, { ...d, x: RX + d.x, z: RZ + d.z }, i);
  }
  for (const h of (R.holes || [])) {
    buildHole(level, { ...h, x: RX + h.x, z: RZ + h.z });
  }

  // Props (crates, barrels, a weapon locker) are ordinary kit props.
  ctx.buildProps(R.interior, RX, RZ);

  // ---- The two plates ----
  // You arrive on one and leave on the other. Both are the same lift plate
  // used everywhere else: the design doc keeps the lift as the campaign's
  // transition device and nothing more.
  level.elevator = makeElevator();
  const PW = level.elevator.plateW, PD = level.elevator.plateD;
  const sx = RX + R.spawnPlate.x, sz = RZ + R.spawnPlate.z;
  level.elevator.group.position.set(sx, 0, sz);
  level.group.add(level.elevator.group);
  level.colliders.push({
    x: sx, z: sz, hx: PW / 2, hz: PD / 2,
    tall: false, top: level.elevator.plateTop, walkable: true,
  });

  // The EXIT plate is what completes the level, so it is marked: a lit
  // frame you can see from the far corner, which is the whole objective.
  const ex = RX + R.exitPlate.x, ez = RZ + R.exitPlate.z;
  const exit = makeElevator();
  exit.group.position.set(ex, 0, ez);
  level.group.add(exit.group);
  level.colliders.push({
    x: ex, z: ez, hx: PW / 2, hz: PD / 2,
    tall: false, top: exit.plateTop, walkable: true,
  });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 2.6, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0x1a1f24, emissive: 0x30ff90, emissiveIntensity: 1.2,
      }));
    post.position.set(ex + side * (PW / 2 + 0.1), 1.3, ez - PD / 2);
    level.group.add(post);
  }
  const exitLamp = new THREE.PointLight(0x50ffa0, 2.4, 9);
  exitLamp.position.set(ex, 2.4, ez);
  level.group.add(exitLamp);
  level.exitElevator = exit;
  level.elevatorZone = { x: ex, z: ez, hx: PW / 2, hz: PD / 2 };
  level.exitZone = level.elevatorZone;

  // Where the horde is trying to get to, for the playability check: the
  // squad's own arrival plate, since there is no wall between them.
  level.hordeAnchor = { x: sx, z: sz };

  level.playerSpawns = [];
  for (const p of R.playerSpawns) {
    level.playerSpawns.push(new THREE.Vector3(RX + p.x, 0, RZ + p.z));
  }

  // Ground sampling has to know about the hole. `heightAt` is rebuilt by
  // the kit after this returns, so the void test is installed as a filter
  // the kit's sampler consults.
  level.voidAt = (x, z) => level.voids.some(
    (v) => Math.abs(x - v.x) < v.hx && Math.abs(z - v.z) < v.hz);
}

// Open or close a door, on any peer. The collider going dead is what makes
// the opening real to the player, the horde and the pathfinder at once.
export function setDoorOpen(level, index, open) {
  const d = level.doors && level.doors[index];
  if (!d || d.open === open) return false;
  d.open = open;
  d.collider.dead = open;
  d.slab.position.y = open ? DOOR_H * 1.5 : d.baseY;
  d.stripe.position.y = open ? DOOR_H * 2 : DOOR_H - 0.5;
  d.panel.material.emissive.setHex(open ? 0x30ff90 : 0xff8020);
  level.nav = null;              // the route through it is real now
  level.collidersZ = null;
  return true;
}
