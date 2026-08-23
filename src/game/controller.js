// THE CHARACTER CONTROLLER.
//
// Ola's diagnosis, and it was right: clipping through a ramp from the
// side, falling through it in places, walking up and down its sides as if
// the world were flat, ground sampled at the wrong position, getting stuck
// in a chasm, becoming permanently short after a fall. Those were never
// separate bugs. They were one missing system, and this is it.
//
// What was there before: input layers wrote straight into the player's
// position, and collision was a push-out applied afterwards. That fails in
// exactly the ways listed, because by the time anything is checked the
// player is already inside the wall.
//
// The rules this enforces, in order:
//
//   SWEPT, NOT DISCRETE. A frame's movement is split into steps no larger
//   than half the body radius, and each one is resolved before the next.
//   A discrete check lets a fast player skip straight past a thin wall or
//   land inside a ramp, which is precisely how the ramp could be entered
//   from its high side.
//
//   THE FEET DECIDE. Ground is sampled at the body's actual position. In
//   roomscale VR the player can stand two metres from the play-space
//   origin, so sampling under the origin samples a different place
//   entirely.
//
//   STEP UP OR BE STOPPED. A rise within stepUp is climbed. Anything more
//   is a wall, and the movement that would have entered it is rejected
//   per axis, so you slide along instead of stopping dead.
//
//   SLOPES ARE A LIMIT, NOT A SUGGESTION. A rise steeper than the slope
//   limit over the distance travelled is a wall even if it is short,
//   which is what stops a player walking up the side of a ramp.
//
//   NOTHING IS EVER STUCK. If a body ends up inside geometry or under the
//   floor, it is pushed to the nearest valid place. A player who cannot
//   continue is worse than any glitch.
//
//   HEIGHT IS DERIVED, NEVER STORED. Eye height is computed from state
//   every frame. Mutating it and leaving it stale is why Ola stayed short
//   after a fall.
import * as THREE from 'three';
import { resolveCircle } from './collision.js';
import { groundHeight, blockingFor, LOCO } from './locomotion.js';

export const BODY = {
  radius: 0.32,
  height: 1.75,           // full standing height, feet to crown
  eyeHeight: 1.6,         // where the camera sits when standing
  downedEyeHeight: 0.55,
  stepUp: 0.45,           // the tallest ledge you can walk onto
  stepDown: 0.55,         // the tallest drop you walk down instead of falling
  // The steepest rise you may climb, as a ratio of rise to run. 1.0 is 45
  // degrees. Above this a surface is a wall no matter how short it is,
  // which is what stops you strolling up the flank of a ramp.
  maxSlope: 1.0,          // 45 degrees
  gravity: 22,
  terminalVelocity: 26,
  // Below this depth the world has been left behind, not fallen through.
  killPlaneBelow: 25,
};

// The longest a single swept step may be, as a fraction of the radius.
// Half a radius means a body can never pass more than halfway through a
// surface before that surface gets a say.
const SWEEP_FRACTION = 0.5;
// How far ahead the slope is measured. Long enough to average out the
// slabs a ramp is built from, short enough to still be "ahead of me".
const SLOPE_WINDOW = 0.7;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class CharacterController {
  constructor() {
    this.pos = new THREE.Vector3();       // FEET, and the authority
    this.velY = 0;
    this.grounded = true;
    this.groundY = 0;
    this.airTime = 0;
    this.fellFrom = 0;                    // height at the start of a fall
    // Reported once, on the frame it happens, for callers to react to.
    this.landed = 0;                      // impact speed, 0 if none
    this.fellOutOfWorld = false;
    this.blocked = false;                 // ran into something this frame
    this.recovered = false;               // had to be dug out of geometry
  }

  // Put the body somewhere known-good, cancelling any motion. Used on
  // spawn, respawn and level change: the ONE way a body is placed.
  place(level, x, z, y = null) {
    this.pos.set(x, 0, z);
    const g = groundHeight(level, x, z, Infinity);
    this.pos.y = y !== null ? y : (Number.isFinite(g) ? g : (level.baseY || 0));
    this.velY = 0;
    this.grounded = true;
    this.airTime = 0;
    this.landed = 0;
    this.fellOutOfWorld = false;
  }

  // Eye height for the current state. DERIVED, never stored: this is the
  // whole fix for staying short after a fall.
  eyeHeight(downed) {
    return downed ? BODY.downedEyeHeight : BODY.eyeHeight;
  }

  // dt: seconds. wishX/wishZ: desired horizontal velocity in m/s.
  //
  // Returns nothing; read this.pos, this.grounded, this.landed and
  // this.fellOutOfWorld afterwards. Those flags are reset here, so they
  // always describe THIS frame.
  step(level, dt, wishX, wishZ) {
    this.landed = 0;
    this.blocked = false;
    this.recovered = false;
    this.fellOutOfWorld = false;

    const solids = () => blockingFor(level, this.pos.y);

    // ---- 0. Is the ground ahead too steep to walk up? ----
    //
    // Measured over a WINDOW, not per sub-step. A ramp is built from slabs,
    // so at every slab edge the height jumps vertically and a per-step
    // rise-over-run is infinite: the first version of this rejected every
    // ramp and every staircase in the gym. Sampling a fixed distance ahead
    // averages the steps out and gives the slope of the actual surface,
    // which is the thing being limited.
    let wx = wishX, wz = wishZ;
    const wishLen = Math.hypot(wx, wz);
    if (wishLen > 1e-4 && this.grounded) {
      const ux = wx / wishLen, uz = wz / wishLen;
      const here = groundHeight(level, this.pos.x, this.pos.z, Infinity);
      const ahead = groundHeight(level,
        this.pos.x + ux * SLOPE_WINDOW, this.pos.z + uz * SLOPE_WINDOW, Infinity);
      if (Number.isFinite(here) && Number.isFinite(ahead)) {
        const slope = (ahead - here) / SLOPE_WINDOW;
        if (slope > BODY.maxSlope) { wx = 0; wz = 0; this.blocked = true; }
      }
    }

    // ---- 1. Horizontal, swept ----
    const dx = wx * dt, dz = wz * dt;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6) {
      const maxStep = BODY.radius * SWEEP_FRACTION;
      const steps = Math.max(1, Math.ceil(dist / maxStep));
      const sx = dx / steps, sz = dz / steps;
      for (let i = 0; i < steps; i++) {
        this._sweepOnce(level, sx, sz, solids());
      }
    }

    // ---- 2. Vertical ----
    const gy = groundHeight(level, this.pos.x, this.pos.z, this.pos.y);
    const hasGround = Number.isFinite(gy);
    this.groundY = hasGround ? gy : -Infinity;

    if (hasGround && this.pos.y <= gy + 0.001 && this.velY <= 0) {
      // Standing on it.
      if (!this.grounded) this.landed = Math.abs(this.velY);
      this.pos.y = gy;
      this.velY = 0;
      this.grounded = true;
      this.airTime = 0;
    } else if (hasGround && this.grounded && this.pos.y - gy <= BODY.stepDown) {
      // A small drop is walked down, not fallen.
      this.pos.y = gy;
      this.velY = 0;
    } else {
      // Airborne.
      if (this.grounded) this.fellFrom = this.pos.y;
      this.grounded = false;
      this.airTime += dt;
      this.velY = Math.max(-BODY.terminalVelocity, this.velY - BODY.gravity * dt);
      this.pos.y += this.velY * dt;
      if (hasGround && this.pos.y <= gy) {
        this.landed = Math.abs(this.velY);
        this.pos.y = gy;
        this.velY = 0;
        this.grounded = true;
        this.airTime = 0;
      }
    }

    // ---- 3. Nothing is ever stuck ----
    const floor = level.baseY || 0;
    if (this.pos.y < floor - BODY.killPlaneBelow) {
      this.fellOutOfWorld = true;
      return;
    }
    this._unstick(level);
  }

  // One swept sub-step: try to move, reject what would enter a wall, and
  // slide along what is left. Axis-separated so a glancing hit costs you
  // one direction rather than all movement.
  _sweepOnce(level, sx, sz, solids) {
    const startY = this.pos.y;

    // X first.
    const oldX = this.pos.x;
    this.pos.x += sx;
    if (!this._canStand(level, this.pos.x, this.pos.z, startY, Math.abs(sx))) {
      this.pos.x = oldX;
      this.blocked = true;
    }
    // Then Z, against the position X ended up at.
    const oldZ = this.pos.z;
    this.pos.z += sz;
    if (!this._canStand(level, this.pos.x, this.pos.z, startY, Math.abs(sz))) {
      this.pos.z = oldZ;
      this.blocked = true;
    }

    // Solids the body overlaps get to push it out. This is a correction
    // for the geometry the height test cannot see (fences, posts, walls
    // with no walkable top), not the primary collision.
    _a.copy(this.pos);
    resolveCircle(this.pos, BODY.radius, solids);
    if (_a.distanceToSquared(this.pos) > 1e-8) this.blocked = true;
  }

  // May the body stand at (x, z), coming from height `fromY` having
  // travelled `run` metres to get there?
  _canStand(level, x, z, fromY, run) {
    const g = groundHeight(level, x, z, fromY);
    // A void is not standable, but walking OFF a ledge is allowed: you
    // fall. Only refuse if we are already airborne, so a body cannot swim
    // through the air across a hole it is falling into.
    if (!Number.isFinite(g)) return this.grounded;
    const rise = g - fromY;
    if (rise <= 0) return true;                    // downhill or level
    // STEP UP OR BE STOPPED, and nothing else. The slope limit lives in
    // step(), measured over a window: applying it here as well rejected
    // every stair and every slab-built ramp, because a step is a vertical
    // rise over no distance at all by definition.
    void run;
    return rise <= BODY.stepUp;
  }

  // Dig the body out of anything it has ended up inside. Runs every frame
  // and costs nothing when there is nothing to do.
  _unstick(level) {
    const solids = blockingFor(level, this.pos.y);
    _b.copy(this.pos);
    resolveCircle(this.pos, BODY.radius, solids);
    if (_b.distanceToSquared(this.pos) > 1e-8) this.recovered = true;

    // Under the floor: a body that has ended up below solid ground is put
    // back on top of it rather than left to fall forever.
    const g = groundHeight(level, this.pos.x, this.pos.z, Infinity);
    if (Number.isFinite(g) && this.pos.y < g - BODY.stepDown) {
      this.pos.y = g;
      this.velY = 0;
      this.grounded = true;
      this.recovered = true;
    }
  }
}

// Kept as one export so callers never reach past the controller for a
// constant that has to agree with it.
export const CONTROLLER_RADIUS = BODY.radius;
void LOCO;
