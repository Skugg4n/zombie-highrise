// Host-authoritative game state: the horde, the wave director, player
// health/downed state, inventories, weapons, grenades, loot and damage.
// Runs ONLY on the host (and in solo); clients render from snapshots.
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
export const ITEM_KINDS = ['ammo_shotgun', 'ammo_smg', 'pack', 'grenade'];

const AMMO_PICKUP = { ammo_shotgun: ['shotgun', 25], ammo_smg: ['smg', 120] };

export class HostSim {
  constructor(level) {
    this.level = level;
    this.players = new Map();
    this.zombies = new Map();
    this.grenades = new Map();
    this.items = new Map();
    this.mines = new Map();
    this.drones = new Map();
    this.clouds = [];          // smoke: {pos, t}
    this.fires = [];           // molotov: {pos, t, tickT}
    this.nextZid = 1;
    this.nextGid = 1;
    this.nextIid = 1;
    this.nextMid = 1;
    this.nextDid = 1;
    this.events = [];
    this.kills = 0;
    this.wave = {
      phase: 'lobby', night: 0, nightInLevel: 0, level: level.index,
      t: 0, queue: [], spawnT: 0, spawnCount: 0, left: 0,
    };
  }

  setLevel(level) {
    this.level = level;
    this.wave.level = level.index;
    this.wave.nightInLevel = 0;
    this.zombies.clear();
    this.grenades.clear();
    this.items.clear();
    this.mines.clear();
    this.drones.clear();
    this.clouds.length = 0;
    this.fires.length = 0;
    let i = 0;
    for (const p of this.players.values()) {
      p.pos.copy(this.level.playerSpawns[i++ % this.level.playerSpawns.length]);
    }
    if (this.pendingDayLoot) {
      this.pendingDayLoot = false;
      this._spawnDayLoot();
    }
  }

  // ---- Players ---------------------------------------------------------
  addPlayer(id, name, platform, scrapBonus = 0) {
    // scrapBonus: the joining device's meta-progression perk (0-50).
    const bonus = Math.max(0, Math.min(50, scrapBonus | 0));
    const spawn = this.level.playerSpawns[this.players.size % this.level.playerSpawns.length];
    this.players.set(id, {
      pos: spawn.clone(), ry: 0, rx: 0, vr: false,
      hp: TUNING.player.maxHp, down: false, reviveT: 0,
      name: name || id, platform: platform || '?',
      h: null, hl: null, hr: null,
      inv: {
        w: ['pistol', 'machete'], active: 'pistol',
        a: { pistol: [TUNING.weapons.pistol.magazine, -1] },   // -1 = infinite reserve
        g: 1, gs: 0, gm: 0,      // throwables: frags, smokes, molotovs
        k: 0, m: 0, nv: false,   // packs, mines, night vision device
        s: TUNING.economy.startingScrap + bonus,
      },
    });
    this.events.push({ e: 'join', id, name: name || id });
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this.events.push({ e: 'leave', id });
    // If the departed player was the last one standing, the run is over
    // for the downed survivors (otherwise: permanent softlock).
    const active = this.wave.phase !== 'lobby' && this.wave.phase !== 'gameover';
    if (active && this.players.size > 0 && this.standingCount() === 0) {
      this.wave.phase = 'gameover';
      this.events.push({
        e: 'gameover',
        stats: { nights: this.wave.night, kills: this.kills, level: this.wave.level },
      });
    }
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

  // ---- Player actions (from clients AND from the host's own input) -----
  applyAction(id, m) {
    const p = this.players.get(id);
    if (!p) return;
    // Downed players cannot fight, but they may shop and ready up.
    if (p.down && m.t !== 'buy' && m.t !== 'ready') return;
    switch (m.t) {
      case 'shoot': this._actShoot(id, p, m); break;
      case 'melee': this._actMelee(id, p, m); break;
      case 'throwG': this._actThrow(id, p, m); break;
      case 'reloadDone': this._actReload(p, m.w); break;
      case 'switch':
        if (p.inv.w.includes(m.w)) p.inv.active = m.w;
        break;
      case 'use':
        if (m.item === 'pack') this._actPack(id, p);
        break;
      case 'buy': this._actBuy(id, p, m.item); break;
      case 'placeMine': this._actPlaceMine(id, p, m); break;
      case 'drone': this._actDrone(id, p, m); break;
      case 'ping':
        if (Array.isArray(m.p)) this.events.push({ e: 'ping', p: m.p, by: id });
        break;
      case 'ready':
        if (this.wave.phase === 'ride') {
          p.ready = true;
          let allReady = true;
          for (const q of this.players.values()) if (!q.ready) allReady = false;
          if (allReady) this.wave.t = 0;
        }
        break;
      default:
        break;
    }
  }

  // Mines: hand-placed from inventory during prep (day/countdown), or
  // remote-placed from the tactical map any time for a scrap premium.
  _actPlaceMine(id, p, m) {
    if (!Array.isArray(m.p)) return;
    const pos = new THREE.Vector3().fromArray(m.p);
    pos.y = this.level.heightAt(pos.x, pos.z);
    if (m.via === 'map') {
      const cost = TUNING.economy.minePlacementFromMap;
      if (p.inv.s < cost) return;
      p.inv.s -= cost;
    } else {
      const prep = this.wave.phase === 'day' || this.wave.phase === 'countdown';
      if (!prep || (p.inv.m || 0) <= 0) return;
      p.inv.m--;
    }
    const mid = this.nextMid++;
    this.mines.set(mid, { id: mid, pos, armT: 1.0, owner: id });
    this.events.push({ e: 'mined', id: mid, by: id });
  }

  // Scout drone from the tactical map: flies to the target, hovers 10 s,
  // pings the nearest zombie every 2 s.
  _actDrone(id, p, m) {
    if (!Array.isArray(m.p)) return;
    if (p.inv.s < TUNING.economy.droneDeploy) return;
    p.inv.s -= TUNING.economy.droneDeploy;
    const did = this.nextDid++;
    this.drones.set(did, {
      id: did, owner: id, phase: 'fly',
      pos: p.pos.clone().add(new THREE.Vector3(0, 3.5, 0)),
      target: new THREE.Vector3(m.p[0], this.level.heightAt(m.p[0], m.p[2]) + 3.5, m.p[2]),
      hoverT: 0, pingT: 0,
    });
    this.events.push({ e: 'droned', by: id });
  }

  _actBuy(id, p, item) {
    if (this.wave.phase !== 'ride') return;
    const price = TUNING.economy.shopPrices[item];
    if (!price || p.inv.s < price) return;
    const inv = p.inv;
    switch (item) {
      case 'shotgun':
        if (inv.w.includes('shotgun')) return;
        inv.w.push('shotgun');
        inv.a.shotgun = [TUNING.weapons.shotgun.magazine, 25];
        break;
      case 'smg':
        if (inv.w.includes('smg')) return;
        inv.w.push('smg');
        inv.a.smg = [TUNING.weapons.smg.magazine, 120];
        break;
      case 'ammoRefillShotgun': {
        const a = inv.a.shotgun;
        if (!a || a[1] >= TUNING.weapons.shotgun.reserveMax) return;
        a[1] = Math.min(TUNING.weapons.shotgun.reserveMax, a[1] + 25);
        break;
      }
      case 'ammoRefillSmg': {
        const a = inv.a.smg;
        if (!a || a[1] >= TUNING.weapons.smg.reserveMax) return;
        a[1] = Math.min(TUNING.weapons.smg.reserveMax, a[1] + 120);
        break;
      }
      case 'healthPack':
        if (inv.k >= 2) return;
        inv.k++;
        break;
      case 'grenadePack':
        if (inv.g >= 5) return;
        inv.g = Math.min(5, inv.g + 2);
        break;
      case 'mine':
        if ((inv.m || 0) >= 3) return;
        inv.m = (inv.m || 0) + 1;
        break;
      case 'ak':
        if (inv.w.includes('ak')) return;
        inv.w.push('ak');
        inv.a.ak = [TUNING.weapons.ak.magazine, 90];
        break;
      case 'ammoRefillAk': {
        const a = inv.a.ak;
        if (!a || a[1] >= TUNING.weapons.ak.reserveMax) return;
        a[1] = Math.min(TUNING.weapons.ak.reserveMax, a[1] + 90);
        break;
      }
      case 'akimbo':
        if (inv.w.includes('akimbo')) return;
        inv.w.push('akimbo');
        inv.a.akimbo = [TUNING.weapons.akimbo.magazine, -1];
        break;
      case 'smokePack':
        if ((inv.gs || 0) >= 4) return;
        inv.gs = Math.min(4, (inv.gs || 0) + 2);
        break;
      case 'molotovPack':
        if ((inv.gm || 0) >= 4) return;
        inv.gm = Math.min(4, (inv.gm || 0) + 2);
        break;
      case 'nightVision':
        if (inv.nv) return;
        inv.nv = true;
        break;
      default:
        return;
    }
    inv.s -= price;
    this.events.push({ e: 'bought', id, item });
  }

  _actShoot(id, p, m) {
    const def = TUNING.weapons[m.w];
    if (!def || !p.inv.w.includes(m.w)) return;
    const a = p.inv.a[m.w];
    if (!a || a[0] <= 0) return;
    a[0]--;
    this.events.push({ e: 'shot', id, w: m.w, o: m.o });
    const dir = new THREE.Vector3().fromArray(m.d).normalize();
    const spread = THREE.MathUtils.degToRad(def.spreadDeg || 0);
    for (let i = 0; i < (def.pellets || 1); i++) {
      const d = dir.clone();
      if (spread > 0) {
        d.x += (Math.random() - 0.5) * spread;
        d.y += (Math.random() - 0.5) * spread;
        d.z += (Math.random() - 0.5) * spread;
        d.normalize();
      }
      this.shootRay(m.o, d.toArray(), def.damage, id);
    }
  }

  _actMelee(id, p, m) {
    const def = TUNING.weapons.machete;
    const dir = new THREE.Vector3().fromArray(m.d); dir.y = 0;
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    const cosHalf = Math.cos(THREE.MathUtils.degToRad(def.arcDegrees / 2));
    this.events.push({ e: 'shot', id, w: 'machete', o: m.o });
    for (const z of [...this.zombies.values()]) {
      const to = z.pos.clone().sub(p.pos); to.y = 0;
      const dist = to.length();
      if (dist > def.range + TUNING.enemies[z.type].radius) continue;
      if (dist > 0.01 && to.normalize().dot(dir) < cosHalf) continue;
      this.damageZombie(z, def.damage, true, id);
    }
  }

  _actThrow(id, p, m) {
    const kind = ['frag', 'smoke', 'molotov'].includes(m.kind) ? m.kind : 'frag';
    const counter = { frag: 'g', smoke: 'gs', molotov: 'gm' }[kind];
    if ((p.inv[counter] || 0) <= 0) return;
    p.inv[counter]--;
    const def = kind === 'smoke' ? TUNING.weapons.smokeGrenade
      : kind === 'molotov' ? TUNING.weapons.molotov
        : TUNING.weapons.fragGrenade;
    const gid = this.nextGid++;
    const dir = new THREE.Vector3().fromArray(m.d).normalize();
    this.grenades.set(gid, {
      id: gid, owner: id, kind,
      pos: new THREE.Vector3().fromArray(m.o).addScaledVector(dir, 0.4),
      vel: dir.multiplyScalar(def.throwSpeed).add(new THREE.Vector3(0, 3.2, 0)),
      fuse: kind === 'molotov' ? 3.0 : def.fuseTime,   // molotov pops on impact
    });
  }

  _actReload(p, w) {
    const def = TUNING.weapons[w];
    const a = p.inv.a[w];
    if (!def || !a) return;
    const need = def.magazine - a[0];
    if (need <= 0) return;
    const take = a[1] < 0 ? need : Math.min(need, a[1]);
    a[0] += take;
    if (a[1] >= 0) a[1] -= take;
  }

  _actPack(id, p) {
    if (p.inv.k <= 0) return;
    // Near a downed teammate: the pack revives them instead of healing you.
    for (const [qid, q] of this.players) {
      if (q === p || !q.down) continue;
      if (q.pos.distanceToSquared(p.pos) < 4) {
        p.inv.k--;
        q.down = false; q.reviveT = 0;
        q.hp = Math.min(TUNING.player.maxHp, TUNING.player.revivedAtHp + TUNING.player.healthPackHeal);
        this.events.push({ e: 'revive', id: qid, hp: q.hp });
        return;
      }
    }
    if (p.hp >= TUNING.player.maxHp) return;
    p.inv.k--;
    p.hp = Math.min(TUNING.player.maxHp, p.hp + TUNING.player.healthPackHeal);
    this.events.push({ e: 'phit', id, hp: p.hp });   // phit doubles as hp sync
  }

  // ---- Wave director ---------------------------------------------------
  startRun() {
    if (this.wave.phase !== 'lobby' && this.wave.phase !== 'gameover') return;
    this.kills = 0;
    for (const p of this.players.values()) { p.hp = TUNING.player.maxHp; p.down = false; }
    this._enterDay();
  }

  restartLevel() {
    this.zombies.clear();
    this.grenades.clear();
    this.wave.night -= this.wave.nightInLevel;
    this.wave.nightInLevel = 0;
    let i = 0;
    for (const p of this.players.values()) {
      p.hp = TUNING.player.maxHp; p.down = false; p.reviveT = 0;
      p.pos.copy(this.level.playerSpawns[i++ % this.level.playerSpawns.length]);
    }
    this.events.push({ e: 'restart' });
    this._enterDay();
  }

  _enterDay(spawnLoot = true) {
    this.wave.phase = 'day';
    // On the wagon the prep is short: you are already rolling.
    this.wave.t = this.level.type === 'wagon' ? 10 : TUNING.pacing.dayPhaseDuration;
    this.events.push({ e: 'day', n: this.wave.night + 1 });
    // On floor arrival the loot must spawn AFTER setLevel wipes the item
    // list (setLevel spawns it via pendingDayLoot), never before.
    if (spawnLoot) this._spawnDayLoot();
    else this.pendingDayLoot = true;
  }

  _spawnDayLoot() {
    const owned = new Set();
    for (const p of this.players.values()) for (const w of p.inv.w) owned.add(w);
    const pool = ['pack', 'grenade'];
    if (owned.has('shotgun')) pool.push('ammo_shotgun', 'ammo_shotgun');
    if (owned.has('smg')) pool.push('ammo_smg', 'ammo_smg');
    const count = 2;
    const half = CONFIG.PLAY_AREA / 2 - 2;
    for (let i = 0; i < count; i++) {
      const kind = pool[Math.floor(Math.random() * pool.length)];
      const pos = new THREE.Vector3(
        (Math.random() * 2 - 1) * half, 0, (Math.random() * 2 - 1) * half);
      resolveCircle(pos, 0.5, this.level.colliders);
      pos.y = this.level.heightAt(pos.x, pos.z);
      this.spawnItem(kind, pos);
    }
  }

  spawnItem(kind, pos) {
    const id = this.nextIid++;
    this.items.set(id, { id, kind, pos: pos.clone() });
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
    this.wave.nightInLevel++;
    // The wagon is a single-night set piece and has no elevator: once the
    // night is beaten, the ride simply arrives.
    const npl = this.level.type === 'wagon' ? 1 : TUNING.pacing.nightsPerLevel;
    if (this.wave.nightInLevel >= npl) {
      if (this.level.type === 'wagon' || !this.level.elevatorZone) {
        this._enterRide();
      } else {
        this.wave.phase = 'elevator';
        this.events.push({ e: 'elevator' });
      }
    } else {
      this._enterDay();
    }
  }

  _enterRide() {
    this.wave.phase = 'ride';
    this.wave.t = this.level.type === 'wagon' ? 6 : 20;
    for (const p of this.players.values()) p.ready = false;
    this.events.push({ e: 'ride' });
  }

  _arrive() {
    this.wave.level++;
    // A fresh floor revives anyone still down (they rode the elevator).
    for (const [id, p] of this.players) {
      if (p.down) {
        p.down = false; p.reviveT = 0;
        p.hp = TUNING.player.revivedAtHp;
        this.events.push({ e: 'revive', id, hp: p.hp });
      }
    }
    this.events.push({ e: 'level', index: this.wave.level });
    this._enterDay(false);
  }

  forceNight() {  // test hook
    if (this.wave.phase === 'lobby') this.startRun();
    if (this.wave.phase === 'day' || this.wave.phase === 'countdown') this._enterNight();
  }

  // ---- Combat ----------------------------------------------------------
  spawnZombie(type) {
    const spawns = this.level.zombieSpawns.length ? this.level.zombieSpawns : this.level.entries;
    if (!spawns.length) return;
    const s = spawns[Math.floor(Math.random() * spawns.length)];
    const id = this.nextZid++;
    const stats = TUNING.enemies[type];
    // Small jitter only: +-0.4 m keeps spawns inside 1.6 m doorways
    // (larger jitter put zombies behind tall walls where they got stuck).
    this.zombies.set(id, {
      id, type,
      pos: s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)),
      hp: stats.hp, alive: true,
      biteT: 0, targetId: null, retargetT: 0, stuckT: 0,
    });
    this.events.push({ e: 'zspawn', id });
  }

  // Hitscan: ray vs every living zombie's torso sphere, nearest first,
  // occluded by tall colliders. Returns the zombie hit or null.
  shootRay(origin, dir, damage = 1, byId = null) {
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
    const tall = this._tall();
    if (segmentBlocked(o.x, o.z, hit.x, hit.z, tall)) return null;
    this.damageZombie(best, damage, false, byId);
    return best;
  }

  // Back-compat alias (older callers/tests).
  shoot(o, d, damage = 1) { return this.shootRay(o, d, damage, 'H'); }

  _tall() {
    return this.level.collidersTall
      || (this.level.collidersTall = this.level.colliders.filter((c) => c.tall));
  }

  damageZombie(z, damage, isMelee, byId = null) {
    if (!z.alive) return;
    z.hp -= damage;
    if (z.hp <= 0) {
      z.alive = false;
      this.kills++;
      const scrap = TUNING.economy.scrapPerKill[z.type] + (isMelee ? TUNING.economy.meleeKillBonus : 0);
      const killer = byId ? this.players.get(byId) : null;
      if (killer) killer.inv.s += scrap;
      this.events.push({ e: 'zdie', id: z.id, type: z.type, p: z.pos.toArray(), scrap, by: byId });
      this.zombies.delete(z.id);
      this._maybeDrop(z);
    } else {
      this.events.push({ e: 'zhit', id: z.id });
    }
  }

  _maybeDrop(z) {
    const roll = Math.random();
    let kind = null;
    if (roll < 0.05) kind = 'grenade';
    else if (roll < 0.09) kind = 'pack';
    else if (roll < 0.17) {
      const owned = new Set();
      for (const p of this.players.values()) for (const w of p.inv.w) owned.add(w);
      const opts = [];
      if (owned.has('shotgun')) opts.push('ammo_shotgun');
      if (owned.has('smg')) opts.push('ammo_smg');
      if (opts.length) kind = opts[Math.floor(Math.random() * opts.length)];
    }
    if (kind) this.spawnItem(kind, z.pos);
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
        const P = TUNING.pacing;
        const players = Math.max(1, this.players.size);
        const interval = P.spawnInterval(wave.night) / TUNING.coopScaling.spawnIntervalDivisor(players);
        // Clamp the spawn debt: while the alive cap blocks spawning, the
        // timer must not accumulate a backlog that later dumps the whole
        // queue in one frame (keeps the trickle a trickle).
        wave.spawnT = Math.max(wave.spawnT - dt, -interval);
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
        const zone = this.level.elevatorZone;
        if (!zone) { this._enterRide(); break; }
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

    if (wave.phase === 'night' || wave.phase === 'elevator') this._stepZombies(dt);
    this._stepGrenades(dt);
    this._stepEffects(dt);
    this._stepMines(dt);
    this._stepPickups();

    // Proximity revives.
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
      // entry first. Low colliders block movement via pushout (slide).
      let goal = target.pos;
      const losBlocked = segmentBlocked(z.pos.x, z.pos.z, target.pos.x, target.pos.z, this._tall());
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
      // Bites require line of sight: a wall between mouth and target means
      // keep walking, never chew through the masonry.
      const canBite = goal === target.pos && dist <= reach && !losBlocked;
      if (!canBite) {
        const before = z.pos.clone();
        const to = goal.clone().sub(z.pos); to.y = 0;
        if (to.lengthSq() > 1e-6) {
          to.normalize().multiplyScalar(stats.speed * this._cloudSlowAt(z.pos) * dt);
          z.pos.add(to);
          resolveCircle(z.pos, stats.radius * 0.8, this.level.colliders);
        }
        z.biteT = 0;
        // Failsafe against any residual stuck case (pinned on geometry far
        // from everyone): after 8 s of no progress, re-enter via a doorway.
        const moved = z.pos.distanceToSquared(before);
        if (moved < (stats.speed * dt * 0.25) ** 2 && dist > 3) {
          z.stuckT += dt;
          if (z.stuckT > 8 && this.level.entries.length) {
            z.stuckT = 0;
            z.pos.copy(this.level.entries[Math.floor(Math.random() * this.level.entries.length)]);
          }
        } else {
          z.stuckT = 0;
        }
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

  _stepGrenades(dt) {
    for (const g of [...this.grenades.values()]) {
      g.vel.y -= 9.8 * dt;
      g.pos.addScaledVector(g.vel, dt);
      const floor = this.level.heightAt(g.pos.x, g.pos.z) + 0.12;
      let hitGround = false;
      if (g.pos.y < floor) {
        g.pos.y = floor;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.6; g.vel.z *= 0.6;
        hitGround = true;
      }
      g.fuse -= dt;
      // Molotovs shatter on first ground contact; frags and smokes cook.
      if ((g.kind === 'molotov' && hitGround) || g.fuse <= 0) {
        this.grenades.delete(g.id);
        this._detonate(g);
      }
    }
  }

  _detonate(g) {
    if (g.kind === 'smoke') {
      const S = TUNING.weapons.smokeGrenade;
      this.clouds.push({ pos: g.pos.clone(), t: S.cloudDuration });
      this.events.push({ e: 'smoke', p: g.pos.toArray(), d: S.cloudDuration });
      return;
    }
    if (g.kind === 'molotov') {
      const M = TUNING.weapons.molotov;
      this.fires.push({ pos: g.pos.clone(), t: M.burnDuration, tickT: 0 });
      this.events.push({ e: 'fire', p: g.pos.toArray(), d: M.burnDuration });
      return;
    }
    const G = TUNING.weapons.fragGrenade;
    this.events.push({ e: 'boom', p: g.pos.toArray() });
    for (const z of [...this.zombies.values()]) {
      const dist = z.pos.distanceTo(g.pos);
      if (dist > G.falloffRadius) continue;
      const dmg = G.damageCenter + (G.damageAtEdge - G.damageCenter) * (dist / G.falloffRadius);
      this.damageZombie(z, dmg, false, g.owner);
    }
    // Self damage for the thrower only (no friendly fire).
    const owner = this.players.get(g.owner);
    if (owner && !owner.down) {
      const dist = owner.pos.distanceTo(g.pos);
      if (dist < G.falloffRadius) {
        this.damagePlayer(g.owner, Math.round(G.selfDamage * (1 - dist / G.falloffRadius)));
      }
    }
  }

  // Smoke clouds slow, fires burn, drones scout.
  _stepEffects(dt) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      this.clouds[i].t -= dt;
      if (this.clouds[i].t <= 0) this.clouds.splice(i, 1);
    }
    const M = TUNING.weapons.molotov;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      f.tickT += dt;
      if (f.tickT >= 1) {
        f.tickT -= 1;
        for (const z of [...this.zombies.values()]) {
          if (z.pos.distanceTo(f.pos) <= M.burnRadius) this.damageZombie(z, M.dps, false, null);
        }
      }
      if (f.t <= 0) this.fires.splice(i, 1);
    }
    // Drones: fly to target, hover, ping the horde every 2 s.
    for (const d of [...this.drones.values()]) {
      if (d.phase === 'fly') {
        const to = d.target.clone().sub(d.pos);
        const dist = to.length();
        if (dist < 0.4) { d.phase = 'hover'; d.hoverT = 10; d.pingT = 0; }
        else d.pos.addScaledVector(to.normalize(), Math.min(dist, 8 * dt));
      } else {
        d.hoverT -= dt;
        d.pingT -= dt;
        if (d.pingT <= 0) {
          d.pingT = 2;
          let best = null, bd = Infinity;
          for (const z of this.zombies.values()) {
            const dz = z.pos.distanceToSquared(d.pos);
            if (dz < bd && dz < 81) { bd = dz; best = z; }
          }
          if (best) this.events.push({ e: 'ping', p: best.pos.toArray(), by: 'drone' });
        }
        if (d.hoverT <= 0) this.drones.delete(d.id);
      }
    }
  }

  _cloudSlowAt(pos) {
    for (const c of this.clouds) {
      if (pos.distanceToSquared(c.pos) < TUNING.weapons.smokeGrenade.cloudRadius ** 2) {
        return TUNING.weapons.smokeGrenade.slowFactor;
      }
    }
    return 1;
  }

  _stepMines(dt) {
    const M = TUNING.economy.mine;
    for (const mine of [...this.mines.values()]) {
      if (mine.armT > 0) { mine.armT -= dt; continue; }
      let tripped = false;
      for (const z of this.zombies.values()) {
        if (z.pos.distanceToSquared(mine.pos) < M.triggerRadius * M.triggerRadius) { tripped = true; break; }
      }
      if (!tripped) continue;
      this.mines.delete(mine.id);
      this.events.push({ e: 'boom', p: mine.pos.toArray() });
      for (const z of [...this.zombies.values()]) {
        if (z.pos.distanceTo(mine.pos) <= M.blastRadius) this.damageZombie(z, M.damage, false, mine.owner);
      }
    }
  }

  _stepPickups() {
    for (const item of [...this.items.values()]) {
      for (const [pid, p] of this.players) {
        if (p.down) continue;
        if (p.pos.distanceToSquared(item.pos) > 0.9 * 0.9) continue;
        if (!this._grant(p, item.kind)) continue;
        this.items.delete(item.id);
        this.events.push({ e: 'pickup', id: item.id, kind: item.kind, by: pid });
        break;
      }
    }
  }

  _grant(p, kind) {
    if (kind === 'pack') {
      if (p.inv.k >= 2) return false;
      p.inv.k++; return true;
    }
    if (kind === 'grenade') {
      if (p.inv.g >= 5) return false;
      p.inv.g++; return true;
    }
    const am = AMMO_PICKUP[kind];
    if (am) {
      const [w, amount] = am;
      if (!p.inv.w.includes(w)) return false;
      const a = p.inv.a[w];
      const max = TUNING.weapons[w].reserveMax;
      if (a[1] >= max) return false;
      a[1] = Math.min(max, a[1] + amount);
      return true;
    }
    return false;
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
        inv: p.inv,
      };
    }
    const zs = [];
    for (const z of this.zombies.values()) {
      zs.push([z.id, ZOMBIE_TYPES.indexOf(z.type),
        +z.pos.x.toFixed(2), +z.pos.y.toFixed(2), +z.pos.z.toFixed(2), z.hp]);
    }
    const gs = [];
    const GKINDS = ['frag', 'smoke', 'molotov'];
    for (const g of this.grenades.values()) {
      gs.push([g.id, +g.pos.x.toFixed(2), +g.pos.y.toFixed(2), +g.pos.z.toFixed(2), GKINDS.indexOf(g.kind || 'frag')]);
    }
    const ds = [];
    for (const d of this.drones.values()) {
      ds.push([d.id, +d.pos.x.toFixed(2), +d.pos.y.toFixed(2), +d.pos.z.toFixed(2)]);
    }
    const is = [];
    for (const item of this.items.values()) {
      is.push([item.id, ITEM_KINDS.indexOf(item.kind),
        +item.pos.x.toFixed(2), +item.pos.y.toFixed(2), +item.pos.z.toFixed(2)]);
    }
    const ms = [];
    for (const mine of this.mines.values()) {
      ms.push([mine.id, +mine.pos.x.toFixed(2), +mine.pos.y.toFixed(2), +mine.pos.z.toFixed(2)]);
    }
    const ev = this.events; this.events = [];
    const w = this.wave;
    return {
      t: 'snap', ts, players, zs, gs, is, ms, ds,
      wave: { ph: w.phase, n: w.night, lv: w.level, t: Math.max(0, Math.ceil(w.t)), left: w.left },
      ev,
    };
  }
}
