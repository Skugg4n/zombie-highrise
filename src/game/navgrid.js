import { LOCO } from './locomotion.js';
// Navigation grid + pathfinding for the horde.
//
// PLAYTEST ROOT CAUSE (Ola, v0.9.3): zombies got stuck, jittered in place,
// walked into geometry and could not get out, and were therefore harmless.
// The old brain was "walk straight at the target, and if a wall is in the
// way aim at the nearest entry instead", which deadlocks against any
// concave shape and oscillates on the boundary between the two rules.
//
// This replaces it with a real grid: rasterise the level's colliders into
// walkable cells once per level, then A* over that grid. Agents follow the
// path with string-pulling (skip waypoints you already have line of sight
// to) so movement reads as smooth walking, not grid-stepping.
const DIAG = Math.SQRT2;

export class NavGrid {
  // bounds: {minX, maxX, minZ, maxZ}; cell: metres per cell.
  constructor(bounds, cell = 0.6) {
    this.cell = cell;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.w = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
    this.h = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
    this.blocked = new Uint8Array(this.w * this.h);
    // Scratch buffers reused by every search (no per-query allocation).
    this._came = new Int32Array(this.w * this.h);
    this._g = new Float32Array(this.w * this.h);
    this._seen = new Int32Array(this.w * this.h);
    this._stamp = 0;
    // Budget scaled to the grid: enough to cross a big open field, still
    // bounded so a hopeless search cannot stall a frame.
    this.defaultBudget = Math.min(30000, Math.max(4000, Math.round(this.w * this.h * 0.35)));
  }

  // Every free cell reachable from (sx, sz), as a Uint8Array over the
  // grid. This is the honest answer to "can the player get there from
  // here": a bot walking toward a goal can be defeated by an L-shaped
  // route, a flood fill cannot.
  reachableFrom(sx, sz) {
    const out = new Uint8Array(this.w * this.h);
    const [scx, scz] = this.nearestFree(sx, sz);
    const start = this.idx(scx, scz);
    if (this.blocked[start]) return out;
    out[start] = 1;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const cx = i % this.w, cz = (i - cx) / this.w;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.inBounds(nx, nz)) continue;
        const j = this.idx(nx, nz);
        if (out[j] || this.blocked[j]) continue;
        out[j] = 1;
        queue.push(j);
      }
    }
    return out;
  }

  idx(cx, cz) { return cz * this.w + cx; }
  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  toCellX(x) { return Math.floor((x - this.minX) / this.cell); }
  toCellZ(z) { return Math.floor((z - this.minZ) / this.cell); }
  worldX(cx) { return this.minX + (cx + 0.5) * this.cell; }
  worldZ(cz) { return this.minZ + (cz + 0.5) * this.cell; }

  isBlocked(cx, cz) {
    if (!this.inBounds(cx, cz)) return true;
    return this.blocked[this.idx(cx, cz)] === 1;
  }


  // Rasterise colliders. `agentRadius` inflates them so agents keep their
  // shoulders out of walls instead of grinding along them.
  build(colliders, agentRadius = 0.45, extraBlocked = null, forPlayer = false) {
    this.blocked.fill(0);
    for (const c of colliders) {
      if (c.playerOnly && !forPlayer) continue;   // the horde walks through those
      if (c.dead) continue;             // destroyed base wall: a real breach
      // A `top` is only passable if the horde can actually get up there.
      // Platforms are marked walkable (they have a ramp); a low wall or a
      // stack of sandbags has a top too and must still block, or the
      // pathfinder happily routes zombies straight through the base wall.
      if (c.walkable) continue;
      if (c.top !== undefined && c.top <= LOCO.stepUp) continue;
      const hx = c.hx + agentRadius, hz = c.hz + agentRadius;
      const x0 = this.toCellX(c.x - hx), x1 = this.toCellX(c.x + hx);
      const z0 = this.toCellZ(c.z - hz), z1 = this.toCellZ(c.z + hz);
      for (let cz = Math.max(0, z0); cz <= Math.min(this.h - 1, z1); cz++) {
        for (let cx = Math.max(0, x0); cx <= Math.min(this.w - 1, x1); cx++) {
          this.blocked[this.idx(cx, cz)] = 1;
        }
      }
    }
    if (extraBlocked) extraBlocked(this);
  }

  // Nearest walkable cell to a world point, searched in rings. Used when a
  // spawn or a target ends up inside geometry: an agent must ALWAYS have
  // somewhere legal to aim for. Never returns null.
  nearestFree(x, z, maxRings = 12) {
    let cx = this.toCellX(x), cz = this.toCellZ(z);
    cx = Math.max(0, Math.min(this.w - 1, cx));
    cz = Math.max(0, Math.min(this.h - 1, cz));
    if (!this.isBlocked(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxRings; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.isBlocked(nx, nz)) return [nx, nz];
        }
      }
    }
    return [cx, cz];
  }

  // A* from world start to world goal. Returns an array of world-space
  // waypoints [{x, z}] (goal last), or null when genuinely unreachable.
  // The node budget has to scale with the grid. A holdout field is a
  // 98x96 m grid and the horde walks 45 m in; a fixed 4000-node budget
  // aborted those searches, the zombie fell back to drifting, and a
  // spawn behind a sight blocker could never find its way to the base.
  findPath(sx, sz, gx, gz, maxNodes = this.defaultBudget) {
    const [scx, scz] = this.nearestFree(sx, sz);
    const [gcx, gcz] = this.nearestFree(gx, gz);
    const start = this.idx(scx, scz), goal = this.idx(gcx, gcz);
    if (start === goal) return [{ x: gx, z: gz }];

    const { w, h, _came: came, _g: g, _seen: seen } = this;
    const stamp = ++this._stamp;
    // Binary heap of [f, node] pairs kept in a flat array.
    const heapF = [], heapN = [];
    const push = (f, n) => {
      heapF.push(f); heapN.push(n);
      let i = heapF.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
        [heapN[p], heapN[i]] = [heapN[i], heapN[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heapN[0];
      const lastF = heapF.pop(), lastN = heapN.pop();
      if (heapF.length) {
        heapF[0] = lastF; heapN[0] = lastN;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heapF.length && heapF[l] < heapF[m]) m = l;
          if (r < heapF.length && heapF[r] < heapF[m]) m = r;
          if (m === i) break;
          [heapF[m], heapF[i]] = [heapF[i], heapF[m]];
          [heapN[m], heapN[i]] = [heapN[i], heapN[m]];
          i = m;
        }
      }
      return top;
    };
    const hEst = (n) => {
      const cx = n % w, cz = (n / w) | 0;
      const dx = Math.abs(cx - gcx), dz = Math.abs(cz - gcz);
      return (dx + dz) + (DIAG - 2) * Math.min(dx, dz);
    };

    seen[start] = stamp; g[start] = 0; came[start] = -1;
    push(hEst(start), start);
    let expanded = 0;
    let best = start, bestH = hEst(start);

    while (heapN.length) {
      const cur = pop();
      if (cur === goal) { best = goal; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % w, cz = (cur / w) | 0;
      const ch = hEst(cur);
      if (ch < bestH) { bestH = ch; best = cur; }
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          if (this.blocked[this.idx(nx, nz)]) continue;
          // No cutting corners diagonally through a wall pair.
          if (dx && dz) {
            if (this.blocked[this.idx(cx + dx, cz)]) continue;
            if (this.blocked[this.idx(cx, cz + dz)]) continue;
          }
          const n = this.idx(nx, nz);
          const step = dx && dz ? DIAG : 1;
          const ng = g[cur] + step;
          if (seen[n] === stamp && ng >= g[n]) continue;
          seen[n] = stamp; g[n] = ng; came[n] = cur;
          push(ng + hEst(n), n);
        }
      }
    }

    // Walk back from the best node we reached (partial paths still make
    // the agent move sensibly instead of freezing).
    const out = [];
    let n = best;
    let guard = 0;
    while (n !== -1 && guard++ < 4000) {
      out.push({ x: this.worldX(n % w), z: this.worldZ((n / w) | 0) });
      if (n === start) break;
      n = came[n];
    }
    out.reverse();
    if (out.length > 1) out.shift();          // drop the cell we stand in
    if (best === goal && out.length) out[out.length - 1] = { x: gx, z: gz };
    return out.length ? out : null;
  }

  // Line of sight over the grid (Bresenham-ish supercover). Used for
  // string-pulling so agents cut corners naturally.
  lineClear(ax, az, bx, bz) {
    let cx = this.toCellX(ax), cz = this.toCellZ(az);
    const tx = this.toCellX(bx), tz = this.toCellZ(bz);
    const dx = Math.abs(tx - cx), dz = Math.abs(tz - cz);
    const sx = cx < tx ? 1 : -1, sz = cz < tz ? 1 : -1;
    let err = dx - dz, guard = 0;
    for (;;) {
      if (this.isBlocked(cx, cz)) return false;
      if (cx === tx && cz === tz) return true;
      if (guard++ > 512) return false;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; cx += sx; }
      if (e2 < dx) { err += dx; cz += sz; }
    }
  }
}
