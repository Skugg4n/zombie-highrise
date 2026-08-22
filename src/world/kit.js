// Architecture kit: the reusable pieces every level is assembled from.
//
// THE RULE (learned from playtest): the physical play area constrains ONLY
// where a roomscale VR player may walk. It NEVER constrains the level.
// Levels are large, open and multi-route for everyone; the roomscale zone
// is a marked patch of floor inside them. "Shoot far, walk near."
//
// Everything here pushes colliders into level.colliders and meshes into
// level.group, so the static merger can bake them into few draw calls.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Interior levels are this big regardless of the chosen play area.
export const LEVEL_SIZE = 34;

// ---- Primitives ---------------------------------------------------------

// BoxGeometry UV scaling so one texture keeps ONE world-space scale.
export function scaleBoxUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const uw = Math.max(faceDims[f][0], 0.5), vh = Math.max(faceDims[f][1], 0.5);
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * uw * 0.5, uv.getY(i) * vh * 0.5);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function box(group, w, h, d, material, x, y, z, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (material.map) scaleBoxUVs(geo, w, h, d);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  group.add(m);
  return m;
}

// A wall segment that blocks movement AND bullets.
export function wall(level, mat, x, z, w, d, h = 3.0, y = null) {
  box(level.group, w, h, d, mat, x, y === null ? h / 2 : y, z);
  level.colliders.push({ x, z, hx: w / 2, hz: d / 2, tall: true });
}

// Chest-high cover: blocks walking, NOT shooting. The heart of a good
// firefight: something to duck behind that you can still shoot over.
export function cover(level, mat, x, z, w, d, h = 1.05) {
  box(level.group, w, h, d, mat, x, h / 2, z);
  level.colliders.push({ x, z, hx: w / 2, hz: d / 2, tall: false });
}

// A raised platform with a ramp: verticality without stair collision pain.
// Returns the platform top height.
export function platform(level, mat, x, z, w, d, height, rampDir = 'south') {
  box(level.group, w, height, d, mat, x, height / 2, z);
  level.colliders.push({ x, z, hx: w / 2, hz: d / 2, tall: false, top: height });
  // Ramp: a shallow wedge of stacked slabs (cheap, walkable via heightAt).
  const rampLen = height * 3.2;
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    const hh = height * (1 - f);
    const off = (d / 2) + rampLen * f;
    const sx = rampDir === 'east' ? x + off : rampDir === 'west' ? x - off : x;
    const sz = rampDir === 'south' ? z + off : rampDir === 'north' ? z - off : z;
    const sw = rampDir === 'south' || rampDir === 'north' ? w * 0.55 : rampLen / steps + 0.05;
    const sd = rampDir === 'south' || rampDir === 'north' ? rampLen / steps + 0.05 : w * 0.55;
    box(level.group, sw, hh, sd, mat, sx, hh / 2, sz);
    level.ramps.push({ x: sx, z: sz, hx: sw / 2, hz: sd / 2, top: hh });
  }
  return height;
}

// Railing along a platform edge (readable, does not block shooting).
export function railing(level, mat, x, z, w, d) {
  box(level.group, w, 0.9, d, mat, x, 1.4, z);
}

// An invisible barrier that stops PLAYERS but not zombies. Used where an
// opening has to stay open for the horde but must not let the player walk
// off into nothing (playtest: "openings that only let you walk OUT").
export function playerBarrier(level, x, z, w, d) {
  level.colliders.push({ x, z, hx: w / 2, hz: d / 2, tall: false, playerOnly: true });
}

// ---- Spawn sources ------------------------------------------------------
// PLAYTEST RULE: never spawn enemies out of thin air. Every spawn point
// gets a visible, fiction-carrying source the player can see and read.

// A stairwell head: a dark opening with a frame and steps going down out
// of sight. Zombies climb out of it.
export function stairwell(level, matWall, matDark, x, z, facing = 0) {
  const g = level.group;
  const W = 2.4, D = 2.6;
  const sin = Math.sin(facing), cos = Math.cos(facing);
  // Three walls of the stair housing, opening toward `facing`.
  const put = (lx, lz, lw, ld) => {
    const wx = x + lx * cos - lz * sin;
    const wz = z + lx * sin + lz * cos;
    const rot = Math.abs(sin) > 0.5;
    wall(level, matWall, wx, wz, rot ? ld : lw, rot ? lw : ld, 2.9);
  };
  put(-W / 2, 0, 0.25, D);
  put(W / 2, 0, 0.25, D);
  put(0, -D / 2, W, 0.25);
  // The dark descending shaft: a black well plus a few visible steps.
  const hole = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.05, D - 0.5),
    new THREE.MeshBasicMaterial({ color: 0x05060a }));
  hole.position.set(x, 0.03, z);
  g.add(hole);
  for (let i = 0; i < 4; i++) {
    const sy = -0.22 * (i + 1);
    const sz = z + (D / 2 - 0.45 - i * 0.42) * cos;
    const sx = x - (D / 2 - 0.45 - i * 0.42) * sin;
    box(g, W - 0.6, 0.16, 0.38, matDark, sx, sy + 0.08, sz);
  }
  // Sign so it reads at a glance.
  box(g, 0.5, 0.35, 0.06, matDark, x - 1.0 * cos, 2.3, z - 1.0 * sin);
  level.entries.push(new THREE.Vector3(x + 1.3 * sin * 0 + 1.3 * -sin, 0, z + 1.3 * cos));
  level.spawnSources.push({ x, z, kind: 'stair' });
}

// An open elevator shaft: the doors are gone, the drop is black, and
// things climb up out of it.
export function openShaft(level, matWall, matDark, x, z) {
  const g = level.group;
  const W = 2.6, D = 1.2;
  box(g, W + 0.5, 3.0, 0.3, matWall, x, 1.5, z - D / 2 - 0.15);
  box(g, 0.35, 3.0, D + 0.4, matWall, x - W / 2 - 0.1, 1.5, z);
  box(g, 0.35, 3.0, D + 0.4, matWall, x + W / 2 + 0.1, 1.5, z);
  level.colliders.push({ x: x - W / 2 - 0.1, z, hx: 0.2, hz: D / 2 + 0.2, tall: true });
  level.colliders.push({ x: x + W / 2 + 0.1, z, hx: 0.2, hz: D / 2 + 0.2, tall: true });
  level.colliders.push({ x, z: z - D / 2 - 0.15, hx: W / 2 + 0.25, hz: 0.15, tall: true });
  // The void
  const voidMesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, D),
    new THREE.MeshBasicMaterial({ color: 0x030407 }));
  voidMesh.position.set(x, 0.02, z);
  g.add(voidMesh);
  // Dangling cable + bent door panels, so it reads as a broken shaft.
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 4), matDark);
  cable.position.set(x + 0.4, 1.4, z);
  cable.rotation.z = 0.08;
  g.add(cable);
  box(g, 0.12, 2.5, 0.5, matDark, x - W / 2 + 0.2, 1.25, z + D / 2, 0.35);
  box(g, 0.12, 2.5, 0.5, matDark, x + W / 2 - 0.2, 1.25, z + D / 2, -0.35);
  level.entries.push(new THREE.Vector3(x, 0, z + D / 2 + 0.9));
  level.spawnSources.push({ x, z, kind: 'shaft' });
}

// A breach: a collapsed section of wall with rubble. Things walk in.
export function breach(level, matWall, matRubble, x, z, width = 3.0, along = 'x') {
  const g = level.group;
  // Jagged edge blocks framing the hole.
  for (const side of [-1, 1]) {
    const off = side * (width / 2 + 0.3);
    const bx = along === 'x' ? x + off : x;
    const bz = along === 'x' ? z : z + off;
    box(g, along === 'x' ? 0.7 : 0.35, 2.0, along === 'x' ? 0.35 : 0.7,
      matWall, bx, 1.0, bz, 0.12 * side);
  }
  // Rubble spill pointing inward so the eye follows it.
  for (let i = 0; i < 6; i++) {
    const s = 0.25 + (i % 3) * 0.18;
    const rx = x + (along === 'x' ? (i - 3) * 0.5 : (i % 2 ? 1 : -1) * (0.6 + i * 0.2));
    const rz = z + (along === 'x' ? (i % 2 ? 1 : -1) * (0.6 + i * 0.2) : (i - 3) * 0.5);
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), matRubble);
    r.position.set(rx, s * 0.5, rz);
    r.rotation.set(i, i * 1.7, 0);
    g.add(r);
  }
  level.entries.push(new THREE.Vector3(x, 0, z));
  level.spawnSources.push({ x, z, kind: 'breach' });
}

// A balcony breach on high floors: they climb the facade and come over
// the rail. Marked with grabbing hands worth of detail: bent railing,
// scattered rubble, a hanging rope of cabling.
export function facadeClimb(level, matRail, matDark, x, z) {
  const g = level.group;
  box(g, 1.8, 0.12, 0.1, matRail, x, 1.02, z, 0.0);            // bent top rail
  box(g, 0.1, 1.0, 0.1, matRail, x - 0.85, 0.5, z, 0.25);
  box(g, 0.1, 1.0, 0.1, matRail, x + 0.85, 0.5, z, -0.3);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.4, 4), matDark);
  rope.position.set(x + 0.5, -0.9, z + 0.15);
  g.add(rope);
  level.entries.push(new THREE.Vector3(x, 0, z - 0.8));
  level.spawnSources.push({ x, z, kind: 'facade' });
}

// ---- The roomscale zone -------------------------------------------------
// A marked patch of floor sized to the player's real room, placed inside
// the level. Roomscale VR players are re-centred here; everyone else just
// sees a painted staging area. It is NEVER a wall.
export function roomscaleZone(level, x, z) {
  const size = CONFIG.PLAY_AREA;
  level.roomZone = { x, z, size };
  const g = level.group;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(224,163,60,0.55)';
  ctx.lineWidth = 6;
  ctx.setLineDash([16, 10]);
  ctx.strokeRect(6, 6, 116, 116);
  const tex = new THREE.CanvasTexture(c);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(x, 0.03, z);
  mark.renderOrder = 1;
  mark.userData.dynamic = true;   // keep out of the static merge
  g.add(mark);
  return level.roomZone;
}

// ---- Height sampling ----------------------------------------------------
// Walkable height at a point: the highest platform/ramp top under it,
// otherwise the level's base floor.
export function makeHeightAt(level, baseY = 0) {
  return (x, z) => {
    let best = baseY;
    for (const p of level.ramps) {
      if (Math.abs(x - p.x) <= p.hx && Math.abs(z - p.z) <= p.hz && p.top > best) best = p.top;
    }
    for (const c of level.colliders) {
      if (c.top && Math.abs(x - c.x) <= c.hx && Math.abs(z - c.z) <= c.hz && c.top > best) best = c.top;
    }
    return best;
  };
}
