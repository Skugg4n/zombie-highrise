// HOLDOUT levels (archetype A, docs/level-design.md, Ola's sketch L1).
//
// An open daylight field about 80 m across with haze hiding the far
// ground. The squad's base is SMALL (8x8 m) and sits off-centre in it.
// Players cannot leave the base: the low wall is the boundary, and that
// is deliberate. It is what makes the drone matter and what makes a
// roomscale VR play area line up with the base footprint.
//
// The base can be DESTROYED. Every wall segment has hit points; zombies
// stop and hit the wall when it is between them and a player, and a
// destroyed segment becomes a breach they walk through. Segments are one
// InstancedMesh, so a broken wall costs zero extra draw calls: a dead
// segment is scaled to nothing.
//
// Nothing spawns in the open. Every spawn point sits behind a sight
// blocker (ridge, tree, burnt-out cars, rock, house), so the horde
// appears out of the haze at 30 m and walks the whole way in.
import * as THREE from 'three';
import { PALETTE, MATS, mat } from './materials.js';
import { box, cover, platform, railing, roomscaleZone, makeHeightAt } from './kit.js';

// Local-to-world for a prop rotated by `rot` about Y. three's Y rotation
// maps local (lx, lz) to world (lx*cos + lz*sin, -lx*sin + lz*cos); the
// naive 2D rotation has the opposite sign and scatters sub-parts off the
// body they belong to (wheels beside the car, ribs poking out of the
// container). Every rotated prop here goes through this.
function rotXZ(lx, lz, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [lx * c + lz * s, -lx * s + lz * c];
}

export const FIELD = 80;            // the open field, edge to edge
export const BASE_SIZE = 8;         // the base footprint (players' whole world)
const WALL_H = 0.95;                // waist high: shoot over it standing on the ground
const SEG = 1.0;                    // wall segment width
export const SEG_HP = 120;          // hit points per segment
const SANDBAG_H = 0.8;             // rest a barrel on it, do not hide behind it

// ---- The base wall ------------------------------------------------------
// One InstancedMesh for the whole perimeter. Each instance is a segment
// with its own hit points and its own collider; the collider carries a
// back-reference so combat can find the segment it just hit.
class BaseWall {
  constructor(level, group, segments) {
    this.level = level;
    this.segments = segments;      // {x, z, along, hp, maxHp, dead}
    const geo = new THREE.BoxGeometry(1, WALL_H, 1);
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
      const h = WALL_H * (0.55 + 0.45 * f);
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

function ridge(level, x, z, len, height, rot) {
  const g = level.group;
  const m = mat(PALETTE.hills, 1.0);
  const n = Math.max(3, Math.round(len / 4));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    // A rolling profile, tallest in the middle, so it reads as terrain.
    const h = height * (0.45 + 0.55 * Math.cos(t * Math.PI));
    const w = 5.5 + (i % 3) * 1.4;
    const [ox, oz] = rotXZ(t * len, 0, rot);
    const px = x + ox, pz = z + oz;
    const b = box(g, w, h, w * 0.8, m, px, h / 2 - 0.4, pz, rot + i * 0.3);
    b.castShadow = false;
    level.colliders.push({ x: px, z: pz, hx: w * 0.45, hz: w * 0.45, tall: true });
  }
}

function loneTree(level, x, z) {
  const g = level.group;
  const bark = mat(0x4a3a28, 1.0);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 5.4, 6), bark);
  trunk.position.set(x, 2.7, z);
  g.add(trunk);
  // Dead branches: this field has no leaves left on anything.
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05, len = 2.2 - i * 0.15;
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, len, 4), bark);
    br.position.set(x + Math.cos(a) * len * 0.35, 3.6 + (i % 3) * 0.6, z + Math.sin(a) * len * 0.35);
    br.rotation.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9 + 0.7);
    g.add(br);
  }
  level.colliders.push({ x, z, hx: 0.5, hz: 0.5, tall: true });
}

function burntCars(level, x, z, rng) {
  const g = level.group;
  const body = mat(0x3a3630, 0.95, 0.25);
  const rust = mat(PALETTE.rust, 1.0);
  for (let i = 0; i < 3; i++) {
    const cx = x + (i - 1) * 3.2 + rng.range(-0.8, 0.8);
    const cz = z + rng.range(-2.2, 2.2);
    const ry = rng.range(-0.9, 0.9);
    box(g, 4.3, 0.85, 1.9, i === 1 ? rust : body, cx, 0.5, cz, ry);      // hull
    box(g, 2.1, 0.75, 1.75, body, cx - 0.3, 1.25, cz, ry);               // cabin
    for (const [wx, wz] of [[1.5, 0.95], [1.5, -0.95], [-1.5, 0.95], [-1.5, -0.95]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 8), mat(0x1d1b18, 1.0));
      w.rotation.z = Math.PI / 2;
      const [ox, oz] = rotXZ(wx, wz, ry);
      w.position.set(cx + ox, 0.34, cz + oz);
      w.rotation.y = ry;
      g.add(w);
    }
    level.colliders.push({ x: cx, z: cz, hx: 2.3, hz: 1.5, tall: true });
  }
}

function bigRock(level, x, z) {
  const g = level.group;
  const m = mat(0x7d766c, 1.0);
  for (let i = 0; i < 5; i++) {
    const s = 2.6 - i * 0.32;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), m);
    r.position.set(x + (i - 2) * 1.9, s * 0.55 - 0.4, z + ((i % 2) ? 1.4 : -1.3));
    r.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    g.add(r);
    level.colliders.push({ x: r.position.x, z: r.position.z, hx: s * 0.8, hz: s * 0.8, tall: true });
  }
}

function ruinedHouse(level, x, z, rot = 0) {
  const g = level.group;
  const W = 11, D = 8, H = 5.2;
  const m = MATS.plaster;
  const put = (lx, lz, lw, ld, h, y = h / 2) => {
    const [ox, oz] = rotXZ(lx, lz, rot);
    const wx = x + ox, wz = z + oz;
    box(g, lw, h, ld, m, wx, y, wz, rot);
    const swap = Math.abs(Math.sin(rot)) > 0.5;
    level.colliders.push({
      x: wx, z: wz,
      hx: (swap ? ld : lw) / 2, hz: (swap ? lw : ld) / 2, tall: true,
    });
  };
  put(0, -D / 2, W, 0.5, H);                       // back wall, full height
  put(-W / 2, 0, 0.5, D, H);                       // left wall
  put(W / 2, 0, 0.5, D, H * 0.6);                  // right wall, collapsed
  put(-W / 4, D / 2, W / 2, 0.5, H);               // front, partial
  // Window holes punched in the front, so it reads as a building and the
  // horde is briefly framed by them as it comes through.
  for (const wx of [1.5, 4.2]) {
    for (const wy of [1.5, 3.4]) {
      const [ox, oz] = rotXZ(wx, D / 2 + 0.02, rot);
      box(g, 1.1, 1.1, 0.14, mat(0x14100c, 1.0), x + ox, wy, z + oz, rot);
    }
  }
  // Broken roofline
  for (let i = 0; i < 5; i++) {
    const [ox, oz] = rotXZ((i - 2) * 2.2, 0, rot);
    box(g, 2.0, 0.4 + (i % 2) * 0.5, D * 0.9, m, x + ox, H + 0.2, z + oz, rot);
  }
}

// A far ring of city silhouettes. They must sit LOW, inside the horizon
// haze band: tall towers past the fog read as white paper cut-outs
// against blue sky, which is worse than no skyline at all.
function skyline(group, rng) {
  const m = mat(0x3f4450, 1.0);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rng.range(-0.06, 0.06);
    const r = 108 + rng.range(-14, 26);
    const h = rng.range(8, 22);
    const w = rng.range(10, 24);
    const b = box(group, w, h, w * 0.8, m, Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r, a);
    b.castShadow = false;
  }
}

// ---- Mid-ground -------------------------------------------------------
// The gap between the base wall and the far sight blockers is where the
// fight actually happens, and an empty plain there is the boredom Ola
// called out. These props give the approach texture: they break the
// horde's line, they give scale to the distance, and they are the
// landmarks a player calls out when directing the drone.

function crashBarrier(level, x, z, len, rot) {
  const g = level.group;
  const m = mat(0x8e8a82, 1.0);
  const n = Math.round(len / 2.2);
  for (let i = 0; i < n; i++) {
    const [ox, oz] = rotXZ((i - (n - 1) / 2) * 2.2, 0, rot);
    const px = x + ox, pz = z + oz;
    // Some sections are knocked flat: the barrier is a filter, not a wall.
    const down = (i * 7 + 3) % 5 === 0;
    if (down) {
      box(g, 2.0, 0.22, 0.9, m, px, 0.11, pz, rot + 0.4);
      continue;
    }
    box(g, 2.0, 0.85, 0.42, m, px, 0.42, pz, rot);
    level.colliders.push({
      x: px, z: pz,
      hx: Math.abs(Math.cos(rot)) > 0.5 ? 1.0 : 0.25,
      hz: Math.abs(Math.cos(rot)) > 0.5 ? 0.25 : 1.0,
      top: 0.85, tall: false,
    });
  }
}

function container(level, x, z, rot, colour) {
  const g = level.group;
  const m = mat(colour, 0.85, 0.2);
  const W = 6.0, H = 2.6, D = 2.44;
  box(g, W, H, D, m, x, H / 2, z, rot);
  // Ribbed ends so it reads as a container and not a coloured brick.
  for (let i = 0; i < 5; i++) {
    const [ox, oz] = rotXZ((i - 2) * (W / 5.4), 0, rot);
    box(g, 0.14, H - 0.2, D + 0.06, mat(colour, 0.9, 0.2), x + ox, H / 2, z + oz, rot);
  }
  const swap = Math.abs(Math.sin(rot)) > 0.5;
  level.colliders.push({
    x, z, hx: (swap ? D : W) / 2, hz: (swap ? W : D) / 2, tall: true,
  });
}

function pylons(level, x, z, dx, dz, count) {
  const g = level.group;
  const m = mat(0x5a4c3a, 1.0);
  for (let i = 0; i < count; i++) {
    const px = x + dx * i, pz = z + dz * i;
    const lean = ((i * 5) % 7) * 0.03;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 7.0, 6), m);
    pole.position.set(px, 3.4, pz);
    pole.rotation.z = lean;
    g.add(pole);
    box(g, 2.4, 0.16, 0.16, m, px, 6.3, pz, Math.atan2(dz, dx) + Math.PI / 2);
    level.colliders.push({ x: px, z: pz, hx: 0.3, hz: 0.3, tall: true });
  }
}

// A mound of rubble and concrete pipes. Close-in cover: big enough to
// hide a body walking out from behind it, small enough not to wall off
// the base's sightlines.
function pipeMound(level, x, z, rot) {
  const g = level.group;
  const stone = mat(0x8a8378, 1.0);
  const pipe = mat(0x9d968b, 0.9);
  for (let i = 0; i < 4; i++) {
    const [ox, oz] = rotXZ((i - 1.5) * 1.35, (i % 2) ? 0.5 : -0.5, rot);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.6, 10, 1, true), pipe);
    p.position.set(x + ox, 0.62, z + oz);
    p.rotation.set(Math.PI / 2, 0, rot + (i % 2) * 0.2);
    g.add(p);
    level.colliders.push({ x: x + ox, z: z + oz, hx: 1.3, hz: 0.65, tall: true });
  }
  for (let i = 0; i < 5; i++) {
    const [ox, oz] = rotXZ((i - 2) * 1.1, 1.9 + (i % 2) * 0.6, rot);
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55 + (i % 3) * 0.2, 0), stone);
    r.position.set(x + ox, 0.35, z + oz);
    r.rotation.set(i, i * 1.4, i * 0.6);
    g.add(r);
    level.colliders.push({ x: x + ox, z: z + oz, hx: 0.7, hz: 0.7, tall: true });
  }
}

function busWreck(level, x, z, rot) {
  const g = level.group;
  const body = mat(0x5a5347, 0.9, 0.2);
  box(g, 9.5, 2.5, 2.5, body, x, 1.35, z, rot);
  box(g, 9.0, 0.5, 2.2, mat(0x241f19, 1.0), x, 2.1, z, rot);      // burnt roof line
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const [ox, oz] = rotXZ((i - 1.5) * 2.4, side * 1.25, rot);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 8), mat(0x1d1b18, 1.0));
      w.position.set(x + ox, 0.5, z + oz);
      w.rotation.z = Math.PI / 2;
      w.rotation.y = rot;
      g.add(w);
    }
  }
  const swap = Math.abs(Math.sin(rot)) > 0.5;
  level.colliders.push({ x, z, hx: (swap ? 2.5 : 9.5) / 2, hz: (swap ? 9.5 : 2.5) / 2, tall: true });
}

// ---- The level ----------------------------------------------------------
export function buildHoldout(level, rng, quality, makeElevator) {
  const g = level.group;
  level.floorY = 0;
  level.baseY = 0;
  level.archetype = 'holdout';
  // A surface level never goes dark. Waves arrive in daylight; the sun
  // just gets lower and warmer as they climb.
  level.daylight = true;
  level.waveLabel = 'WAVE';
  level.mapExtent = FIELD * 0.62;   // the tactical map has to show the whole field
  // The horde spawns out to 46 m from a base that is not at the world
  // origin. The default nav grid is a 34 m box around (0,0), which left
  // the far spawns off the grid entirely: those zombies never found a
  // route in and the night could not be finished.
  level.navBounds = { minX: -52, maxX: 46, minZ: -52, maxZ: 44 };

  // Sketch L1: the base sits toward the north-west, and every sight
  // blocker is east and south of it. That asymmetry is the point. The
  // threat arrives across an arc from north through east to south-west,
  // so where you stand inside the base is a real decision.
  const BX = -13, BZ = -11;
  level.baseCentre = { x: BX, z: BZ };
  level.playableHalf = BASE_SIZE / 2;   // the player never leaves the base
  const hb = BASE_SIZE / 2;

  // Daylight and haze. fogNear starts past the base so the base itself is
  // always crisp; the far ground dissolves, which is what hides the
  // spawns and makes the horde emerge rather than appear.
  level.lighting = {
    daySky: PALETTE.daySky, dayHaze: PALETTE.dayHaze,
    fogNear: 26, fogFar: 96, sunDay: 2.4, hemiDay: 1.0, dark: false,
  };

  // ---- The field ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), MATS.sandGround);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = quality === 'DESKTOP';
  g.add(ground);

  // A road running past the base gives the eye a line into the haze.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 420), mat(PALETTE.road, 1.0));
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = 0.22;
  road.position.set(6, 0.01, 0);
  g.add(road);

  // Sight blockers, laid out to the sketch.
  ridge(level, 6, -34, 34, 6.5, 0.18);                  // RIDGE, north
  loneTree(level, 18, -6);                              // TREE, east
  burntCars(level, 22, 9, rng);                         // BURNT OUT CARS, south-east
  bigRock(level, -22, 16);                              // ROCK, south-west
  ruinedHouse(level, 8, 26, -0.25);                     // HOUSE, south
  ruinedHouse(level, -34, -27, 1.1);                    // a second one, north-west

  // Mid-ground: the ground the horde actually crosses.
  crashBarrier(level, 2, -14, 22, 1.35);                // along the road, north
  crashBarrier(level, 11, 14, 18, 1.35);                // along the road, south
  container(level, -4, 6, 0.5, 0x6b3a2e);               // south of the base
  container(level, 12, -22, -0.9, 0x2f4a52);            // on the ridge approach
  container(level, -22, -4, 1.4, 0x4a4736);             // west, the quiet side
  busWreck(level, -6, 20, 0.35);                        // south-west approach
  // Close-in cover, so the near ring has somewhere to come from.
  pipeMound(level, -4, -15, 0.6);                       // 10 m out, north-east
  busWreck(level, -15, -1.5, 1.5);                      // 10 m out, south
  pylons(level, -8, -30, 6.5, 4.2, 6);                  // marching in from the ridge
  pylons(level, 26, -2, 2.0, 7.5, 5);                   // east, past the tree
  skyline(g, rng);

  // Scrub and debris across the field: nothing to hide behind, but the
  // ground stops being a flat plane and distances become readable.
  for (let i = 0; i < 46; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(14, FIELD / 2 + 12);
    const px = BX + Math.cos(a) * r, pz = BZ + Math.sin(a) * r;
    const s = rng.range(0.35, 1.1);
    const d = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat(0x8b8070, 1.0));
    d.position.set(px, s * 0.35 - 0.1, pz);
    d.rotation.set(i, i * 0.7, i * 1.9);
    g.add(d);
  }

  // ---- Zombie spawns: three rings, always behind a blocker ----
  //
  // Ola on the approach: "mixed distances, not one distance. Nearest
  // spawn cover about 12-15 m so something is on you within roughly ten
  // seconds, mid ring about 25 m, far ring 40 m+ for the ones you watch
  // build up. Wave 1 starts from the near ring so the level opens fast."
  //
  // The long walk is only tension if you can ACT during it, so the near
  // ring gives you something to shoot immediately while the far ring
  // builds the thing you are dreading. Every point still sits behind a
  // sight blocker: nothing is ever born in the open.
  //
  // A spawn is described by the thing it hides behind and how far out it
  // is, and the position is DERIVED: put it on the base-to-blocker ray at
  // the ring distance, which is always further out than the blocker, so
  // it is always hidden and always at the intended range. Hand-placed
  // coordinates drift out of their ring the moment anything moves.
  const spawnBehind = (bx, bz, dist) => {
    const dx = bx - BX, dz = bz - BZ;
    const d = Math.hypot(dx, dz) || 1;
    return { x: BX + (dx / d) * dist, z: BZ + (dz / d) * dist };
  };
  const spawnPoints = [
    // NEAR (13-15 m): something is on you within about ten seconds, so
    // the level opens fast instead of with a minute of empty field.
    { at: [-4, -15], from: 'pipes', ring: 'near', dist: 14 },
    { at: [-15, -1.5], from: 'bus', ring: 'near', dist: 14.5 },
    { at: [-22, -4], from: 'container', ring: 'near', dist: 15 },
    // MID (24-27 m): the working distance, where most of it happens.
    { at: [2, -14], from: 'barrier', ring: 'mid', dist: 25 },
    { at: [-4, 6], from: 'container', ring: 'mid', dist: 26 },
    { at: [12, -22], from: 'container', ring: 'mid', dist: 27 },
    { at: [-34, -27], from: 'house', ring: 'mid', dist: 27 },
    // FAR (40 m+): the ones you watch gather out of the haze, and dread.
    { at: [6, -34], from: 'ridge', ring: 'far', dist: 42 },
    { at: [18, -6], from: 'tree', ring: 'far', dist: 40 },
    { at: [22, 9], from: 'cars', ring: 'far', dist: 44 },
    { at: [-22, 16], from: 'rock', ring: 'far', dist: 41 },
    { at: [8, 26], from: 'house', ring: 'far', dist: 46 },
    { at: [-6, 20], from: 'bus', ring: 'far', dist: 40 },
  ];
  for (const sp of spawnPoints) {
    const s = { ...spawnBehind(sp.at[0], sp.at[1], sp.dist), from: sp.from, ring: sp.ring };
    const v = new THREE.Vector3(s.x, 0, s.z);
    v.ring = s.ring;
    level.zombieSpawns.push(v);
    level.spawnSources.push({ x: s.x, z: s.z, kind: s.from, ring: s.ring });
    // entries double as the "they are coming from here" markers used by
    // the tactical map and the approach warning.
    level.entries.push(new THREE.Vector3(
      BX + (s.x - BX) * 0.45, 0, BZ + (s.z - BZ) * 0.45));
  }

  // ---- The base ----
  const slab = box(g, BASE_SIZE + 0.8, 0.22, BASE_SIZE + 0.8, MATS.concrete, BX, 0, BZ);
  slab.receiveShadow = quality === 'DESKTOP';

  // Perimeter wall, built as segments so it can be broken piece by piece.
  // The corners are solid pillars (a base that loses its corners first
  // looks wrong, and it gives the wall something to hang off).
  const segments = [];
  const pushSeg = (x, z, along) => {
    const s = { x, z, along, hp: SEG_HP, maxHp: SEG_HP, dead: false, index: segments.length };
    const c = {
      x, z,
      hx: along === 'x' ? SEG / 2 : 0.24,
      hz: along === 'x' ? 0.24 : SEG / 2,
      top: WALL_H, tall: false,      // shoot OVER it, do not walk through it
      wallSeg: s.index,
    };
    s.collider = c;
    level.colliders.push(c);
    segments.push(s);
  };
  const n = Math.round(BASE_SIZE / SEG);
  for (let i = 0; i < n; i++) {
    const a = BX - hb + SEG / 2 + i * SEG;
    const b = BZ - hb + SEG / 2 + i * SEG;
    pushSeg(a, BZ - hb, 'x');       // north run
    pushSeg(a, BZ + hb, 'x');       // south run
    pushSeg(BX - hb, b, 'z');       // west run
    pushSeg(BX + hb, b, 'z');       // east run
  }
  for (const [cx, cz] of [[-hb, -hb], [hb, -hb], [-hb, hb], [hb, hb]]) {
    box(g, 0.6, WALL_H + 0.35, 0.6, MATS.metalShell, BX + cx, (WALL_H + 0.35) / 2, BZ + cz);
    level.colliders.push({ x: BX + cx, z: BZ + cz, hx: 0.3, hz: 0.3, top: WALL_H + 0.35, tall: false });
  }
  level.baseWall = new BaseWall(level, g, segments);

  // The base is 8x8 m and everything in it has to earn its footprint, so
  // the interior splits along the west/east line: the lift owns the west
  // side, the firing line owns the east side facing the field.
  //
  // The sketch draws the ramp in the north-west corner. Built literally,
  // its ramp ran straight down the west wall and through the elevator
  // cab, which trapped anyone who walked into the overlap. The firing
  // position therefore sits in the north-EAST corner instead, directly
  // above the sandbags and looking out over the threat side.

  // RAMP 4 SNIPE: raised firing position, ramp running south down the
  // middle of the base.
  // Flush against the north and east walls, and 1.4 m rather than 1.6 so
  // its ramp fits inside the base instead of running into the south wall.
  const px = BX + hb - 1.94, pz = BZ - hb + 1.64;
  platform(level, MATS.planksOld, px, pz, 3.4, 2.8, 1.4, 'south');
  railing(level, MATS.metalDoor, px, pz - 1.4, 3.4, 0.12);
  railing(level, MATS.metalDoor, px + 1.7, pz, 0.12, 2.8);

  // Sandbags along the southern half of the east wall: ground-level cover
  // on the same side, so you can fight the field low or high.
  // Flush against the platform's south edge, so the strip between the
  // ramp and the east wall is filled rather than left as a 0.8 m slot a
  // player can squeeze into and then not get out of.
  for (let i = 0; i < 4; i++) {
    const sz = BZ - hb + 3.32 + i * 1.15;
    box(g, 0.75, SANDBAG_H, 1.05, MATS.sandbag, BX + hb - 0.62, SANDBAG_H / 2, sz);
    level.colliders.push({
      x: BX + hb - 0.62, z: sz, hx: 0.38, hz: 0.52, top: SANDBAG_H, tall: false,
    });
  }

  // Interior cover: the crate from the sketch plus a little junk. All of
  // it stays out of two lanes that must never be blocked: the ramp up to
  // the platform, and the floor in front of the lift doors.
  // Everything near a wall is FLUSH to it. A prop parked 0.8 m off a wall
  // leaves a slot barely wider than the player, which they can walk into
  // and then struggle to walk out of. Flush, or a clear two metres away.
  cover(level, MATS.crate, BX - 3.11, BZ - 3.11, 1.3, 1.3, 1.0);   // NW corner, flush
  cover(level, MATS.crate, BX - 1.9, BZ + 2.2, 0.9, 0.9, 0.75);    // south-west of centre
  cover(level, MATS.sandbag, BX - 3.06, BZ - 0.6, 1.4, 0.7);       // flush to the west wall

  // ---- The elevator plate ----
  // FOUNDATION BUG 5: the lift is part of the base, so its position AND
  // its facing are derived from the base, never chosen independently.
  //
  // It is a plate you stand on with a control post beside it (sketch:
  // ELEVATOR FLOOR W CONTROL PANEL), flush against the west wall in the
  // south-west corner. No cab, no doors, nothing to be shut out of or
  // trapped inside, and you keep your sightlines while you board.
  level.elevator = makeElevator();
  const PW = level.elevator.plateW, PD = level.elevator.plateD;
  const ex = BX - hb + 0.24 + PW / 2;      // flush to the west wall's inner face
  const ez = BZ + hb - 0.24 - PD / 2;      // and to the south wall's
  level.elevator.group.position.set(ex, 0, ez);
  g.add(level.elevator.group);
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

  // ---- Player confinement ----
  // The wall itself is the boundary while it stands. This outer ring only
  // matters once a segment is BREACHED: it keeps the player from strolling
  // out through the hole the horde just made, while staying invisible to
  // the horde itself.
  //
  // It has to sit clear of the wall. Overlapping it created a pocket
  // between the two, where the wall pushed the player one way, the ring
  // pushed them back, and they were pinned in place unable to move at all.
  const ob = hb + 1.2;
  for (const [bx, bz, bw, bd] of [
    [BX, BZ - ob, BASE_SIZE + 3.2, 0.5], [BX, BZ + ob, BASE_SIZE + 3.2, 0.5],
    [BX - ob, BZ, 0.5, BASE_SIZE + 3.2], [BX + ob, BZ, 0.5, BASE_SIZE + 3.2],
  ]) {
    level.colliders.push({
      x: bx, z: bz, hx: bw / 2, hz: bd / 2, tall: false, playerOnly: true, keepIn: true,
    });
  }

  // Explosive barrels: two inside as a risk, three out in the field on the
  // approach lanes as a reward for a good shot at range.
  level.barrels.push({ x: BX - 2.2, z: BZ - 1.6 });   // clear of the ramp lane
  level.barrels.push({ x: 4, z: -18 }, { x: 14, z: 2 }, { x: -14, z: 10 });

  level.heightAt = makeHeightAt(level, 0);
  // The roomscale zone IS the base: walking the base physically is the
  // whole VR experience on a holdout level.
  roomscaleZone(level, BX - 0.2, BZ + 0.4);
  // Spawns cluster in the middle-south of the base: clear of the ramp
  // lane, clear of the lift, and facing the field.
  level.playerSpawns = [
    new THREE.Vector3(BX - 0.5, 0, BZ + 0.5),
    new THREE.Vector3(BX - 1.8, 0, BZ + 1.4),
    new THREE.Vector3(BX + 0.6, 0, BZ + 1.9),
    new THREE.Vector3(BX - 2.2, 0, BZ + 2.6),
    new THREE.Vector3(BX + 1.4, 0, BZ + 0.4),
  ];
}
