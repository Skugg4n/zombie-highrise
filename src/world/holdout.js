// THE HOLDOUT FRAME (archetype A, docs/level-design.md, Ola's sketch L1).
//
// A holdout level is an open daylight field with a SMALL base in it that
// the squad cannot leave. This file owns the BASE: the low wall you shoot
// over and the horde chews through, the sandbags, the interior, the lift
// plate, and the boundary. The field around it is ordinary props from the
// level kit's library, described by the level's data file.
//
// The base can be DESTROYED. Every wall segment has hit points; zombies
// stop and hit the wall when they cannot reach a player, and a destroyed
// segment becomes a breach they walk through. Segments are one
// InstancedMesh, so a broken wall costs zero extra draw calls: a dead
// segment is scaled to nothing.
//
// THIS FILE IS MECHANISM, NOT LAYOUT. Every number that describes a
// particular level lives in src/world/levels/*.js. If you are here to move
// a crate, you are in the wrong file: see docs/level-format.md.
import * as THREE from 'three';
import { MATS } from './materials.js';
import { box } from './kit.js';

// The base footprint is the player's whole world on a holdout level, and
// the sim reads it to decide what counts as reachable, so it is exported.
// A level's data file may override it; this is the default a sketch gets
// if it does not say.
export const BASE_SIZE = 8;
const WALL_H = 0.95;                // waist high: shoot over it standing on the ground
const SEG = 1.0;                    // wall segment width
export const SEG_HP = 120;          // hit points per segment
const SANDBAG_H = 0.8;             // rest a barrel on it, do not hide behind it

// ---- The base wall ------------------------------------------------------
// One InstancedMesh for the whole perimeter. Each instance is a segment
// with its own hit points and its own collider; the collider carries a
// back-reference so combat can find the segment it just hit.
class BaseWall {
  constructor(level, group, segments, wallH = WALL_H) {
    this.level = level;
    this.segments = segments;      // {x, z, along, hp, maxHp, dead}
    this.wallH = wallH;
    const geo = new THREE.BoxGeometry(1, wallH, 1);
    // The material MUST be its own clone. Hanging instanceColor on the
    // shared MATS.concrete makes three compile that material with
    // USE_INSTANCING_COLOR, and every other mesh using it (the base slab)
    // then samples an attribute it does not have and renders black.
    this.mesh = new THREE.InstancedMesh(geo, MATS.concrete.clone(), segments.length);
    this.mesh.userData.dynamic = true;    // per-instance updates, never merged
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
    // Damage reads as colour: intact concrete goes red as it is chewed.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(segments.length * 3).fill(1), 3);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    for (let i = 0; i < segments.length; i++) this._write(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _write(i) {
    const s = this.segments[i];
    if (s.dead) {
      this._m.makeScale(0, 0, 0);
    } else {
      // A chewed segment visibly sinks and narrows before it goes.
      const f = s.hp / s.maxHp;
      const h = this.wallH * (0.55 + 0.45 * f);
      this._m.makeScale(s.along === 'x' ? SEG : 0.42, h, s.along === 'x' ? 0.42 : SEG);
      this._m.setPosition(s.x, h / 2, s.z);
    }
    this.mesh.setMatrixAt(i, this._m);
    const f = s.dead ? 1 : s.hp / s.maxHp;
    this._c.setRGB(1, 0.35 + 0.65 * f, 0.28 + 0.72 * f);
    this.mesh.setColorAt(i, this._c);
  }

  // Returns true if this hit destroyed the segment (the caller opens the
  // breach and invalidates the navigation grid).
  damage(i, amount) {
    const s = this.segments[i];
    if (!s || s.dead) return false;
    s.hp -= amount;
    if (s.hp <= 0) {
      s.hp = 0;
      s.dead = true;
      if (s.collider) s.collider.dead = true;
    }
    this._write(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return s.dead;
  }

  // Redraw one segment from its current hp. Clients call this after the
  // host's authoritative 'wall' event has set the numbers.
  refresh(i) {
    this._write(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  repair(i, amount) {
    const s = this.segments[i];
    if (!s || s.hp >= s.maxHp) return false;
    const wasDead = s.dead;
    s.hp = Math.min(s.maxHp, s.hp + amount);
    if (wasDead && s.hp > 0) {
      s.dead = false;
      if (s.collider) s.collider.dead = false;
    }
    this._write(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  // Fraction of the perimeter still standing: the base's health bar.
  integrity() {
    let sum = 0;
    for (const s of this.segments) sum += s.hp / s.maxHp;
    return sum / this.segments.length;
  }
}

// ---- Field dressing -----------------------------------------------------
// Sight blockers do two jobs: they hide the spawn behind them, and they
// break the field up so the approach is readable rather than a flat
// parade. Each returns nothing; it registers its own colliders.

// ---- Mid-ground -------------------------------------------------------
// The gap between the base wall and the far sight blockers is where the
// fight actually happens, and an empty plain there is the boredom Ola
// called out. These props give the approach texture: they break the
// horde's line, they give scale to the distance, and they are the
// landmarks a player calls out when directing the drone.

// ---- The frame ----------------------------------------------------------
// Called by the level kit once the field props are down. `spec.base` is
// the data; everything below is the mechanism that turns it into a base.
export function holdoutFrame(level, spec, ctx, { makeElevator, quality }) {
  const B = spec.base;
  const BX = B.at.x, BZ = B.at.z;
  const size = B.size || BASE_SIZE;
  const hb = size / 2;
  const wallH = (B.wall && B.wall.height) || WALL_H;
  const segHp = (B.wall && B.wall.hp) || SEG_HP;

  level.baseCentre = { x: BX, z: BZ };
  // The player never leaves the base, so this IS the playable area. The
  // sim uses it to decide whether a loot drop is reachable, and the pocket
  // check floods it looking for places a player can be pinned.
  level.playableHalf = hb;
  level.playBounds = {
    minX: BX - hb - 0.4, maxX: BX + hb + 0.4,
    minZ: BZ - hb - 0.4, maxZ: BZ + hb + 0.4,
  };

  const slab = box(level.group, size + 0.8, 0.22, size + 0.8, MATS.concrete, BX, 0, BZ);
  slab.receiveShadow = quality === 'DESKTOP';

  // ---- The perimeter ----
  // Built as segments so it can be broken piece by piece. The corners are
  // solid pillars: a base that loses its corners first looks wrong, and
  // they give the wall runs something to hang off.
  const segments = [];
  const pushSeg = (x, z, along) => {
    const s = { x, z, along, hp: segHp, maxHp: segHp, dead: false, index: segments.length };
    const c = {
      x, z,
      hx: along === 'x' ? SEG / 2 : 0.24,
      hz: along === 'x' ? 0.24 : SEG / 2,
      top: wallH, tall: false,      // shoot OVER it, do not walk through it
      wallSeg: s.index,
    };
    s.collider = c;
    level.colliders.push(c);
    segments.push(s);
  };
  const n = Math.round(size / SEG);
  for (let i = 0; i < n; i++) {
    const a = BX - hb + SEG / 2 + i * SEG;
    const b = BZ - hb + SEG / 2 + i * SEG;
    pushSeg(a, BZ - hb, 'x');       // north run
    pushSeg(a, BZ + hb, 'x');       // south run
    pushSeg(BX - hb, b, 'z');       // west run
    pushSeg(BX + hb, b, 'z');       // east run
  }
  for (const [cx, cz] of [[-hb, -hb], [hb, -hb], [-hb, hb], [hb, hb]]) {
    box(level.group, 0.6, wallH + 0.35, 0.6, MATS.metalShell, BX + cx, (wallH + 0.35) / 2, BZ + cz);
    level.colliders.push({
      x: BX + cx, z: BZ + cz, hx: 0.3, hz: 0.3, top: wallH + 0.35, tall: false,
    });
  }
  level.baseWall = new BaseWall(level, level.group, segments, wallH);

  // ---- The interior ----
  // Frame-local coordinates, translated by the kit. Everything near a wall
  // must be FLUSH to it: a prop parked 0.8 m off a wall leaves a slot
  // barely wider than the player, which they can walk into and then be
  // unable to walk out of. That is checked by the pocket flood fill.
  ctx.buildProps(B.interior, BX, BZ);

  // ---- The lift plate ----
  // The lift is part of the base, so its position AND its facing derive
  // from the base, never chosen independently. Axis-aligned on purpose:
  // an earlier version rotated the cab to "look at the centre" while its
  // collider stayed axis-aligned, so the visible cab stuck out past its
  // own collision and the boarding zone landed inside solid geometry.
  level.elevator = makeElevator();
  const PW = level.elevator.plateW, PD = level.elevator.plateD;
  const inset = (B.lift && B.lift.inset) !== undefined ? B.lift.inset : 0.24;
  const corner = (B.lift && B.lift.corner) || 'southwest';
  const west = corner.includes('west');
  const north = corner.includes('north');
  const ex = west ? BX - hb + inset + PW / 2 : BX + hb - inset - PW / 2;
  const ez = north ? BZ - hb + inset + PD / 2 : BZ + hb - inset - PD / 2;
  level.elevator.group.position.set(ex, 0, ez);
  level.group.add(level.elevator.group);
  level.colliders.push({
    x: ex, z: ez, hx: PW / 2, hz: PD / 2,
    tall: false, top: level.elevator.plateTop, walkable: true,
  });
  level.colliders.push({
    x: ex + level.elevator.postX, z: ez + level.elevator.postZ,
    hx: 0.16, hz: 0.16, tall: false, top: 1.1,
  });
  // Boarding is standing ON the plate now, so the zone IS the plate.
  level.elevatorZone = { x: ex, z: ez, hx: PW / 2, hz: PD / 2 };

  // ---- The boundary ----
  // The wall itself confines the squad while it stands. This outer ring
  // only matters once a segment is BREACHED: it stops the player strolling
  // out through the hole the horde just made, while staying invisible to
  // the horde, which must be able to reach the wall to attack it.
  //
  // It sits CLEAR of the wall. Overlapping it created a pocket between the
  // two where the wall pushed the player one way, the ring pushed them
  // back, and they were pinned unable to move at all.
  const ob = hb + 1.2;
  for (const [bx, bz, bw, bd] of [
    [BX, BZ - ob, size + 3.2, 0.5], [BX, BZ + ob, size + 3.2, 0.5],
    [BX - ob, BZ, 0.5, size + 3.2], [BX + ob, BZ, 0.5, size + 3.2],
  ]) {
    level.colliders.push({
      x: bx, z: bz, hx: bw / 2, hz: bd / 2, tall: false, playerOnly: true, keepIn: true,
    });
  }

  // Where the HORDE is trying to get to. Not the middle of the base: the
  // base is deliberately sealed, so nothing outside can reach the middle
  // until the wall is chewed open. What every spawn must be able to reach
  // is the OUTSIDE of the wall, and that is what the playability check
  // floods from.
  level.hordeAnchor = { x: BX + hb + 1.6, z: BZ };

  // ---- Player spawns ----
  for (const p of B.playerSpawns) {
    level.playerSpawns.push(new THREE.Vector3(BX + p.x, 0, BZ + p.z));
  }
}
