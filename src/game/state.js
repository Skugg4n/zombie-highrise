// Host-authoritative game state. Phase 0: player registry, one zombie that
// walks in from the wasteland (through a wall gap, not through walls),
// pistol hitscan damage, zombie melee damage, respawn loop.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const HALF = CONFIG.PLAY_AREA / 2;
// Centres of the four firing gaps in the sandbag perimeter (world.js).
const GAPS = [
  new THREE.Vector3(0, 0, -HALF), new THREE.Vector3(0, 0, HALF),
  new THREE.Vector3(-HALF, 0, 0), new THREE.Vector3(HALF, 0, 0),
];

export class HostSim {
  constructor(world) {
    this.world = world;
    this.players = new Map();   // id -> { pos:V3, ry, rx, vr, hp, name, platform, h, hl, hr }
    this.zombie = {
      pos: world.zombieSpawn.clone(),
      hp: CONFIG.ZOMBIE_HP,
      alive: true,
      respawnT: 0,
      attackT: 0,
    };
    this.events = [];           // drained into each snapshot
  }

  addPlayer(id, name, platform) {
    const spawn = this.world.playerSpawns[this.players.size % this.world.playerSpawns.length];
    this.players.set(id, {
      pos: spawn.clone(), ry: 0, rx: 0, vr: false,
      hp: CONFIG.PLAYER_HP, name: name || id, platform: platform || '?',
      h: null, hl: null, hr: null,
    });
    this.events.push({ e: 'join', id, name: name || id });
  }

  removePlayer(id) {
    if (this.players.delete(id)) this.events.push({ e: 'leave', id });
  }

  updatePose(id, m) {
    const p = this.players.get(id);
    if (!p || !Array.isArray(m.p)) return;
    p.pos.fromArray(m.p);
    p.ry = m.ry || 0; p.rx = m.rx || 0; p.vr = !!m.vr;
    p.h = m.h || null; p.hl = m.hl || null; p.hr = m.hr || null;
  }

  // Hitscan pistol: ray vs zombie torso sphere.
  shoot(origin, dir) {
    const z = this.zombie;
    if (!z.alive) return false;
    const centre = z.pos.clone(); centre.y += 1.1;
    const o = new THREE.Vector3().fromArray(origin);
    const d = new THREE.Vector3().fromArray(dir).normalize();
    const oc = centre.sub(o);
    const t = oc.dot(d);
    if (t < 0) return false;
    const distSq = oc.lengthSq() - t * t;
    if (distSq > CONFIG.ZOMBIE_HIT_RADIUS * CONFIG.ZOMBIE_HIT_RADIUS) return false;
    z.hp -= CONFIG.PISTOL_DAMAGE;
    if (z.hp <= 0) {
      z.alive = false;
      z.respawnT = CONFIG.ZOMBIE_RESPAWN_S;
      this.events.push({ e: 'zdie' });
    } else {
      this.events.push({ e: 'zhit' });
    }
    return true;
  }

  step(dt) {
    const z = this.zombie;
    if (!z.alive) {
      z.respawnT -= dt;
      if (z.respawnT <= 0) {
        z.pos.copy(this.world.zombieSpawn);
        z.hp = CONFIG.ZOMBIE_HP;
        z.alive = true;
        this.events.push({ e: 'zspawn' });
      }
      return;
    }

    // Find nearest living player.
    let nearest = null, nd = Infinity;
    for (const p of this.players.values()) {
      if (p.hp <= 0) continue;
      const d = z.pos.distanceToSquared(p.pos);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (!nearest) return;

    // Route: outside the base -> walk to the nearest wall gap first so the
    // zombie never clips through the sandbag walls; inside -> straight in.
    const insideBase = Math.abs(z.pos.x) < HALF - 0.4 && Math.abs(z.pos.z) < HALF - 0.4;
    let target = nearest.pos;
    if (!insideBase) {
      let gap = GAPS[0], gd = Infinity;
      for (const g of GAPS) {
        const d = z.pos.distanceToSquared(g) + g.distanceToSquared(nearest.pos);
        if (d < gd) { gd = d; gap = g; }
      }
      if (z.pos.distanceToSquared(gap) > 1.0) target = gap;
    }

    const to = target.clone().sub(z.pos); to.y = 0;
    const dist = Math.sqrt(nd);
    // Melee only when actually heading for the player (not while routing
    // to a gap): otherwise the zombie would bite through the sandbag wall.
    const huntingPlayer = target === nearest.pos;
    if (!huntingPlayer || dist > CONFIG.ZOMBIE_ATTACK_RANGE) {
      to.normalize().multiplyScalar(CONFIG.ZOMBIE_SPEED * dt);
      z.pos.add(to);
      z.attackT = 0;
    } else {
      // In melee range: tick damage once per second.
      z.attackT += dt;
      if (z.attackT >= 1.0) {
        z.attackT = 0;
        nearest.hp = Math.max(0, nearest.hp - CONFIG.ZOMBIE_DPS);
        const id = this._idOf(nearest);
        this.events.push({ e: 'phit', id, hp: nearest.hp });
      }
    }
    // Terrain after moving: base floor is 0.1 m above the ground plane.
    z.pos.y = (Math.abs(z.pos.x) < HALF && Math.abs(z.pos.z) < HALF) ? this.world.floorY : 0;
  }

  _idOf(player) {
    for (const [id, p] of this.players) if (p === player) return id;
    return '?';
  }

  snapshot(ts) {
    const players = {};
    for (const [id, p] of this.players) {
      players[id] = {
        p: p.pos.toArray().map((n) => +n.toFixed(3)),
        ry: +p.ry.toFixed(3), rx: +p.rx.toFixed(3),
        vr: p.vr, hp: p.hp, name: p.name,
        h: p.h, hl: p.hl, hr: p.hr,
      };
    }
    const ev = this.events; this.events = [];
    return {
      t: 'snap', ts,
      players,
      z: { p: this.zombie.pos.toArray().map((n) => +n.toFixed(3)), hp: this.zombie.hp, alive: this.zombie.alive },
      ev,
    };
  }
}
