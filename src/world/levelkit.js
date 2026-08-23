// ============================================================================
// LEVEL SPEC SCHEMA, PROP LIBRARY AND SPEC RUNNER
// ============================================================================
//
// A level is DATA. One sketch = one file under src/world/levels/, exporting
// one plain object. New builder code is needed ONLY when a sketch calls for a
// prop or a frame that does not exist yet.
//
// THREE LAYERS, never mixed:
//   spec      WHERE and WHICH          (the shape documented below)
//   props     HOW one thing is built   (PROPS, in this file)
//   frame     HOW an archetype works   (holdout.js, later traverse.js)
//   spine     what EVERY level needs   (buildFromSpec, in this file)
//
// DETERMINISM LAW (LESSONS.md): the spec is STATIC. The spine walks
// world.props[] in ARRAY INDEX ORDER handing each prop the shared rng, so
// every rng draw is a pure function of spec order. Never iterate a spec with
// for..in / Object.keys, never derive a spec value from anything peer-local
// (Date, Math.random, window size, CONFIG). The ONE sanctioned peer-local
// read is CONFIG.PLAY_AREA inside roomscaleZone: it sizes a painted marker
// and level.roomZone, never a collider and never the nav grid.
//
// COORDINATE LAW: world.props[], spawns[] and barrels[] are WORLD space.
// Everything under base.* / route.* is FRAME-LOCAL (0,0 = base.at / route.at).
// The spine translates frame-local x/z to world before calling a prop, so
// props are always pure world-space. Frame ROTATION is not supported.
//
// ----------------------------------------------------------------------------
// const SPEC = {
//   // ---- Identity ---------------------------------------------------------
//   id: 'L1',                  // must equal the filename stem
//   name: 'THE FIELD',         // HUD floor name
//   note: 'Nowhere to run.',   // one-line hook, shown on arrival
//   archetype: 'holdout',      // 'holdout' | 'traverse' -> picks the frame
//
//   // ---- The world around the frame ---------------------------------------
//   world: {
//     size: 80,                     // edge to edge; drives mapExtent default
//     waveLabel: 'WAVE',            // HUD: 'WAVE' | 'NIGHT' | 'CONTACT'
//     nextLabel: 'NEXT AREA',       // ride/shop wording; kills "floor N"
//     drone: true,                  // false -> map button says NO SIGNAL
//     ground: { material: 'sandGround', size: 420, y: -0.02 },
//     ceiling: null,                // or { material, height } (traverse)
//     light: {
//       daylight: true,             // "zombies in daylight" law, HUD/phase tint
//       sky: 'daySky', haze: 'dayHaze',   // PALETTE key or raw 0xRRGGBB
//       fogNear: 26, fogFar: 96,          // fogNear must sit PAST the frame
//       sun: 2.4, hemi: 1.0, dark: false, // dark:true auto-enables flashlight
//     },
//     // OPTIONAL. Omit -> deriveNavBounds(). Pin it on any level that has
//     // already shipped, so the grid never silently moves.
//     nav: { minX: -52, maxX: 46, minZ: -52, maxZ: 44 },
//     props: [ { prop: <PROPS key>, id, note, ...PROP_PARAMS } ],
//   },
//
//   // ---- Zombie spawns, WORLD space ---------------------------------------
//   // `from` names the visible source it comes out of. It is fiction in the
//   // debug overlay AND a validator reference: it must match a prop's `id`
//   // or a prop name present in world.props / the frame's interior.
//   spawns: [ { x: 6, z: -40, from: 'ridge' } ],
//   barrels: [ { x: 4, z: -18 } ],     // explosive barrels, WORLD space
//
//   // ---- Exactly ONE frame block, matching `archetype` --------------------
//   base:  { ... },   // holdout, see holdout.js
//   route: { ... },   // traverse, see traverse.js
//
//   after: null,      // (level, ctx) => void, escape hatch, see below
// };
// ----------------------------------------------------------------------------
//
// ESCAPE HATCHES, in preference order:
//   1. Add a prop (~30 lines + a PROP_PARAMS entry). Nine sketches in ten.
//   2. { prop: 'raw', build(level, ctx) {...} } inline in the spec, called in
//      array order with the same ctx. Must register its own colliders. The
//      validator WARNS above one per spec: two means a prop is missing.
//   3. spec.after(level, ctx), run once after the frame and before heightAt.
//      The only place allowed to touch frame output. Used twice -> promote.
//   4. A new archetype, when the frame itself is wrong. Cheaper than bending
//      an existing frame until it breaks.
import * as THREE from 'three';
import { PALETTE, MATS, mat } from './materials.js';
import { box, cover, platform, railing, roomscaleZone, makeHeightAt } from './kit.js';
import { holdoutFrame } from './holdout.js';
import { NavGrid } from '../game/navgrid.js';

// Local-to-world for a prop rotated by `rot` about Y. three's Y rotation
// maps local (lx, lz) to world (lx*cos + lz*sin, -lx*sin + lz*cos); the
// naive 2D rotation has the opposite sign and scatters sub-parts off the
// body they belong to (wheels beside the car, ribs poking out of the
// container). Every rotated prop goes through this.
export function rotXZ(lx, lz, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [lx * c + lz * s, -lx * s + lz * c];
}

// How far past the outermost thing the nav grid reaches when a spec does
// not pin world.nav. A spawn that lands outside the grid can never path in
// and the night ends on "1 LEFT" forever, so err generous.
export const NAV_MARGIN = 10;

// ---- Material / colour resolution ---------------------------------------
// A sketch names a surface, never a THREE object. Three spellings are legal
// and they are tried in this order: a MATS key (a shared textured material),
// a PALETTE key (a named colour), or a raw 0xRRGGBB number.
export function resolveMat(v, rough = 0.9, metal = 0.0) {
  if (typeof v === 'number') return mat(v, rough, metal);
  if (typeof v === 'string') {
    if (Object.prototype.hasOwnProperty.call(MATS, v)) return MATS[v];
    if (Object.prototype.hasOwnProperty.call(PALETTE, v)) return mat(PALETTE[v], rough, metal);
  }
  throw new Error(`levelkit: unknown material "${v}" (not in MATS or PALETTE)`);
}

export function resolveColour(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(PALETTE, v)) return PALETTE[v];
  throw new Error(`levelkit: unknown colour "${v}" (not in PALETTE)`);
}

export function isSurface(v) {
  return typeof v === 'number'
    || (typeof v === 'string' && (Object.prototype.hasOwnProperty.call(MATS, v)
      || Object.prototype.hasOwnProperty.call(PALETTE, v)));
}

export function isColour(v) {
  return typeof v === 'number'
    || (typeof v === 'string' && Object.prototype.hasOwnProperty.call(PALETTE, v));
}

// ============================================================================
// THE PROP LIBRARY
// ============================================================================
// build(level, p, ctx)
//   level  push meshes into level.group, colliders into level.colliders
//   p      the spec entry, defaults already applied, x/z already in WORLD space
//   ctx    { rng, quality, mat, MATS, PALETTE, rotXZ, frame:{x,z,hw,hd} }
//
// Rules for a new prop:
//   1. Deterministic: randomness ONLY from ctx.rng, drawn in a fixed order.
//   2. Register its own colliders. `tall:true` blocks bullets too;
//      shoot-over cover is `top:<h>, tall:false` with top > 0.45.
//   3. Rotate sub-parts with rotXZ, never a hand-rolled 2D rotation.
//   4. Declare params in PROP_PARAMS or the validator rejects the spec.
//   5. Never read the spec, the level index, or any global.

// Marks a parameter that the sketch MUST supply. Anything else in
// PROP_PARAMS is a default and may be left out.
const REQ = Symbol('required');

export const PROPS = {

  // ---- World: sight blockers ---------------------------------------------
  // Sight blockers do two jobs: they hide the spawn behind them, and they
  // break the field up so the approach is readable rather than a flat parade.

  // A flat strip of road. It gives the eye a line into the haze, so it is
  // deliberately not a collider: you never walk on this level anyway.
  road(level, p) {
    const m = resolveMat(p.material, 1.0);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.length), m);
    // rotation.z is applied AFTER rotation.x in three's default XYZ order,
    // so it spins the already-flattened plane in the ground plane. Setting
    // rotation.y instead would tilt the strip on edge.
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = p.rot;
    road.position.set(p.x, 0.01, p.z);
    level.group.add(road);
  },

  // A rolling line of hills, tallest in the middle so it reads as terrain
  // and not as a fence. Blocks sight and bullets.
  ridge(level, p) {
    const g = level.group;
    const m = mat(PALETTE.hills, 1.0);
    const n = Math.max(3, Math.round(p.len / 4));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5;
      const along = t * p.len;
      // A PASS through the ridge. A 34 m wall of hills is a 40 m detour
      // for anything spawning behind it, which is long enough that the
      // pathfinder gives up and the horde drifts instead of arriving. A
      // gap is also better fiction: they funnel through it, in view.
      if (p.gapAt !== null && Math.abs(along - p.gapAt) < p.gapW / 2) continue;
      // A rolling profile, tallest in the middle, so it reads as terrain.
      const h = p.height * (0.45 + 0.55 * Math.cos(t * Math.PI));
      const w = 5.5 + (i % 3) * 1.4;
      const [ox, oz] = rotXZ(along, 0, p.rot);
      const px = p.x + ox, pz = p.z + oz;
      const b = box(g, w, h, w * 0.8, m, px, h / 2 - 0.4, pz, p.rot + i * 0.3);
      b.castShadow = false;
      level.colliders.push({ x: px, z: pz, hx: w * 0.45, hz: w * 0.45, tall: true });
    }
  },


  // One dead tree. This field has no leaves left on anything.
  loneTree(level, p) {
    const g = level.group;
    const { x, z } = p;
    const bark = mat(0x4a3a28, 1.0);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 5.4, 6), bark);
    trunk.position.set(x, 2.7, z);
    g.add(trunk);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05, len = 2.2 - i * 0.15;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, len, 4), bark);
      br.position.set(x + Math.cos(a) * len * 0.35, 3.6 + (i % 3) * 0.6, z + Math.sin(a) * len * 0.35);
      br.rotation.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9 + 0.7);
      g.add(br);
    }
    level.colliders.push({ x, z, hx: 0.5, hz: 0.5, tall: true });
  },

  // Three burnt-out cars in a loose line. RNG: 9 draws, 3 per car, in the
  // order [cx jitter, cz, rotation]. Changing that order moves every car.
  burntCars(level, p, ctx) {
    const g = level.group;
    const rng = ctx.rng;
    const body = mat(0x3a3630, 0.95, 0.25);
    const rust = mat(PALETTE.rust, 1.0);
    for (let i = 0; i < 3; i++) {
      const cx = p.x + (i - 1) * 3.2 + rng.range(-0.8, 0.8);
      const cz = p.z + rng.range(-2.2, 2.2);
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
  },

  // A boulder cluster. Five stones, largest first, so it has a silhouette.
  bigRock(level, p) {
    const g = level.group;
    const m = mat(0x7d766c, 1.0);
    for (let i = 0; i < 5; i++) {
      const s = 2.6 - i * 0.32;
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), m);
      r.position.set(p.x + (i - 2) * 1.9, s * 0.55 - 0.4, p.z + ((i % 2) ? 1.4 : -1.3));
      r.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      g.add(r);
      level.colliders.push({ x: r.position.x, z: r.position.z, hx: s * 0.8, hz: s * 0.8, tall: true });
    }
  },

  // A gutted house: three and a half walls, punched windows, a broken
  // roofline. Big enough to hide a spawn behind and to be a landmark.
  ruinedHouse(level, p) {
    const g = level.group;
    const { x, z } = p, rot = p.rot;
    const W = 11, D = 8, H = 5.2;
    const m = MATS.plaster;
    const put = (lx, lz, lw, ld, h, y = h / 2) => {
      const [ox, oz] = rotXZ(lx, lz, rot);
      const wx = x + ox, wz = z + oz;
      box(g, lw, h, ld, m, wx, y, wz, rot);
      // An axis-aligned collider cannot be rotated, so past 30 degrees the
      // footprint is swapped rather than left pointing the wrong way.
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
    for (let i = 0; i < 5; i++) {
      const [ox, oz] = rotXZ((i - 2) * 2.2, 0, rot);
      box(g, 2.0, 0.4 + (i % 2) * 0.5, D * 0.9, m, x + ox, H + 0.2, z + oz, rot);
    }
  },

  // A far ring of city silhouettes. They must sit LOW, inside the horizon
  // haze band: tall towers past the fog read as white paper cut-outs
  // against blue sky, which is worse than no skyline at all.
  // RNG: 4 draws per building, in the order [angle, radius, height, width].
  // Always centred on the WORLD origin, never on the frame: it is the
  // horizon, and a horizon that follows the base looks like a stage set.
  // A mound of rubble and concrete pipes. CLOSE-IN cover: big enough to
  // hide a body walking out from behind it, small enough not to wall off
  // the base's sightlines. This is what the near spawn ring comes out of.
  pipeMound(level, p) {
    const g = level.group;
    const stone = mat(0x8a8378, 1.0);
    const pipe = mat(0x9d968b, 0.9);
    for (let i = 0; i < 4; i++) {
      const [ox, oz] = rotXZ((i - 1.5) * 1.35, (i % 2) ? 0.5 : -0.5, p.rot);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.6, 10, 1, true), pipe);
      c.position.set(p.x + ox, 0.62, p.z + oz);
      c.rotation.set(Math.PI / 2, 0, p.rot + (i % 2) * 0.2);
      g.add(c);
      level.colliders.push({ x: p.x + ox, z: p.z + oz, hx: 1.3, hz: 0.65, tall: true });
    }
    for (let i = 0; i < 5; i++) {
      const [ox, oz] = rotXZ((i - 2) * 1.1, 1.9 + (i % 2) * 0.6, p.rot);
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55 + (i % 3) * 0.2, 0), stone);
      r.position.set(p.x + ox, 0.35, p.z + oz);
      r.rotation.set(i, i * 1.4, i * 0.6);
      g.add(r);
      level.colliders.push({ x: p.x + ox, z: p.z + oz, hx: 0.7, hz: 0.7, tall: true });
    }
  },

  skyline(level, p, ctx) {
    const rng = ctx.rng;
    const m = mat(0x3f4450, 1.0);
    for (let i = 0; i < p.count; i++) {
      // A tiny angular wobble so the ring is not a clock face. Baked: the
      // number is invisible at this distance and a param would be noise.
      const a = (i / p.count) * Math.PI * 2 + rng.range(-0.06, 0.06);
      const r = p.radius + rng.range(p.jitter[0], p.jitter[1]);
      const h = rng.range(p.h[0], p.h[1]);
      const w = rng.range(p.w[0], p.w[1]);
      const b = box(level.group, w, h, w * 0.8, m, Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r, a);
      b.castShadow = false;
    }
  },

  // ---- World: mid-ground -------------------------------------------------
  // The gap between the frame and the far sight blockers is where the fight
  // actually happens, and an empty plain there is boredom. These props give
  // the approach texture, scale, and the landmarks a player calls out when
  // directing the drone.

  // A run of motorway barrier, with sections knocked flat: it is a filter
  // that slows the horde down, not a wall that stops it.
  crashBarrier(level, p) {
    const g = level.group;
    const m = mat(0x8e8a82, 1.0);
    const n = Math.round(p.len / 2.2);
    for (let i = 0; i < n; i++) {
      const [ox, oz] = rotXZ((i - (n - 1) / 2) * 2.2, 0, p.rot);
      const px = p.x + ox, pz = p.z + oz;
      const down = (i * 7 + 3) % 5 === 0;
      if (down) {
        box(g, 2.0, 0.22, 0.9, m, px, 0.11, pz, p.rot + 0.4);
        continue;
      }
      box(g, 2.0, 0.85, 0.42, m, px, 0.42, pz, p.rot);
      level.colliders.push({
        x: px, z: pz,
        hx: Math.abs(Math.cos(p.rot)) > 0.5 ? 1.0 : 0.25,
        hz: Math.abs(Math.cos(p.rot)) > 0.5 ? 0.25 : 1.0,
        top: 0.85, tall: false,
      });
    }
  },

  // A shipping container. Ribbed ends so it reads as a container and not
  // as a coloured brick.
  container(level, p) {
    const g = level.group;
    const colour = resolveColour(p.colour);
    const m = mat(colour, 0.85, 0.2);
    const W = 6.0, H = 2.6, D = 2.44;
    box(g, W, H, D, m, p.x, H / 2, p.z, p.rot);
    for (let i = 0; i < 5; i++) {
      const [ox, oz] = rotXZ((i - 2) * (W / 5.4), 0, p.rot);
      box(g, 0.14, H - 0.2, D + 0.06, mat(colour, 0.9, 0.2), p.x + ox, H / 2, p.z + oz, p.rot);
    }
    const swap = Math.abs(Math.sin(p.rot)) > 0.5;
    level.colliders.push({
      x: p.x, z: p.z, hx: (swap ? D : W) / 2, hz: (swap ? W : D) / 2, tall: true,
    });
  },

  // A line of leaning power pylons marching across the field: the cheapest
  // way to make 40 m of open ground read as distance rather than as fog.
  pylons(level, p) {
    const g = level.group;
    const m = mat(0x5a4c3a, 1.0);
    for (let i = 0; i < p.count; i++) {
      const px = p.x + p.dx * i, pz = p.z + p.dz * i;
      const lean = ((i * 5) % 7) * 0.03;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 7.0, 6), m);
      pole.position.set(px, 3.4, pz);
      pole.rotation.z = lean;
      g.add(pole);
      box(g, 2.4, 0.16, 0.16, m, px, 6.3, pz, Math.atan2(p.dz, p.dx) + Math.PI / 2);
      level.colliders.push({ x: px, z: pz, hx: 0.3, hz: 0.3, tall: true });
    }
  },

  busWreck(level, p) {
    const g = level.group;
    const body = mat(0x5a5347, 0.9, 0.2);
    box(g, 9.5, 2.5, 2.5, body, p.x, 1.35, p.z, p.rot);
    box(g, 9.0, 0.5, 2.2, mat(0x241f19, 1.0), p.x, 2.1, p.z, p.rot);      // burnt roof line
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const [ox, oz] = rotXZ((i - 1.5) * 2.4, side * 1.25, p.rot);
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 8), mat(0x1d1b18, 1.0));
        w.position.set(p.x + ox, 0.5, p.z + oz);
        w.rotation.z = Math.PI / 2;
        w.rotation.y = p.rot;
        g.add(w);
      }
    }
    const swap = Math.abs(Math.sin(p.rot)) > 0.5;
    level.colliders.push({
      x: p.x, z: p.z, hx: (swap ? 2.5 : 9.5) / 2, hz: (swap ? 9.5 : 2.5) / 2, tall: true,
    });
  },

  // Scrub and debris scattered in a ring: nothing to hide behind, but the
  // ground stops being a flat plane and distances become readable.
  // Deliberately collider-free, so it never becomes a trap you get pinned on.
  // RNG: 3 draws per piece, in the order [angle, radius, size].
  scatter(level, p, ctx) {
    const rng = ctx.rng;
    const c = p.around === 'frame' ? ctx.frame : p.around;
    const colour = resolveColour(p.colour);
    for (let i = 0; i < p.count; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(p.minR, p.maxR);
      const px = c.x + Math.cos(a) * r, pz = c.z + Math.sin(a) * r;
      const s = rng.range(p.size[0], p.size[1]);
      const d = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat(colour, 1.0));
      d.position.set(px, s * 0.35 - 0.1, pz);
      d.rotation.set(i, i * 0.7, i * 1.9);
      level.group.add(d);
    }
  },

  // ---- Interior / shared -------------------------------------------------

  // A raised firing position with a ramp. `ramp` names the side the ramp
  // runs off; it needs height*3.2 metres of clear floor on that side.
  platform(level, p) {
    platform(level, resolveMat(p.material), p.x, p.z, p.w, p.d, p.height, p.ramp);
  },

  // Visual edge for a platform. Never a collider: a railing you cannot
  // shoot over is a wall, and a wall up there kills the whole position.
  railing(level, p) {
    railing(level, resolveMat(p.material), p.x, p.z, p.w, p.d);
  },

  // Chest-high cover: blocks walking, not shooting.
  cover(level, p) {
    cover(level, resolveMat(p.material), p.x, p.z, p.w, p.d, p.height);
  },

  // A run of sandbags: rest a barrel on it, do not hide behind it.
  // hx/hz default to half the box but may be pinned, because the shipped
  // L1 run uses hand-tuned half-extents and this migration must not move
  // a single collider (see docs/level-design.md, "the spec migration").
  sandbags(level, p) {
    const m = resolveMat(p.material);
    const hx = p.hx === null ? p.w / 2 : p.hx;
    const hz = p.hz === null ? p.d / 2 : p.hz;
    for (let i = 0; i < p.count; i++) {
      const sx = p.along === 'x' ? p.x + i * p.step : p.x;
      const sz = p.along === 'x' ? p.z : p.z + i * p.step;
      box(level.group, p.w, p.height, p.d, m, sx, p.height / 2, sz);
      level.colliders.push({ x: sx, z: sz, hx, hz, top: p.height, tall: false });
    }
  },
};

// THE SKETCH VOCABULARY. Every parameter a spec may name, with its default.
// REQ means the sketch must supply it. A key that is not here is rejected by
// validateSpec, so a typo is a hard error and never a silently ignored value.
export const PROP_PARAMS = {
  // world props
  road: { x: REQ, z: REQ, width: 8, length: 420, rot: 0, material: 'road' },
  ridge: { x: REQ, z: REQ, len: REQ, height: REQ, rot: 0, gapAt: null, gapW: 6 },
  loneTree: { x: REQ, z: REQ },
  bigRock: { x: REQ, z: REQ },
  burntCars: { x: REQ, z: REQ },
  ruinedHouse: { x: REQ, z: REQ, rot: 0 },
  container: { x: REQ, z: REQ, rot: 0, colour: REQ },
  crashBarrier: { x: REQ, z: REQ, len: REQ, rot: 0 },
  pylons: { x: REQ, z: REQ, dx: REQ, dz: REQ, count: REQ },
  busWreck: { x: REQ, z: REQ, rot: 0 },
  pipeMound: { x: REQ, z: REQ, rot: 0 },
  skyline: { count: 30, radius: 108, jitter: [-14, 26], h: [8, 22], w: [10, 24] },
  scatter: {
    count: REQ, around: 'frame', minR: REQ, maxR: REQ,
    size: [0.35, 1.1], colour: 0x8b8070,
  },
  // interior / shared
  platform: { x: REQ, z: REQ, w: REQ, d: REQ, height: REQ, ramp: 'south', material: 'planksOld' },
  railing: { x: REQ, z: REQ, w: REQ, d: REQ, material: 'metalDoor' },
  cover: { x: REQ, z: REQ, w: REQ, d: REQ, height: 1.05, material: 'crate' },
  sandbags: {
    x: REQ, z: REQ, count: REQ, step: REQ, w: REQ, d: REQ,
    height: 0.8, along: 'z', material: 'sandbag', hx: null, hz: null,
  },
};

// Keys every prop entry may carry regardless of type.
const UNIVERSAL_KEYS = ['prop', 'id', 'note'];
// Params that name a surface (MATS key, PALETTE key or 0xRRGGBB).
const SURFACE_KEYS = ['material', 'floor'];
// Params that name a colour (PALETTE key or 0xRRGGBB).
const COLOUR_KEYS = ['colour', 'sky', 'haze'];

// Apply defaults without ever mutating the spec. Specs are module-level
// constants that get built once per peer per floor visit, so a prop that
// wrote back into its entry would corrupt the second visit.
function defaulted(p) {
  const params = PROP_PARAMS[p.prop];
  const out = { prop: p.prop };
  if (p.id !== undefined) out.id = p.id;
  for (const k of Object.keys(params)) {
    out[k] = p[k] !== undefined ? p[k] : params[k];
  }
  return out;
}

// ============================================================================
// VALIDATION
// ============================================================================
// Fail loudly, never subtly wrong. A spec error is a programming error in a
// sketch, it is identical on every peer, and it must stop the build rather
// than produce a level that is quietly missing a wall.
export function validateSpec(spec) {
  const err = [];
  const warn = [];
  const where = spec && spec.id ? spec.id : '<spec>';
  const E = (m) => err.push(`${where}: ${m}`);

  if (!spec || typeof spec !== 'object') throw new Error('levelkit: spec is not an object');
  if (!['holdout', 'traverse'].includes(spec.archetype)) E(`unknown archetype "${spec.archetype}"`);
  const hasBase = !!spec.base, hasRoute = !!spec.route;
  if (hasBase && hasRoute) E('has both base and route; a level has exactly one frame');
  if (!hasBase && !hasRoute) E('has neither base nor route; a level needs one frame');
  if (spec.archetype === 'holdout' && !hasBase) E('archetype holdout needs a `base` block');
  if (spec.archetype === 'traverse' && !hasRoute) E('archetype traverse needs a `route` block');

  const w = spec.world || {};
  if (!w.light) E('world.light is missing');
  else {
    for (const k of COLOUR_KEYS) {
      if (w.light[k] !== undefined && !isColour(w.light[k])) E(`world.light.${k} = "${w.light[k]}" is not a PALETTE key or a colour`);
    }
  }
  if (w.ground && !isSurface(w.ground.material)) E(`world.ground.material = "${w.ground.material}" is not a MATS/PALETTE key`);
  if (w.ceiling && !isSurface(w.ceiling.material)) E(`world.ceiling.material = "${w.ceiling.material}" is not a MATS/PALETTE key`);

  // ---- Props: names, params, materials, `raw` budget --------------------
  let rawCount = 0;
  const names = new Set();     // everything a spawn.from may point at
  const checkProps = (list, label, bounds) => {
    for (let i = 0; i < (list || []).length; i++) {
      const p = list[i];
      const at = `${label}[${i}]`;
      if (!p || typeof p !== 'object') { E(`${at} is not an object`); continue; }
      if (p.id) names.add(p.id);
      if (p.prop === 'raw') {
        rawCount++;
        if (typeof p.build !== 'function') E(`${at} is a raw prop with no build()`);
        continue;
      }
      const params = PROP_PARAMS[p.prop];
      if (!params) { E(`${at} names unknown prop "${p.prop}"`); continue; }
      names.add(p.prop);
      for (const k of Object.keys(p)) {
        if (UNIVERSAL_KEYS.includes(k)) continue;
        if (!Object.prototype.hasOwnProperty.call(params, k)) {
          E(`${at} (${p.prop}) has unknown parameter "${k}"`);
        }
      }
      for (const k of Object.keys(params)) {
        if (params[k] === REQ && p[k] === undefined) E(`${at} (${p.prop}) is missing required "${k}"`);
      }
      for (const k of SURFACE_KEYS) {
        if (p[k] !== undefined && !isSurface(p[k])) E(`${at} (${p.prop}) ${k} = "${p[k]}" is not a MATS/PALETTE key`);
      }
      for (const k of COLOUR_KEYS) {
        if (p[k] !== undefined && !isColour(p[k])) E(`${at} (${p.prop}) ${k} = "${p[k]}" is not a colour`);
      }
      // A collider with top exactly 0 is invisible to heightAt and to the
      // step-up rule, so it becomes a solid nobody can see or climb.
      if (p.height === 0) E(`${at} (${p.prop}) has height 0`);
      // Frame-local props must stay inside the frame footprint. Anything
      // that pokes out sits where the horde walks and the player cannot.
      if (bounds && p.x !== undefined && p.z !== undefined) {
        const hw = (p.w !== undefined ? p.w : 0) / 2;
        const hd = (p.d !== undefined ? p.d : 0) / 2;
        const runX = p.along === 'x' && p.count ? (p.count - 1) * p.step : 0;
        const runZ = p.along !== 'x' && p.count && p.step ? (p.count - 1) * p.step : 0;
        if (p.x - hw < -bounds.hw || p.x + hw + runX > bounds.hw
          || p.z - hd < -bounds.hd || p.z + hd + runZ > bounds.hd) {
          E(`${at} (${p.prop}) sticks out of the frame footprint`);
        }
      }
    }
  };
  checkProps(w.props, 'world.props', null);

  const frame = spec.base || spec.route || {};
  const fw = spec.base ? spec.base.size / 2 : (spec.route.size ? spec.route.size.w / 2 : 0);
  const fd = spec.base ? spec.base.size / 2 : (spec.route.size ? spec.route.size.d / 2 : 0);
  checkProps(frame.interior, spec.base ? 'base.interior' : 'route.interior', { hw: fw, hd: fd });

  if (rawCount > 1) warn.push(`${where}: ${rawCount} raw props. Two means a prop is missing from PROPS.`);

  // ---- Holdout frame rules ----------------------------------------------
  if (spec.base) {
    const b = spec.base;
    if (b.wall && b.wall.openings && b.wall.openings.length) {
      E('base.wall.openings is not implemented; leave it empty');
    }
    if (!b.at) E('base.at is missing');
    // "You see them coming" is the whole archetype. A close spawn turns
    // the long approach through the haze into a jump scare.
    for (const s of (spec.spawns || [])) {
      const d = Math.hypot(s.x - b.at.x, s.z - b.at.z);
      if (d < 25) E(`spawn at ${s.x},${s.z} is only ${d.toFixed(1)} m from the base (holdout minimum is 25 m)`);
    }
    if (b.wall && b.wall.height !== undefined && b.wall.height === 0) E('base.wall.height is 0');
  }

  // ---- Traverse frame rules (the frame itself lands in step 2) ----------
  if (spec.route) {
    const r = spec.route;
    const ids = new Set();
    for (const d of (r.doors || [])) {
      if (ids.has(`door:${d.id}`)) E(`duplicate door id "${d.id}"`);
      ids.add(`door:${d.id}`);
    }
    for (const t of (r.triggers || [])) {
      if (ids.has(`trigger:${t.id}`)) E(`duplicate trigger id "${t.id}"`);
      ids.add(`trigger:${t.id}`);
    }
    for (const h of (r.shell && r.shell.holes) || []) if (h.id) names.add(h.id);
    for (const req of (r.objective && r.objective.requires) || []) {
      if (!ids.has(req)) E(`objective.requires names "${req}", which does not exist`);
    }
  }

  // ---- Spawns must come out of something you can SEE --------------------
  for (const s of (spec.spawns || [])) {
    if (!s.from) E(`spawn at ${s.x},${s.z} has no \`from\``);
    else if (!names.has(s.from)) E(`spawn \`from: '${s.from}'\` matches no prop id or prop name`);
  }

  // fogNear must sit past the frame, or the base itself goes hazy and the
  // level reads as a fog bank rather than as a place.
  if (w.light && w.light.fogNear !== undefined) {
    const far = Math.max(fw, fd);
    if (w.light.fogNear < far) warn.push(`${where}: fogNear ${w.light.fogNear} is inside the frame (half-size ${far})`);
  }

  for (const m of warn) console.warn(m);
  if (err.length) throw new Error(`levelkit: invalid spec\n  ${err.join('\n  ')}`);
}

// ============================================================================
// NAV BOUNDS
// ============================================================================
// The bounding box of everything an agent has to be able to stand on:
// the frame footprint, every zombie spawn, every player spawn. Inflated by
// NAV_MARGIN so a spawn on the very edge still has free cells around it.
//
// A shipped level should PIN world.nav instead, so that adding one prop can
// never silently move the grid under a level that was already tuned.
// A spawn must be clearly BEYOND the thing it hides behind. Landing on the
// blocker means landing inside it, and a zombie born inside a prop cannot
// path out: one unreachable enemy leaves the wave counter stuck and the
// level unwinnable. This is a spec error, identical on every peer, so it
// stops the build loudly rather than shipping a level that cannot be won.
const RING_BANDS = { near: [11, 17], mid: [22, 30], far: [38, 999] };
const MIN_BEYOND = 3.5;      // metres past the blocker's centre

export function validateSpawns(spec) {
  const err = [];
  const frame = spec.base || spec.route;
  if (!frame || !frame.at) return err;
  const ax = frame.at.x, az = frame.at.z;
  const props = (spec.world && spec.world.props) || [];
  for (let i = 0; i < (spec.spawns || []).length; i++) {
    const s = spec.spawns[i];
    const at = `${spec.id}: spawns[${i}] (from "${s.from}")`;
    if (!s.behind) {
      if (typeof s.x !== 'number' || typeof s.z !== 'number') {
        err.push(`${at} has neither behind[] nor x/z`);
      }
      continue;
    }
    const bd = Math.hypot(s.behind[0] - ax, s.behind[1] - az);
    if (typeof s.dist !== 'number') {
      err.push(`${at} has behind[] but no dist`);
    } else if (s.dist < bd + MIN_BEYOND) {
      err.push(`${at} sits ${(s.dist - bd).toFixed(1)} m past its blocker, `
        + `which is inside it. Blocker is ${bd.toFixed(1)} m out, so dist must be `
        + `at least ${(bd + MIN_BEYOND).toFixed(1)}.`);
    }
    if (s.ring) {
      const band = RING_BANDS[s.ring];
      if (!band) err.push(`${at} has unknown ring "${s.ring}"`);
      else if (s.dist < band[0] || s.dist > band[1]) {
        err.push(`${at} is in ring "${s.ring}" but sits at ${s.dist} m, `
          + `outside the ${band[0]}-${band[1]} m band for that ring`);
      }
    }
    // The blocker should actually be a prop in this level, or the spawn is
    // hiding behind nothing.
    const near = props.some((p) => typeof p.x === 'number'
      && Math.hypot(p.x - s.behind[0], p.z - s.behind[1]) < 0.6);
    if (!near) err.push(`${at} references a blocker at ${s.behind} with no prop there`);
  }
  return err;
}

export function deriveNavBounds(level) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const take = (x, z) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  const pz = level.playZone;
  if (pz) { take(pz.x - pz.hx, pz.z - pz.hz); take(pz.x + pz.hx, pz.z + pz.hz); }
  for (const s of level.zombieSpawns) take(s.x, s.z);
  for (const s of level.playerSpawns) take(s.x, s.z);
  if (!Number.isFinite(minX)) return { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  return {
    minX: minX - NAV_MARGIN, maxX: maxX + NAV_MARGIN,
    minZ: minZ - NAV_MARGIN, maxZ: maxZ + NAV_MARGIN,
  };
}

// The frames a spec may name. A new archetype registers here and nowhere
// else; buildFromSpec never spells out an archetype name.
const FRAMES = {
  holdout: holdoutFrame,
};

// ============================================================================
// THE SPINE
// ============================================================================
// What EVERY level needs, in the one order that works. The sequencing is not
// cosmetic:
//   - props run before the frame, so the rng order is "field first, base
//     second" exactly as the hand-written holdout drew it
//   - spawns run after the frame, because entries are measured from the
//     frame's centre and the frame is what publishes it
//   - heightAt is built LAST, after every collider and every ramp exists,
//     or a platform placed after it is invisible to the ground sampler
//   - roomscaleZone runs after heightAt because it is a painted marker with
//     no collider, and it must not be able to influence anything above it
export function buildFromSpec(level, spec, { rng, quality, makeElevator }) {
  validateSpec(spec);
  const spawnErrors = validateSpawns(spec);
  if (spawnErrors.length) {
    throw new Error(`levelkit: ${spawnErrors.length} spawn error(s)\n  ` + spawnErrors.join('\n  '));
  }

  const w = spec.world;
  const frameSpec = spec.base || spec.route;
  const at = frameSpec.at;
  const hw = spec.base ? spec.base.size / 2 : spec.route.size.w / 2;
  const hd = spec.base ? spec.base.size / 2 : spec.route.size.d / 2;

  // ---- 2. Identity ----
  level.archetype = spec.archetype;
  level.name = spec.name;
  level.note = spec.note || null;
  level.waveLabel = w.waveLabel || 'WAVE';
  level.nextLabel = w.nextLabel || null;
  level.mapExtent = w.mapExtent !== undefined ? w.mapExtent : w.size * 0.62;
  level.droneAllowed = w.drone !== false;
  level.floorY = 0;
  level.baseY = 0;

  // ---- 3. Light ----
  const L = w.light;
  level.lighting = {
    daySky: resolveColour(L.sky), dayHaze: resolveColour(L.haze),
    fogNear: L.fogNear, fogFar: L.fogFar,
    sunDay: L.sun, hemiDay: L.hemi, dark: !!L.dark,
  };
  level.daylight = !!L.daylight;

  // ---- The prop context ----
  // `frame` is published BEFORE the frame is built, because world props
  // (scatter) are laid out around it and they run first.
  const ctx = {
    rng, quality, mat, MATS, PALETTE, rotXZ,
    frame: { x: at.x, z: at.z, hw, hd },
    // Build a list of frame-local props: the spine owns the local-to-world
    // translation so that props themselves stay pure world-space, and so
    // that a frame never has to import the prop registry (which would make
    // levelkit and the frames a module cycle).
    buildProps(list, ox = at.x, oz = at.z) {
      for (const p of (list || [])) {
        if (p.prop === 'raw') { p.build(level, ctx); continue; }
        const d = defaulted(p);
        d.x += ox;
        d.z += oz;
        PROPS[d.prop](level, d, ctx);
      }
    },
  };

  // ---- 4. Ground and ceiling ----
  if (w.ground) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w.ground.size, w.ground.size), resolveMat(w.ground.material, 1.0));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = w.ground.y !== undefined ? w.ground.y : -0.02;
    ground.receiveShadow = quality === 'DESKTOP';
    level.group.add(ground);
  }
  if (w.ceiling) {
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(w.ground ? w.ground.size : w.size, w.ground ? w.ground.size : w.size),
      resolveMat(w.ceiling.material, 1.0));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = w.ceiling.height;
    // The map needs to know it can look straight through this, and the
    // merger needs to know it is static.
    ceil.userData.ceiling = true;
    level.group.add(ceil);
  }

  // ---- 5. World props, ARRAY INDEX ORDER (the rng contract) ----
  ctx.buildProps(w.props, 0, 0);

  // ---- 6. The frame ----
  FRAMES[spec.archetype](level, spec, ctx, { makeElevator, quality });

  // ---- 7. Spawns, one record -> three parallel arrays ----
  // zombieSpawns[i], spawnSources[i] and entries[i] are indexed together by
  // the sim and the tactical map. Building them from one array of records
  // is what makes that contract structural instead of a convention.
  const anchor = level.baseCentre || (level.pocketAnchors && level.pocketAnchors[0]) || { x: at.x, z: at.z };
  for (const raw of (spec.spawns || [])) {
    // A spawn is normally described by the thing it hides BEHIND plus how
    // far out it sits, and the position is derived: put it on the
    // anchor-to-blocker ray at that distance. It is therefore always
    // hidden and always in its ring, which typed coordinates stop being
    // the moment a prop moves. `x`/`z` remain available for the rare
    // spawn that has no blocker to reference.
    const s = { ...raw };
    if (s.behind) {
      const dx = s.behind[0] - anchor.x, dz = s.behind[1] - anchor.z;
      const d = Math.hypot(dx, dz) || 1;
      s.x = anchor.x + (dx / d) * s.dist;
      s.z = anchor.z + (dz / d) * s.dist;
    }
    const v = new THREE.Vector3(s.x, 0, s.z);
    v.ring = s.ring || null;
    level.zombieSpawns.push(v);
    level.spawnSources.push({ x: s.x, z: s.z, kind: s.from, ring: s.ring || null });
    // entries double as the "they are coming from here" markers used by
    // the tactical map and the approach warning: halfway in, so the arrow
    // points at a direction rather than at the horizon.
    level.entries.push(new THREE.Vector3(
      anchor.x + (s.x - anchor.x) * 0.45, 0, anchor.z + (s.z - anchor.z) * 0.45));
  }

  // ---- 8. Barrels ----
  // Frame barrels FIRST. Barrel ids are derived from array position when the
  // sim seeds them, so this order is protocol surface and is pinned to what
  // the hand-written holdout produced.
  for (const b of (frameSpec.barrels || [])) level.barrels.push({ x: at.x + b.x, z: at.z + b.z });
  for (const b of (spec.barrels || [])) level.barrels.push({ x: b.x, z: b.z });

  // ---- 9. The escape hatch ----
  if (spec.after) spec.after(level, ctx);

  // ---- 10. Nav bounds ----
  level.navBounds = w.nav ? { ...w.nav } : deriveNavBounds(level);

  // ---- 11. Ground sampling, after every collider and ramp exists ----
  level.heightAt = makeHeightAt(level, level.baseY);

  // ---- 12. The roomscale marker ----
  const r = frameSpec.roomscale;
  if (r) roomscaleZone(level, at.x + r.x, at.z + r.z, r.size);

  // ---- 13. Prove the level is playable, or refuse to ship it ----
  assertPlayable(level, spec);
}

// The checks that can only run once the geometry exists. A spec can look
// perfectly reasonable and still describe an unplayable level: a spawn
// that lands inside a prop it was not aiming at, or a lift with a crate
// parked in front of it. Both have shipped. Both are the same on every
// peer, so they are programming errors and they stop the build.
function assertPlayable(level, spec) {
  const err = [];
  const nav = new NavGrid(level.navBounds, 0.6);
  nav.build(level.colliders, 0.4);

  // Every spawn must have a ROUTE to the squad, and reachability is a
  // flood fill rather than a pathfinding query on purpose: A* runs on a
  // node budget and a long way round can exhaust it, which would report a
  // perfectly good route as a wall. The flood is exact.
  // The frame publishes where the horde is actually trying to reach. On a
  // holdout that is the outside of the wall, because the inside is sealed
  // until they break it; on a route level it is where the squad starts.
  const anchor = level.hordeAnchor
    || (level.playerSpawns[0] ? { x: level.playerSpawns[0].x, z: level.playerSpawns[0].z } : null);
  const reach = anchor ? nav.reachableFrom(anchor.x, anchor.z) : null;

  // Every spawn must be on open ground. A small nudge is normal (the grid
  // is coarse); a large one means the author put it inside something.
  for (let i = 0; i < level.zombieSpawns.length; i++) {
    const sp = level.zombieSpawns[i];
    const src = level.spawnSources[i] || {};
    const [cx, cz] = nav.nearestFree(sp.x, sp.z);
    const moved = Math.hypot(nav.worldX(cx) - sp.x, nav.worldZ(cz) - sp.z);
    if (moved > 2.0) {
      err.push(`spawn ${i} ("${src.kind}") at ${sp.x.toFixed(1)},${sp.z.toFixed(1)} `
        + `is ${moved.toFixed(1)} m inside a prop. It is meant to be BEHIND cover, `
        + `not in it: move the blocker, or push the spawn further out.`);
    } else if (reach && !reach[nav.idx(cx, cz)]) {
      err.push(`spawn ${i} ("${src.kind}") at ${sp.x.toFixed(1)},${sp.z.toFixed(1)} `
        + `has NO route to the squad. Anything spawning there can never be `
        + `killed, so the wave counter sticks and the level cannot be won. `
        + `Open a way round, or move the spawn.`);
    }
  }

  // Nothing may stand in front of the lift. A crate there ends the run,
  // because boarding is the only way off the level.
  const zone = level.elevatorZone;
  if (zone) {
    const area = 4 * zone.hx * zone.hz;
    for (const c of level.colliders) {
      if (c.playerOnly || c.walkable || c.dead) continue;
      if (!(c.tall || (c.top !== undefined && c.top > 0.45))) continue;
      const ox = Math.min(c.x + c.hx, zone.x + zone.hx) - Math.max(c.x - c.hx, zone.x - zone.hx);
      const oz = Math.min(c.z + c.hz, zone.z + zone.hz) - Math.max(c.z - c.hz, zone.z - zone.hz);
      if (ox > 0.05 && oz > 0.05 && (ox * oz) / area > 0.12) {
        err.push(`a solid at ${c.x.toFixed(1)},${c.z.toFixed(1)} covers `
          + `${Math.round((ox * oz) / area * 100)}% of the lift's boarding zone`);
      }
    }
  }

  if (err.length) {
    throw new Error(`levelkit: ${spec.id} is not playable\n  ` + err.join('\n  '));
  }
}
