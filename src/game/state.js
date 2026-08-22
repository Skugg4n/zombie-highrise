// Host-authoritative game state: the horde, the wave director, player
// health/downed state and hitscan damage. Runs ONLY on the host (and in
// solo); clients render from snapshots (see replica.js).
//
// Wave flow (phase machine, host-driven, mirrored to clients in snapshots):
//   lobby -> day -> countdown -> night -> (cleared) -> day ...
//   every TUNING.pacing.nightsPerLevel cleared nights -> elevator (doors
//   open, squad boards) -> ride (the shop) -> next level -> day
//   all players downed -> gameover
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { TUNING } from './tuning.js';
import { resolveCircle, segmentBlocked } from './collision.js';

export const ZOMBIE_TYPES = ['walker', 'runner', 'brute'];

export class HostSim {
  constructor(level) {
    this.level = level;
    this.players = new Map();  // id -> player record
    this.zombies = new Map();  // id -> zombie record
    this.nextZid = 1;
    this.events = [];
    this.kills = 0;
    this.wave = {
      phase: 'lobby',   // lobby|day|countdown|night|elevator|ride|gameover
      night: 0,         // global night counter (1-based once started)
      level: level.index,
      t: 0,             // seconds left in the current phase (day/countdown/ride)
      queue: [],        // zombie types waiting to spawn this night
      spawnT: 0,
      spawnCount: 0,
      left: 0,          // queue + alive (HUD "zombies left")
    };
  }

  setLevel(level) {
    this.level = level;
    this.wave.level = level.index;
    this.zombies.clear();
    // Re-seat players on the new level's spawns.
    let i = 0;
    for (const p of this.players.values()) {
      p.pos.copy(this.level.playerSpawns[i++ % this.level.playerSpawns.length]);
    }
  }

  // ---- Players ---------------------------------------------------------
  addPlayer(id, name, platform) {
    const spawn = this.level.playerSpawns[this.players.size % this.level.playerSpawns.length];
    this.players.set(id, {
      pos: spawn.clone(), ry: 0, rx: 0, vr: false,
      hp: TUNING.player.maxHp, down: false, reviveT: 0,
      name: name || id, platform: platform || '?',
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

  standingCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.down) n++;
    return n;
  }

  // ---- Wave director ---------------------------------------------------
  startRun() {
    if (this.wave.phase !== 'lobby' && this.wave.phase !== 'gameover') return;
    this.kills = 0;
    for (const p of this.players.values()) { p.hp = TUNING.player.maxHp; p.down = false; }
    this._enterDay();
  }

  _enterDay() {
    this.wave.phase = 'day';
    this.wave.t = TUNING.pacing.dayPhaseDuration;
    this.events.push({ e: 'day', n: this.wave.night + 1 });
  }

  _enterCountdown() {
    this.wave.phase = 'countdown';
    this.wave.t = TUNING.pacing.nightIntroCountdown;
    this.events.push({ e: 'countdown', s: this.wave.t });
  }

  _enterNight() {
    const W = TUNING.waves;
    this.wave.night++;
    const night = this.wave.night;
    const players = Math.max(1, this.players.size);
    const budget = W.budgetPoints(night)
      * (W.levelTypeModifier[this.level.type] || 1)
      * TUNING.coopScaling.budgetMultiplier(players);
    const mix = W.mixWeights(night);
    const queue = [];
    for (const type of ZOMBIE_TYPES) {
      const count = Math.round(budget * (mix[type] || 0) / W.threatCost[type]);
      for (let i = 0; i < count; i++) queue.push(type);
    }
    if ((mix.brute || 0) > 0 && !queue.includes('brute')) queue.push('brute');
    // Shuffle so types interleave.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    this.wave.phase = 'night';
    this.wave.queue = queue;
    this.wave.spawnT = 0;
    this.wave.spawnCount = 0;
    this.events.push({ e: 'night', n: night });
  }

  _nightCleared() {
    const perLevel = TUNING.pacing.nightsPerLevel;
    if (this.wave.night % perLevel === 0) {
      this.wave.phase = 'elevator';
      this.events.push({ e: 'elevator' });
    } else {
      this._enterDay();
    }
  }

  // The squad boarded; the ride is the shop.
  _enterRide() {
    this.wave.phase = 'ride';
    this.wave.t = 20;
    this.events.push({ e: 'ride' });
  }

  _arrive() {
    this.wave.level++;
    this.events.push({ e: 'level', index: this.wave.level });
    // main.js rebuilds the level on this event (all peers, same seed) and
    // calls setLevel(); the day phase starts on the new floor.
    this._enterDay();
  }

  // Solo/host rule after a wipe: restart the CURRENT level (inventory and
  // scrap kept). Rolls the night counter back to this level's first night.
  restartLevel() {
    this.zombies.clear();
    this.wave.night = (this.wave.level - 1) * TUNING.pacing.nightsPerLevel;
    let i = 0;
    for (const p of this.players.values()) {
      p.hp = TUNING.player.maxHp; p.down = false; p.reviveT = 0;
      p.pos.copy(this.level.playerSpawns[i++ % this.level.playerSpawns.length]);
    }
    this.events.push({ e: 'restart' });
    this._enterDay();
  }

  forceNight() {  // test hook (smoke test drives the wave machine directly)
    if (this.wave.phase === 'day' || this.wave.phase === 'lobby') {
      if (this.wave.phase === 'lobby') this.startRun();
      this._enterNight();
    }
  }

  // ---- Combat ----------------------------------------------------------
  spawnZombie(type) {
    const spawns = this.level.zombieSpawns.length ? this.level.zombieSpawns : this.level.entries;
    if (!spawns.length) return;
    const s = spawns[Math.floor(Math.random() * spawns.length)];
    const id = this.nextZid++;
    const stats = TUNING.enemies[type];
    this.zombies.set(id, {
      id, type,
      pos: s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)),
      hp: stats.hp, alive: true,
      biteT: 0, targetId: null, retargetT: 0,
    });
    this.events.push({ e: 'zspawn', id });
  }

  // Hitscan: ray vs every living zombie's torso sphere, nearest first,
  // occluded by tall colliders (walls). Returns the zombie hit or null.
  shoot(origin, dir, damage = 1) {
    const o = new THREE.Vector3().fromArray(origin);
    const d = new THREE.Vector3().fromArray(dir).normalize();
    let best = null, bestT = Infinity;
    for (const z of this.zombies.values()) {
      if (!z.alive) continue;
      const r = TUNING.enemies[z.type].radius;
      const centre = z.pos.clone(); centre.y += z.type === 'brute' ? 1.2 : 1.1;
      const oc = centre.sub(o);
      const t = oc.dot(d);
      if (t < 0 || t > 200) continue;
      const distSq = oc.lengthSq() - t * t;
      if (distSq > r * r) continue;
      if (t < bestT) { bestT = t; best = z; }
    }
    if (!best) return null;
    const hit = o.clone().addScaledVector(d, bestT);
    const tall = this.level.colliders.filter((c) => c.tall);
    if (segmentBlocked(o.x, o.z, hit.x, hit.z, tall)) return null;
    this.damageZombie(best, damage, false);
    return best;
  }

  damageZombie(z, damage, isMelee) {
    if (!z.alive) return;
    z.hp -= damage;
    if (z.hp <= 0) {
      z.alive = false;
      this.kills++;
      const scrap = TUNING.economy.scrapPerKill[z.type] + (isMelee ? TUNING.economy.meleeKillBonus : 0);
      this.events.push({ e: 'zdie', id: z.id, type: z.type, p: z.pos.toArray(), scrap });
      this.zombies.delete(z.id);
    } else {
      this.events.push({ e: 'zhit', id: z.id });
    }
  }

  damagePlayer(id, amount) {
    const p = this.players.get(id);
    if (!p || p.down) return;
    p.hp = Math.max(0, p.hp - amount);
    this.events.push({ e: 'phit', id, hp: p.hp });
    if (p.hp <= 0) {
      p.down = true;
      this.events.push({ e: 'down', id });
      if (this.standingCount() === 0) {
        this.wave.phase = 'gameover';
        this.events.push({
          e: 'gameover',
          stats: { nights: this.wave.night, kills: this.kills, level: this.wave.level },
        });
      }
    }
  }

  // ---- Frame step ------------------------------------------------------
  step(dt) {
    const wave = this.wave;
    switch (wave.phase) {
      case 'day':
        wave.t -= dt;
        if (wave.t <= 0) this._enterCountdown();
        break;
      case 'countdown':
        wave.t -= dt;
        if (wave.t <= 0) this._enterNight();
        break;
      case 'night': {
        // Trickle spawner with bursts.
        const P = TUNING.pacing;
        const players = Math.max(1, this.players.size);
        const interval = P.spawnInterval(wave.night) / TUNING.coopScaling.spawnIntervalDivisor(players);
        wave.spawnT -= dt;
        while (wave.spawnT <= 0 && wave.queue.length && this.zombies.size < TUNING.waves.maxAlive) {
          wave.spawnCount++;
          const burst = wave.night >= P.burst.startNight && wave.spawnCount % P.burst.everyNthSpawn === 0
            ? P.burst.size(wave.night) : 1;
          for (let i = 0; i < burst && wave.queue.length && this.zombies.size < TUNING.waves.maxAlive; i++) {
            this.spawnZombie(wave.queue.pop());
          }
          wave.spawnT += interval;
        }
        if (!wave.queue.length && this.zombies.size === 0) this._nightCleared();
        break;
      }
      case 'elevator': {
        // Waiting for every standing player to board.
        const zone = this.level.elevatorZone;
        let boarded = 0, standing = 0;
        for (const p of this.players.values()) {
          if (p.down) continue;
          standing++;
          if (Math.abs(p.pos.x - zone.x) < zone.hx && Math.abs(p.pos.z - zone.z) < zone.hz) boarded++;
        }
        if (standing > 0 && boarded === standing) this._enterRide();
        break;
      }
      case 'ride':
        wave.t -= dt;
        if (wave.t <= 0) this._arrive();
        break;
      default:
        break;
    }

    // Zombies hunt (during night and while the squad heads for the elevator).
    if (wave.phase === 'night' || wave.phase === 'elevator') this._stepZombies(dt);

    // Revives: a standing teammate close to a downed player revives them
    // by staying close (proximity revive works on every platform).
    for (const [id, p] of this.players) {
      if (!p.down) continue;
      let helper = null;
      for (const q of this.players.values()) {
        if (q === p || q.down) continue;
        if (q.pos.distanceToSquared(p.pos) < 1.5 * 1.5) { helper = q; break; }
      }
      if (helper) {
        p.reviveT += dt;
        if (p.reviveT >= TUNING.player.reviveTime) {
          p.down = false; p.reviveT = 0;
          p.hp = TUNING.player.revivedAtHp;
          this.events.push({ e: 'revive', id, hp: p.hp });
        }
      } else {
        p.reviveT = 0;
      }
    }

    wave.left = wave.queue.length + this.zombies.size;
  }

  _stepZombies(dt) {
    for (const z of this.zombies.values()) {
      const stats = TUNING.enemies[z.type];
      // Aggro: nearest standing player, re-evaluated every 2 s.
      z.retargetT -= dt;
      let target = z.targetId ? this.players.get(z.targetId) : null;
      if (!target || target.down || z.retargetT <= 0) {
        z.retargetT = 2;
        let nd = Infinity; target = null; z.targetId = null;
        for (const [id, p] of this.players) {
          if (p.down) continue;
          const d = z.pos.distanceToSquared(p.pos);
          if (d < nd) { nd = d; target = p; z.targetId = id; }
        }
      }
      if (!target) continue;

      // Routing: when the straight line to the target crosses a tall wall,
      // or the zombie is outside a ground level's base, head for the best
      // entry first. Low colliders (sandbags, crates) block movement via
      // pushout, which slides the zombie along them.
      let goal = target.pos;
      const tall = this.level.collidersTall || (this.level.collidersTall = this.level.colliders.filter((c) => c.tall));
      const losBlocked = segmentBlocked(z.pos.x, z.pos.z, target.pos.x, target.pos.z, tall);
      const half = CONFIG.PLAY_AREA / 2;
      const outsideGround = this.level.type === 'ground'
        && (Math.abs(z.pos.x) > half || Math.abs(z.pos.z) > half);
      if ((losBlocked || outsideGround) && this.level.entries.length) {
        let best = null, bd = Infinity;
        for (const ePos of this.level.entries) {
          const d = z.pos.distanceToSquared(ePos) + ePos.distanceToSquared(target.pos);
          if (d < bd) { bd = d; best = ePos; }
        }
        if (best && z.pos.distanceToSquared(best) > 1.0) goal = best;
      }

      const dist = z.pos.distanceTo(target.pos);
      const reach = stats.radius + 0.55;
      if (goal !== target.pos || dist > reach) {
        const to = goal.clone().sub(z.pos); to.y = 0;
        if (to.lengthSq() > 1e-6) {
          to.normalize().multiplyScalar(stats.speed * dt);
          z.pos.add(to);
          resolveCircle(z.pos, stats.radius * 0.8, this.level.colliders);
        }
        z.biteT = 0;
      } else {
        z.biteT += dt;
        if (z.biteT >= stats.biteInterval) {
          z.biteT = 0;
          this.damagePlayer(z.targetId, stats.biteDamage);
        }
      }
      z.pos.y = this.level.heightAt(z.pos.x, z.pos.z);
    }
  }

  // ---- Snapshot --------------------------------------------------------
  snapshot(ts) {
    const players = {};
    for (const [id, p] of this.players) {
      players[id] = {
        p: p.pos.toArray().map((n) => +n.toFixed(3)),
        ry: +p.ry.toFixed(3), rx: +p.rx.toFixed(3),
        vr: p.vr, hp: p.hp, down: p.down, name: p.name,
        h: p.h, hl: p.hl, hr: p.hr,
      };
    }
    // Compact zombie array: [id, typeIndex, x, y, z, hp]
    const zs = [];
    for (const z of this.zombies.values()) {
      zs.push([z.id, ZOMBIE_TYPES.indexOf(z.type),
        +z.pos.x.toFixed(2), +z.pos.y.toFixed(2), +z.pos.z.toFixed(2), z.hp]);
    }
    const ev = this.events; this.events = [];
    const w = this.wave;
    return {
      t: 'snap', ts, players, zs,
      wave: { ph: w.phase, n: w.night, lv: w.level, t: Math.max(0, Math.ceil(w.t)), left: w.left },
      ev,
    };
  }
}
