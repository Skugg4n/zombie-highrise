// Character ground handling.
//
// PLAYTEST ROOT CAUSE (Ola, v0.9.3): "no gravity, absence of natural
// laws". The old code teleported the player to heightAt() every frame, so
// you walked up the SIDE of a ramp like a flat surface, could not step
// onto its last step, and never fell off anything.
//
// This replaces it with a real controller:
//   - ground is sampled from the level's solids, not a flat function
//   - you can STEP UP a small ledge, but not a wall
//   - you can walk a shallow SLOPE, but steep faces block you
//   - when there is nothing under you, you FALL, and you land
export const LOCO = {
  stepUp: 0.45,        // a curb or ramp step you can walk onto
  stepDown: 0.55,      // drop you can walk down without it counting as a fall
  gravity: 22,         // m/s^2 (snappy, game-feel gravity, not real 9.8)
  maxFall: 26,         // terminal velocity
  radius: 0.32,
};

// Highest solid top under (x, z), searching the level's colliders and
// ramps. Returns the base floor when nothing else is under the point.
export function groundHeight(level, x, z, fromY = Infinity) {
  const baseY = level.baseY || 0;
  // The level's own sampler defines the terrain floor (and marks voids by
  // returning far below the base, e.g. the street under a balcony).
  let best = baseY;
  if (level.heightAt) {
    const f = level.heightAt(x, z);
    if (f < baseY - 5) return -Infinity;      // nothing under you: a fall
    best = f;
  }
  const ceilingSlack = 0.05;
  // Ramps are the fine-grained walkable slabs a platform lays down.
  for (const r of level.ramps || []) {
    if (Math.abs(x - r.x) > r.hx || Math.abs(z - r.z) > r.hz) continue;
    if (r.top > best && r.top <= fromY + LOCO.stepUp + ceilingSlack) best = r.top;
  }
  for (const c of level.colliders || []) {
    if (!c.top) continue;
    if (Math.abs(x - c.x) > c.hx || Math.abs(z - c.z) > c.hz) continue;
    if (c.top > best && c.top <= fromY + LOCO.stepUp + ceilingSlack) best = c.top;
  }
  if (level.voidAt && level.voidAt(x, z)) return -Infinity;
  return best;
}

// The solids a mover at height `y` is actually blocked by. A platform you
// can step onto must NOT push you out horizontally, which was the "cannot
// step onto the last step" bug: the platform's own collider ejected the
// player at the moment they arrived at its edge.
export function blockingFor(level, y, colliders = null) {
  const list = colliders || level.colliders || [];
  const out = [];
  for (const c of list) {
    if (c.dead) continue;                                            // breached
    if (c.top !== undefined && c.top <= y + LOCO.stepUp) continue;   // steppable
    out.push(c);
  }
  return out;
}

// Resolve horizontal movement against solids, honouring step-up: a low
// ledge is climbed, a wall is not. `pos` is mutated.
// Returns true when the mover is standing on something.
export function moveAndCollide(level, pos, vel, dt, colliders, radius = LOCO.radius) {
  const startY = pos.y;

  // --- horizontal, axis-separated so sliding along walls works ---------
  for (const axis of ['x', 'z']) {
    const delta = vel[axis] * dt;
    if (!delta) continue;
    const prev = pos[axis];
    pos[axis] += delta;
    for (const c of colliders) {
      if (c.top !== undefined && c.top <= startY + LOCO.stepUp) continue;   // walkable, step onto it
      const insideX = Math.abs(pos.x - c.x) < c.hx + radius;
      const insideZ = Math.abs(pos.z - c.z) < c.hz + radius;
      if (!insideX || !insideZ) continue;
      // Blocked: back this axis out (the other axis still moves = slide).
      pos[axis] = prev;
      break;
    }
  }

  // --- vertical: gravity, landing, step-up, honest falling -------------
  const gh = groundHeight(level, pos.x, pos.z, pos.y);
  if (gh === -Infinity) {
    // Nothing underneath at all: fall forever (a chasm or off a balcony).
    vel.y = Math.max(-LOCO.maxFall, vel.y - LOCO.gravity * dt);
    pos.y += vel.y * dt;
    return false;
  }

  const rise = gh - pos.y;
  if (rise > 0 && rise <= LOCO.stepUp) {
    // Step up onto a ledge or ramp step.
    pos.y = gh;
    vel.y = 0;
    return true;
  }
  if (rise > LOCO.stepUp) {
    // Too tall to step onto: this is a wall. Stay put vertically; the
    // horizontal pass above should already have blocked us, but a ramp
    // side can slip through, so hold height here too.
    vel.y = 0;
    return true;
  }
  // Ground is at or below us.
  const drop = pos.y - gh;
  if (drop <= LOCO.stepDown && vel.y <= 0) {
    pos.y = gh;         // walk down a small step without launching
    vel.y = 0;
    return true;
  }
  vel.y = Math.max(-LOCO.maxFall, vel.y - LOCO.gravity * dt);
  pos.y += vel.y * dt;
  if (pos.y <= gh) { pos.y = gh; vel.y = 0; return true; }
  return false;
}
