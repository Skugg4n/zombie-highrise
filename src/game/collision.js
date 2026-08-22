// Cheap circle-vs-AABB collision for players and zombies against level
// colliders (walls, pillars, crates). Colliders are axis-aligned boxes in
// the XZ plane: { x, z, hx, hz } (centre + half extents). Height is
// ignored: anything in the collider list blocks ground movement.

// Push `pos` (THREE.Vector3, mutated) out of every collider it overlaps.
export function resolveCircle(pos, radius, colliders) {
  for (const c of colliders) {
    // Closest point on the box to the circle centre.
    const cx = Math.max(c.x - c.hx, Math.min(pos.x, c.x + c.hx));
    const cz = Math.max(c.z - c.hz, Math.min(pos.z, c.z + c.hz));
    let dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the shallowest axis.
      const px = c.hx - Math.abs(pos.x - c.x), pz = c.hz - Math.abs(pos.z - c.z);
      if (px < pz) pos.x = c.x + Math.sign(pos.x - c.x || 1) * (c.hx + radius);
      else pos.z = c.z + Math.sign(pos.z - c.z || 1) * (c.hz + radius);
    }
  }
}

// True when the segment a->b (XZ) passes through any collider. Used for
// hitscan wall occlusion and simple line-of-sight checks.
export function segmentBlocked(ax, az, bx, bz, colliders) {
  for (const c of colliders) {
    if (segmentVsAabb(ax, az, bx, bz, c)) return true;
  }
  return false;
}

function segmentVsAabb(ax, az, bx, bz, c) {
  // Slab test in 2D.
  const dx = bx - ax, dz = bz - az;
  let tmin = 0, tmax = 1;
  for (const [d, a, min, max] of [
    [dx, ax, c.x - c.hx, c.x + c.hx],
    [dz, az, c.z - c.hz, c.z + c.hz],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (a < min || a > max) return false;
    } else {
      let t1 = (min - a) / d, t2 = (max - a) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
