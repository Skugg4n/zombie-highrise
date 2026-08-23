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
import { levelTypeFor, FINAL_LEVEL, LEVEL_SIZE } from '../world/levelgen.js';
import { BASE_SIZE } from '../world/holdout.js';
import { levelInfoFor } from '../world/levels/index.js';
import { setDoorOpen } from '../world/traverse.js';
import { NavGrid } from './navgrid.js';
import { voidBlocker } from '../world/levelkit.js';
import { blockingFor, groundHeight } from './locomotion.js';

export const ZOMBIE_TYPES = ['walker', 'runner', 'brute', 'spitter', 'crawler', 'screamer', 'butcher'];
export const ITEM_KINDS = ['ammo_shotgun', 'ammo_smg', 'pack', 'grenade'];
// Drone payloads, indexed on the wire.
export const TRAP_KINDS = ['mine', 'tar', 'spike', 'lure'];
// The phases in which the world is actually running. Anything not here is
// a menu, a transition or an ending. Defined as an allow-list of RUNNING
// states rather than of combat states, so a new phase that forgets to
// mention itself simply does not run, rather than half-running.
export const LIVE_PHASES = new Set([
  'day', 'countdown', 'night', 'elevator', 'route', 'finale',
]);
// What a drone can be carrying on the wire. FETCH is a payload the drone
// leaves WITHOUT, so it needs its own slot: indexing it into TRAP_KINDS
// returned -1 and a fetch drone flew out slung with a mine crate.
export const DRONE_LOADS = ['mine', 'tar', 'spike', 'lure', 'fetch'];

const AMMO_PICKUP = { ammo_shotgun: ['shotgun', 25], ammo_smg: ['smg', 120] };

// ONE zombie row, used by the snapshot AND by the host's own rendering.
//
// These were two separate literals in two files, and adding a field to
// one of them silently left the other behind: the host saw zombies
// standing still while every client saw them hammering the wall, because
// the host built its rows by hand and never got the new column. A row
// shape written down twice is a row shape that will disagree.
//
// rounded: snapshots go over the wire, the host's own rows do not.
export function zombieRow(z, rounded = false) {
  const r = rounded ? (n) => +n.toFixed(2) : (n) => n;
  return [z.id, ZOMBIE_TYPES.indexOf(z.type),
    r(z.pos.x), r(z.pos.y), r(z.pos.z), z.hp, z.attacking ? 1 : 0];
}

export class HostSim {
  constructor(level) {
    this.level = level;
    this.players = new Map();
    this.zombies = new Map();
    this.grenades = new Map();
    this.items = new Map();
    this.mines = new Map();
    this.traps = new Map();      // drone-dropped field traps: tar, spikes, lures
    this.drones = new Map();
    this.barrels = new Map();
    this.clouds = [];          // smoke: {pos, t}
    this.fires = [];           // molotov: {pos, t, tickT}
    this.nextZid = 1;
    this.nextGid = 1;
    this.nextIid = 1;
    this.nextMid = 1;
    this.nextDid = 1;
    this.nextTid = 1;
    this.nextBid = 1;
    this.events = [];
    this.kills = 0;
    this.wave = {
      phase: 'lobby', night: 0, nightInLevel: 0, level: level.index,
      t: 0, queue: [], spawnT: 0, spawnCount: 0, left: 0,
    };
    this._seedBarrels();   // the boot level needs them too
  }

  setLevel(level) {
    this.level = level;
    this.wave.level = level.index;
    this.wave.nightInLevel = 0;
    this.zombies.clear();
    this.grenades.clear();
    this.items.clear();
    this.mines.clear();
    this.traps.clear();
    this.drones.clear();
    this.clouds.length = 0;
    this.traps.clear();
    this.fires.length = 0;
    this.level.nav = null;   // rebuild navigation for the new level
    this._seedBarrels();
    this.resetPlayers();
    // THE LEVEL DECIDES ITS OWN PHASE MACHINE, and it has to decide here.
    // _arrive() runs before the new geometry exists, so a check there is
    // asking the OLD level whether the NEW one has an objective. This is
    // the first moment the answer is knowable.
    if (this.level.objective === 'reach-exit') {
      // Unconditional: setLevel only runs on a level CHANGE, and a new
      // route deserves a fresh start, fresh supplies and zero progress.
      this._enterRoute();
    } else if (this.wave.phase === 'route') {
      this._enterDay(false);
    }
    if (this.pendingDayLoot) {
      this.pendingDayLoot = false;
      this._spawnDayLoot();
    }
  }

  // Explosive barrels come from the level generator; they respawn with
  // every new floor (and after a level restart).
  _seedBarrels() {
    this.barrels.clear();
    for (const b of (this.level.barrels || [])) {
      const id = this.nextBid++;
      const pos = new THREE.Vector3(b.x, this.level.heightAt(b.x, b.z), b.z);
      this.barrels.set(id, { id, pos, hp: 2 });
      this.level.colliders.push({ x: b.x, z: b.z, hx: 0.36, hz: 0.36, tall: false, barrel: id });
      this.level.collidersZ = null;
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
        k: 0, m: 2, nv: false,   // packs, mines (start with 2: traps are core), night vision
        s: TUNING.economy.startingScrap + bonus,
      },
    });
    this.events.push({ e: 'join', id, name: name || id });
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    // If the departed player was the last one standing, the run is over
    // for the downed survivors (otherwise: permanent softlock).
    const active = !['lobby', 'gameover', 'victory', 'finale'].includes(this.wave.phase);
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
      case 'door':
        if (typeof m.i === 'number' && this.level.doors && this.level.doors[m.i]) {
          if (setDoorOpen(this.level, m.i, true)) {
            this.level.nav = null;
            this._goodSpawns = null;
            this.events.push({ e: 'door', i: m.i });
          }
        }
        break;
      case 'repair':
        if (typeof m.i === 'number') this.repairBaseWall(id, m.i);
        break;
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

  // Mines are hand-placed from inventory, wherever you are standing,
  // whenever the world is running.
  //
  // This used to require the day or countdown phase, which meant a mine
  // could not be laid on a traverse level at all: a route has neither
  // phase, so the item sat in the inventory doing nothing and nothing
  // said why. The old rule was there to keep mines a preparation tool,
  // but the one-second arming delay already does that job, and laying a
  // mine in the corridor ahead of you is the whole tactic underground.
  // Noted in OPEN-QUESTIONS.md as a deliberate balance change.
  _actPlaceMine(id, p, m) {
    if (!Array.isArray(m.p)) return;
    const pos = new THREE.Vector3().fromArray(m.p);
    pos.y = this.level.heightAt(pos.x, pos.z);
    if ((p.inv.m || 0) <= 0) return;
    p.inv.m--;
    const mid = this.nextMid++;
    this.mines.set(mid, { id: mid, pos, armT: 1.0, owner: id });
    this.events.push({ e: 'mined', id: mid, by: id, p: pos.toArray() });
  }

  // THE DRONE is a delivery vehicle. It flies out over the field where the
  // squad cannot go, drops the payload it was sent with, and comes home.
  // Launching is free; you pay for what it carries.
  _actDrone(id, p, m) {
    if (!Array.isArray(m.p)) return;
    const kind = m.k || 'mine';
    // Fetching your own loot is not a purchase, so it is free. It still
    // costs you the drone's flight time, which is the real price.
    const cost = kind === 'fetch' ? 0 : TUNING.economy.dronePayload[kind];
    if (cost === undefined) return;
    if (p.inv.s < cost) { this.events.push({ e: 'nofunds', by: id, need: cost }); return; }
    p.inv.s -= cost;
    const did = this.nextDid++;
    const home = p.pos.clone().add(new THREE.Vector3(0, 3.5, 0));
    this.drones.set(did, {
      id: did, owner: id, phase: 'fly', payload: kind,
      pos: home.clone(), home,
      target: new THREE.Vector3(m.p[0], this.level.heightAt(m.p[0], m.p[2]) + 4.0, m.p[2]),
      dropT: 0, carrying: null,
    });
    this.events.push({ e: 'droned', by: id, k: kind });
  }

  // Payload hits the ground. Mines reuse the existing mine system so they
  // trip and explode exactly like a hand-placed one.
  _dropPayload(d) {
    // FETCH: grab the nearest field crate instead of dropping anything.
    // The crate rides home under the drone and lands inside the base.
    if (d.payload === 'fetch') {
      let best = null, bd = TUNING.economy.droneFetchRadius ** 2;
      for (const item of this.items.values()) {
        if (!item.field) continue;
        const dx = item.pos.x - d.target.x, dz = item.pos.z - d.target.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = item; }
      }
      if (best) {
        d.carrying = best.id;
        best.carried = true;
        // The one moment of the fetch errand that is worth watching: the
        // crate leaving the ground. Nothing announced it, so from the
        // base the drone flew out, hovered, and flew back, and you found
        // out whether it had worked when it landed.
        this.events.push({ e: 'grabbed', by: d.owner, p: best.pos.toArray() });
      } else {
        this.events.push({ e: 'fetchmiss', by: d.owner });
      }
      return;
    }
    const pos = d.target.clone();
    pos.y = this.level.heightAt(pos.x, pos.z);
    if (d.payload === 'mine') {
      const mid = this.nextMid++;
      this.mines.set(mid, { id: mid, pos, armT: 1.0, owner: d.owner });
      this.events.push({ e: 'mined', id: mid, by: d.owner, p: pos.toArray() });
      return;
    }
    const cfg = TUNING.traps[d.payload];
    if (!cfg) return;
    const tid = this.nextTid++;
    this.traps.set(tid, {
      id: tid, kind: d.payload, pos, owner: d.owner,
      t: cfg.duration, tickT: 0,
    });
    this.events.push({ e: 'trap', id: tid, kind: d.payload, p: pos.toArray() });
  }

  // Field traps: tar slows, spikes grind, a lure decides where the fight
  // happens. Only the lure touches targeting, and it does so by pretending
  // to be a player the horde wants more than you.
  _stepTraps(dt) {
    for (const tr of [...this.traps.values()]) {
      tr.t -= dt;
      const cfg = TUNING.traps[tr.kind];
      if (tr.kind === 'spike') {
        tr.tickT += dt;
        if (tr.tickT >= 1) {
          tr.tickT -= 1;
          for (const z of [...this.zombies.values()]) {
            if (z.alive && z.pos.distanceTo(tr.pos) <= cfg.radius) {
              this.damageZombie(z, cfg.dps, false, tr.owner);
            }
          }
        }
      }
      if (tr.t <= 0) {
        this.traps.delete(tr.id);
      }
    }
  }

  // Slow from tar patches, multiplied into the existing smoke slow.
  _tarSlowAt(pos) {
    let mult = 1;
    for (const tr of this.traps.values()) {
      if (tr.kind !== 'tar') continue;
      const cfg = TUNING.traps.tar;
      if (pos.distanceToSquared(tr.pos) <= cfg.radius * cfg.radius) mult = Math.min(mult, cfg.slow);
    }
    return mult;
  }

  // The strongest lure within range, or null. Zombies walk to it instead
  // of to a player, which is how you pull a wave into your minefield.
  _lureFor(pos) {
    const cfg = TUNING.traps.lure;
    let best = null, bd = cfg.radius * cfg.radius;
    for (const tr of this.traps.values()) {
      if (tr.kind !== 'lure') continue;
      const d2 = pos.distanceToSquared(tr.pos);
      if (d2 < bd) { bd = d2; best = tr; }
    }
    return best;
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
    this.events.push({ e: 'shot', id, w: m.w, o: m.o, d: m.d });
    const dir = new THREE.Vector3().fromArray(m.d).normalize();
    // ADS tightens the cone (client reports its aim state with the shot).
    const spreadScale = typeof m.sp === 'number' ? Math.max(0.15, Math.min(1, m.sp)) : 1;
    const spread = THREE.MathUtils.degToRad(def.spreadDeg || 0) * spreadScale;
    // Shotgun pellets shove their target (feel: weight and consequence).
    const knockback = m.w === 'shotgun' ? 0.5 : 0;
    for (let i = 0; i < (def.pellets || 1); i++) {
      const d = dir.clone();
      if (spread > 0) {
        d.x += (Math.random() - 0.5) * spread;
        d.y += (Math.random() - 0.5) * spread;
        d.z += (Math.random() - 0.5) * spread;
        d.normalize();
      }
      this.shootRay(m.o, d.toArray(), def.damage, id, knockback);
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
      fuse: kind === 'molotov' ? TUNING.weapons.molotov.airburstFuse : def.fuseTime,   // molotov pops on impact
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
    if (!['lobby', 'gameover', 'victory'].includes(this.wave.phase)) return;
    this.kills = 0;
    for (const p of this.players.values()) { p.hp = TUNING.player.maxHp; p.down = false; }
    this._enterDay();
  }

  // THE ONE PLACE A PLAYER IS PUT BACK ON THEIR FEET.
  //
  // Every restart and every level transition calls this. It used to be
  // done case by case, and a case-by-case reset is how a field gets
  // forgotten: restartLevel cleared `down` in the simulation and told
  // nobody, so the client's own downed flag stayed latched. You respawned
  // on the floor, unable to move or shoot, with the run effectively over
  // and the game saying nothing.
  //
  // `fullKit` also resets the loadout, for a brand new run.
  resetPlayers({ fullKit = false } = {}) {
    let i = 0;
    for (const [id, p] of this.players) {
      p.down = false;
      p.reviveT = 0;
      p.hp = TUNING.player.maxHp;
      p.ready = false;
      if (this.level && this.level.playerSpawns.length) {
        p.pos.copy(this.level.playerSpawns[i % this.level.playerSpawns.length]);
      }
      i++;
      if (fullKit) {
        p.inv.w = ['pistol', 'machete'];
        p.inv.active = 'pistol';
        p.inv.a = { pistol: [TUNING.weapons.pistol.magazine, -1] };
        p.inv.g = 1; p.inv.gs = 0; p.inv.gm = 0;
        p.inv.k = 0; p.inv.m = 0; p.inv.nv = false;
        p.inv.s = TUNING.economy.startingScrap;
      }
      // THE ARRIVAL POINT IS VERIFIED CLEAR before anyone stands on it.
      // Landing on a level and immediately taking damage from something
      // you cannot see is the worst first impression a level can make.
      this._clearArrival(p.pos);
      // TELL EVERYONE. A reset the client never hears about is the bug.
      this.events.push({ e: 'respawn', id, hp: p.hp, at: p.pos.toArray() });
    }
  }

  // Push anything already standing on an arrival point away from it. This
  // runs at placement time, when the horde may already exist: the spawn
  // radius alone cannot help with a body that walked there first.
  _clearArrival(pos) {
    const safe = TUNING.pacing.spawnSafeRadius;
    for (const z of this.zombies.values()) {
      if (!z.alive) continue;
      const dx = z.pos.x - pos.x, dz = z.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= safe * safe) continue;
      const d = Math.sqrt(d2) || 1;
      z.pos.x = pos.x + (dx / d) * (safe + 1.0);
      z.pos.z = pos.z + (dz / d) * (safe + 1.0);
      z.path = null;
      this._placeOnGround(z);
    }
  }

  restartLevel() {
    this.zombies.clear();
    this.grenades.clear();
    this.clouds.length = 0;
    this.traps.clear();
    this.fires.length = 0;
    this.drones.clear();
    this.kills = 0;   // per-attempt stats; meta counts each attempt once
    // Roll the night counter back to this level's first night. A death
    // MID-night already incremented wave.night without nightInLevel, so
    // count the in-progress night too (off-by-one found in review).
    this.wave.night -= this.wave.nightInLevel + (this.wave.nightStarted ? 1 : 0);
    this.wave.nightStarted = false;
    this.wave.nightInLevel = 0;
    this.resetPlayers();
    this._enterDay();
  }

  _enterDay(spawnLoot = true) {
    this.wave.phase = 'day';
    // PLAYTEST FIX: the day is no longer dead time. A daylight trickle
    // arrives while you prep, and the very first day is short so the run
    // starts fighting within seconds.
    const D = TUNING.pacing.dayRaid;
    const comingNight = this.wave.night + 1;
    const dayBudget = TUNING.waves.budgetPoints(comingNight) * D.budgetFrac
      * TUNING.coopScaling.budgetMultiplier(Math.max(1, this.players.size));
    this.wave.dayQueue = [];
    const dayCount = Math.max(2, Math.round(dayBudget));
    for (let i = 0; i < dayCount; i++) {
      this.wave.dayQueue.push(comingNight > 5 && i % 4 === 3 ? 'runner' : 'walker');
    }
    this.wave.daySpawnT = 1.2;   // the first one is already on its way
    this.dayBonus = this.postSurge;
    this.postSurge = false;
    // On the wagon the prep is short: you are already rolling. When called
    // from _arrive the local level object is still the OLD floor, so the
    // incoming floor's type comes from the level index instead.
    const type = spawnLoot ? this.level.type : levelTypeFor(this.wave.level);
    const firstEver = this.wave.night === 0;
    const base = firstEver ? TUNING.pacing.firstDayDuration
      : type === 'wagon' ? 10 : TUNING.pacing.dayPhaseDuration;
    this.wave.t = base + (this.dayBonus ? 10 : 0);
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
    // Drop loot near player spawn points: they are guaranteed walkable on
    // every level type (the old footprint-square sampling put wagon loot
    // on the ground beside the bed and trench loot inside dirt).
    const count = this.dayBonus ? 4 : 2;   // richer morning after a surge
    const spawns = this.level.playerSpawns;
    // ON A ROUTE, SUPPLIES ARE SPREAD ALONG THE WAY. Dumping them at the
    // arrival plate meant they were inside the pickup radius the instant
    // you landed and vanished into your pockets before you saw them.
    // Something to find as you advance is worth more than a free handful.
    const route = this.level.objective === 'reach-exit' && this.level.exitZone
      ? { from: this.level.playerSpawns[0], to: this.level.exitZone } : null;
    for (let i = 0; i < count; i++) {
      const kind = pool[Math.floor(Math.random() * pool.length)];
      let pos;
      if (route) {
        // Spaced down the diagonal, never in the first fifth of it.
        const t = 0.25 + 0.6 * ((i + 0.5) / count);
        pos = new THREE.Vector3(
          route.from.x + (route.to.x - route.from.x) * t,
          0,
          route.from.z + (route.to.z - route.from.z) * t);
        pos.x += (Math.random() * 2 - 1) * 1.4;
        pos.z += (Math.random() * 2 - 1) * 1.4;
        const nav = this._nav();
        if (nav) {
          const [cx, cz] = nav.nearestFree(pos.x, pos.z);
          pos.x = nav.worldX(cx);
          pos.z = nav.worldZ(cz);
        }
        resolveCircle(pos, 0.5, this.level.colliders);
        pos.y = this.level.heightAt(pos.x, pos.z);
        this.spawnItem(kind, pos);
        continue;
      }
      const base = spawns[Math.floor(Math.random() * spawns.length)];
      pos = base.clone().add(new THREE.Vector3(
        (Math.random() * 2 - 1) * 1.6, 0, (Math.random() * 2 - 1) * 1.6));
      resolveCircle(pos, 0.5, this.level.colliders);
      if (!this._reachable(pos)) pos.copy(this._nearestReachable(pos));
      pos.y = this.level.heightAt(pos.x, pos.z);
      this.spawnItem(kind, pos);
    }
  }

  spawnItem(kind, pos, field = false) {
    const id = this.nextIid++;
    this.items.set(id, { id, kind, pos: pos.clone(), field });
    if (field) this.events.push({ e: 'fielddrop', id, kind, p: pos.toArray() });
  }

  _enterCountdown() {
    this.wave.phase = 'countdown';
    this.wave.t = TUNING.pacing.nightIntroCountdown;
    this.events.push({ e: 'countdown', s: this.wave.t });
  }

  _enterNight() {
    const W = TUNING.waves;
    this.wave.night++;
    this.wave.nightStarted = true;
    const night = this.wave.night;
    const players = Math.max(1, this.players.size);

    // Night modifier roll (fog/frenzy/blackout/swarm/loot) from night 3.
    const M = TUNING.modifiers;
    this.mod = null;
    // A floor's scripted hook modifier wins: that is what gives the floor
    // its identity. Otherwise roll one.
    const hook = TUNING.floorHooks[this.wave.level];
    if (hook && hook.mod) {
      this.mod = hook.mod;
    } else if (night >= M.fromNight && Math.random() > M.chanceNone) {
      this.mod = M.list[Math.floor(Math.random() * M.list.length)];
    }
    // Surge nights: every 3rd night peaks hard, the following day breathes.
    this.surge = night % W.surgeEvery === 0;

    // Boss floor: the Butcher plus a thin walker escort, nothing else.
    if (this.level.type === 'boss') {
      this.mod = null;
      this.wave.phase = 'night';
      this.wave.queue = ['walker', 'walker', 'walker', 'walker', 'butcher'];
      this.wave.spawnT = 0;
      this.wave.spawnCount = 0;
      this.events.push({ e: 'night', n: night, boss: true });
      return;
    }

    let budget = W.budgetPoints(night)
      * (W.levelTypeModifier[this.level.type] || 1)
      * TUNING.coopScaling.budgetMultiplier(players);
    if (this.surge) budget *= W.surgeBudgetMult;
    if (this.mod === 'swarm') budget *= M.swarm.budgetMult;

    const mix = { ...W.mixWeights(night) };
    if (this.mod === 'frenzy') {
      mix.runner = (mix.runner || 0) + M.frenzy.runnerWeightAdd;
      mix.walker = Math.max(0.1, mix.walker - M.frenzy.runnerWeightAdd);
    }
    if (this.mod === 'swarm') {
      // A flood of weaklings: everything becomes walkers at 40% hp.
      for (const k of Object.keys(mix)) mix[k] = 0;
      mix.walker = 1;
    }
    const queue = [];
    for (const type of ZOMBIE_TYPES) {
      const count = Math.round(budget * (mix[type] || 0) / (W.threatCost[type] || 1));
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
    this.events.push({ e: 'night', n: night, mod: this.mod, surge: this.surge });
  }

  _nightCleared() {
    this.wave.nightInLevel++;
    this.wave.nightStarted = false;
    if (this.surge) this.postSurge = true;   // the day after a surge breathes
    this.mod = null;
    this.surge = false;
    // The wagon is a single-night set piece and has no elevator: once the
    // night is beaten, the ride simply arrives.
    const npl = (this.level.type === 'wagon' || this.level.type === 'boss') ? 1 : TUNING.pacing.nightsPerLevel;
    if (this.wave.nightInLevel >= npl) {
      // Beating the Butcher on the final floor ends the run: the roof
      // finale plays out and the survivors are extracted.
      if (this.wave.level >= FINAL_LEVEL) {
        this._enterFinale();
      } else if (this.level.type === 'wagon' || !this.level.elevatorZone) {
        this._enterRide();
      } else {
        this.wave.phase = 'elevator';
        this.events.push({ e: 'elevator' });
      }
    } else {
      this._enterDay();
    }
  }

  // ---- The ending -------------------------------------------------------
  // Roof finale: the elevator carries the squad to the roof, a helicopter
  // comes in, and the run is WON. Everyone still down is pulled aboard.
  _enterFinale() {
    this.wave.phase = 'finale';
    this.wave.t = TUNING.pacing.finaleDuration;
    for (const [id, p] of this.players) {
      if (p.down) {
        p.down = false; p.reviveT = 0;
        p.hp = TUNING.player.revivedAtHp;
        this.events.push({ e: 'revive', id, hp: p.hp });
      }
    }
    this.events.push({ e: 'finale' });
  }

  // Start a brand new run after a victory (kit and scrap reset).
  newRun() {
    this.zombies.clear();
    this.grenades.clear();
    this.clouds.length = 0;
    this.traps.clear();
    this.fires.length = 0;
    this.drones.clear();
    this.items.clear();
    this.mines.clear();
    this.traps.clear();
    this.kills = 0;
    this.mod = null;
    this.surge = false;
    this.wave.night = 0;
    this.wave.nightInLevel = 0;
    this.wave.nightStarted = false;
    this.wave.level = 1;
    this.resetPlayers({ fullKit: true });
    this.wave.phase = 'lobby';
    this.startRun();
  }

  _win() {
    this.wave.phase = 'victory';
    this.events.push({
      e: 'victory',
      stats: {
        nights: this.wave.night, kills: this.kills, level: this.wave.level,
        scrap: [...this.players.values()].reduce((n, p) => n + p.inv.s, 0),
      },
    });
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
    // The level's own data file names it. TUNING.floorHooks is the
    // fallback for floors that are still hand-written builders, and it
    // supplies the mechanical twist (`mod`) for every floor either way.
    // Without this the arrival card announced whatever floorHooks said and
    // silently ignored the spec, which its own comment claimed was the
    // single source.
    const info = levelInfoFor(this.wave.level) || TUNING.floorHooks[this.wave.level];
    this.events.push({
      e: 'level', index: this.wave.level,
      name: info ? info.name : null, note: info ? info.note : null,
    });
    // setLevel() decides the phase once the new geometry is in place; a
    // route level cannot be recognised from here, because `this.level` is
    // still the floor being left.
    this._enterDay(false);
  }

  forceNight(night) {  // test hook: jump straight into a night
    if (this.wave.phase === 'lobby') this.startRun();
    if (typeof night === 'number') this.wave.night = night - 1;
    if (['victory', 'gameover', 'finale'].includes(this.wave.phase)) return;
    this._enterNight();
  }

  // ---- Combat ----------------------------------------------------------
  spawnZombie(type, opts = {}) {
    const all = this.level.zombieSpawns.length ? this.level.zombieSpawns : this.level.entries;
    if (!all.length) return;
    const s = this._pickSpawn(all);
    const id = this.nextZid++;
    const stats = TUNING.enemies[type];
    // Small jitter only: +-0.4 m keeps spawns inside 1.6 m doorways
    // (larger jitter put zombies behind tall walls where they got stuck).
    let hpMult = this.mod === 'swarm' ? TUNING.modifiers.swarm.hpMult : 1;
    if (type === 'butcher') hpMult *= 1 + 0.5 * (Math.max(1, this.players.size) - 1);
    this.zombies.set(id, {
      id, type,
      pos: this._legalSpawnPos(s),
      hp: Math.max(1, Math.round(stats.hp * hpMult)), alive: true,
      biteT: 0, targetId: null, retargetT: 0, stuckT: 0,
      bestDist: Infinity, noProgressT: 0, rescues: 0,
      daylight: !!opts.daylight,
    });
  }

  // ---- The base wall (HOLDOUT levels) ----------------------------------

  // A zombie standing at an intact segment hits it on its bite timer.
  // Returns true when it spent this frame attacking rather than walking.
  _attackWall(z, stats, dt) {
    const wall = this.level.baseWall;
    // Generous on purpose: the nav grid inflates obstacles by the agent
    // radius, so a zombie's path ends about a metre short of the wall. A
    // tight reach left them milling just out of range, which read as the
    // wall being invincible.
    const reach = stats.radius + 1.25;
    let best = null, bd = reach * reach;
    for (const seg of wall.segments) {
      if (seg.dead) continue;
      const dx = z.pos.x - seg.x, dz = z.pos.z - seg.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = seg; }
    }
    if (!best) return false;
    // Only from OUTSIDE. Anything that got in through a breach should be
    // hunting players, not demolishing the wall from the wrong side.
    const c = this.level.baseCentre;
    if (c) {
      const inside = Math.abs(z.pos.x - c.x) < BASE_SIZE / 2 - 0.2 && Math.abs(z.pos.z - c.z) < BASE_SIZE / 2 - 0.2;
      if (inside) return false;
    }
    // Attacking is not being stuck. Without this the stuck escalation
    // relocates them away from the wall after four seconds and the base
    // never takes a scratch.
    z.stuckT = 0;
    z.path = null;
    // ATTACKING IS A STATE, NOT AN EVENT. Ola: "zombies attacking the
    // base just stand and stare while it breaks. They need an attack
    // animation readable from across the field." The wall attack pushed
    // no event at all, so nothing on any screen ever moved: the only clue
    // that the base was under attack was the integrity bar going down.
    // A per-bite event would give one twitch every 0.9 seconds, which is
    // not what hammering on a wall looks like either. This rides the
    // snapshot instead, so the animation runs for as long as it is true.
    z.attacking = true;
    z.biteT += dt;
    if (z.biteT >= stats.biteInterval) {
      z.biteT = 0;
      this.damageBaseWall(best.index, stats.biteDamage * TUNING.base.zombieWallMult, z.id);
    }
    return true;
  }

  // Host-authoritative. Clients apply the same change from the event, so
  // both peers see the same holes in the same places.
  damageBaseWall(index, amount, byZombie = null) {
    const wall = this.level.baseWall;
    if (!wall) return;
    const broke = wall.damage(index, amount);
    const seg = wall.segments[index];
    this.events.push({ e: 'wall', i: index, hp: seg.hp, broke: broke ? 1 : 0, z: byZombie });
    if (broke) {
      this.level.nav = null;         // the breach is a real route now
      this.level.collidersZ = null;
    }
    if (wall.integrity() <= TUNING.base.loseAt && this.wave.phase !== 'gameover') {
      this._baseLost();
    }
  }

  repairBaseWall(id, index) {
    const wall = this.level.baseWall;
    const p = this.players.get(id);
    if (!wall || !p) return;
    if (this.wave.phase !== 'day' && this.wave.phase !== 'countdown') return;
    const seg = wall.segments[index];
    if (!seg || seg.hp >= seg.maxHp) return;
    if (p.inv.s < TUNING.base.repairCost) return;
    p.inv.s -= TUNING.base.repairCost;
    const wasBreach = seg.dead;
    wall.repair(index, TUNING.base.repairAmount);
    this.events.push({ e: 'wall', i: index, hp: seg.hp, broke: 0, fix: 1 });
    if (wasBreach) { this.level.nav = null; this.level.collidersZ = null; }
  }


  _baseLost() {
    this.events.push({ e: 'baselost' });
    this.wave.phase = 'gameover';
    this.wave.t = 0;
    for (const p of this.players.values()) { p.down = true; p.hp = 0; }
  }

  // Escalating rescue for an enemy that is not closing on its target.
  // Stage 1 replans. Stage 2 relocates to the nearest open ground, which
  // clears geometry it has wedged itself into. Stage 3 puts it back at a
  // spawn point that is known to have a route, which is the guarantee
  // that no round can be lost to one unreachable enemy.
  _watchdog(z, stats, goal, dt) {
    const W = TUNING.pacing.watchdog;
    const d = z.pos.distanceTo(goal);
    // Anything within reach of its goal is doing its job by definition.
    if (d <= stats.radius + 2.0) { z.bestDist = d; z.noProgressT = 0; return; }
    // Real progress only: a wobble back and forth must not reset the timer.
    if (d < z.bestDist - W.progressEpsilon) {
      z.bestDist = d;
      z.noProgressT = 0;
      return;
    }
    z.noProgressT += dt;
    if (z.noProgressT < W.patience) return;
    z.noProgressT = 0;
    z.rescues++;
    const nav = this._nav();
    if (z.rescues === 1) {
      z.path = null; z.pathT = 0;          // stage 1: think again
      z.bestDist = d;
      return;
    }
    if (z.rescues === 2 && nav) {
      const [cx, cz] = nav.nearestFree(z.pos.x, z.pos.z);   // stage 2: unwedge
      z.pos.x = nav.worldX(cx);
      z.pos.z = nav.worldZ(cz);
      z.path = null;
      z.bestDist = z.pos.distanceTo(goal);
      return;
    }
    // Stage 3: send it back to a spawn that demonstrably has a route in.
    // Its old position was a dead end, so anywhere legal is an upgrade.
    const from = this._reachableSpawn(goal);
    if (from) {
      z.pos.copy(this._legalSpawnPos(from));
    }
    z.path = null;
    z.rescues = 0;
    z.bestDist = z.pos.distanceTo(goal);
  }

  // A spawn point with a real path to `goal`, cached per level because it
  // is the same answer every time and A* is not free.
  _reachableSpawn(goal) {
    const list = this.level.zombieSpawns.length ? this.level.zombieSpawns : this.level.entries;
    if (!list.length) return null;
    const nav = this._nav();
    if (!nav) return list[0];
    if (!this.level._goodSpawns) {
      this.level._goodSpawns = list.filter((s) => {
        const path = nav.findPath(s.x, s.z, goal.x, goal.z);
        if (!path || !path.length) return false;
        const end = path[path.length - 1];
        // A partial path that stops far short is not a route.
        return Math.hypot(end.x - goal.x, end.z - goal.z) < 8;
      });
      if (!this.level._goodSpawns.length) this.level._goodSpawns = list.slice();
    }
    const good = this.level._goodSpawns;
    return good[Math.floor(Math.random() * good.length)];
  }

  // WHICH RING DOES THIS ONE COME FROM?
  //
  // A level may tag its spawn points near / mid / far. Wave 1 draws from
  // the near ring so the level opens within seconds instead of a minute
  // of watching an empty field, and later waves widen out so you get both
  // the thing already on you and the thing you can see gathering.
  //
  // Levels with no rings behave exactly as before.
  _pickSpawn(all) {
    const wave = Math.max(1, this.wave.night || 1);
    const mix = wave <= 1 ? { near: 1.0, mid: 0.0, far: 0.0 }
      : wave === 2 ? { near: 0.6, mid: 0.4, far: 0.0 }
      : wave <= 4 ? { near: 0.4, mid: 0.4, far: 0.2 }
      : { near: 0.3, mid: 0.35, far: 0.35 };
    const want = (() => {
      const r = Math.random();
      if (r < mix.near) return 'near';
      if (r < mix.near + mix.mid) return 'mid';
      return 'far';
    })();
    const inRing = all.filter((p) => p.ring === want);
    const pool = inRing.length ? inRing : all;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // The underground mix. No spitters and no screamers: both want distance
  // and there is none down here, so they would simply be walkers with
  // extra steps.
  _routeEnemy() {
    const r = Math.random();
    if (r < 0.14) return 'brute';
    if (r < 0.42) return 'crawler';
    if (r < 0.66) return 'runner';
    return 'walker';
  }

  // A spawn point is authored to sit BEHIND a sight blocker, and "behind"
  // is easy to get slightly wrong: a metre out and the point is inside the
  // house rather than behind it. A zombie born inside a prop cannot path
  // out, and one unreachable zombie leaves the wave counter stuck forever.
  //
  // So the position is snapped to open ground before anything is created.
  // The jitter is applied first and the snap second, so a crowd still
  // spreads out but nobody starts inside a wall.
  _legalSpawnPos(s) {
    const p = s.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8));
    const nav = this._nav();
    if (nav) {
      const [cx, cz] = nav.nearestFree(p.x, p.z);
      p.x = nav.worldX(cx);
      p.z = nav.worldZ(cz);
    }
    // NOBODY SPAWNS IN YOUR LAP. Ola took damage every second at his
    // arrival point and died without ever seeing what hit him, because
    // something was born on top of him. A spawn inside the safe radius is
    // pushed straight out along the line away from the nearest player, so
    // whatever arrives is at least visible before it reaches you.
    const safe = TUNING.pacing.spawnSafeRadius;
    for (let tries = 0; tries < 4; tries++) {
      let worst = null, wd = safe * safe;
      for (const q of this.players.values()) {
        if (q.down) continue;
        const dx = p.x - q.pos.x, dz = p.z - q.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < wd) { wd = d2; worst = q; }
      }
      if (!worst) break;
      const dx = p.x - worst.pos.x, dz = p.z - worst.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      p.x = worst.pos.x + (dx / d) * (safe + 0.5);
      p.z = worst.pos.z + (dz / d) * (safe + 0.5);
      if (nav) {
        const [cx, cz] = nav.nearestFree(p.x, p.z);
        p.x = nav.worldX(cx);
        p.z = nav.worldZ(cz);
      }
    }
    const gy = groundHeight(this.level, p.x, p.z, Infinity);
    p.y = Number.isFinite(gy) ? gy : (this.level.baseY || 0);
    return p;
  }

  // Hitscan: ray vs every living zombie's torso sphere, nearest first,
  // occluded by tall colliders. Returns the zombie hit or null.
  shootRay(origin, dir, damage = 1, byId = null, knockback = 0) {
    const o = new THREE.Vector3().fromArray(origin);
    const d = new THREE.Vector3().fromArray(dir).normalize();
    let best = null, bestT = Infinity, bestHead = false;
    for (const z of this.zombies.values()) {
      if (!z.alive) continue;
      const stats = TUNING.enemies[z.type];
      const r = stats.radius;
      const bodyY = z.type === 'brute' || z.type === 'butcher' ? 1.2 : 1.1;
      const headY = z.type === 'butcher' ? 1.72 : z.type === 'brute' ? 1.42
        : z.type === 'crawler' ? 0.55 : 1.52;
      // Head first: a smaller sphere sitting on top of the torso.
      const head = z.pos.clone(); head.y += headY;
      const ho = head.sub(o);
      const ht = ho.dot(d);
      let hit = false, isHead = false, hitT = Infinity;
      if (ht > 0 && ht < 200 && ho.lengthSq() - ht * ht <= 0.3 * 0.3) {
        hit = true; isHead = true; hitT = ht;
      }
      if (!hit) {
        const centre = z.pos.clone(); centre.y += bodyY;
        const oc = centre.sub(o);
        const t = oc.dot(d);
        if (t > 0 && t < 200 && oc.lengthSq() - t * t <= r * r) { hit = true; hitT = t; }
      }
      if (!hit) continue;
      if (hitT < bestT) { bestT = hitT; best = z; bestHead = isHead; }
    }
    // Barrels are shootable too: nearest hit wins.
    let barrelHit = null, barrelT = Infinity;
    for (const b of this.barrels.values()) {
      const centre = b.pos.clone(); centre.y += 0.55;
      const oc = centre.sub(o);
      const t = oc.dot(d);
      if (t < 0 || t > 200) continue;
      if (oc.lengthSq() - t * t > 0.42 * 0.42) continue;
      if (t < barrelT) { barrelT = t; barrelHit = b; }
    }
    if (barrelHit && barrelT < (best ? bestT : Infinity)) {
      const hp = o.clone().addScaledVector(d, barrelT);
      if (!segmentBlocked(o.x, o.z, hp.x, hp.z, this._tall())) {
        this._damageBarrel(barrelHit, damage, byId);
        return null;
      }
    }
    // Mines are shootable, once armed. A trap you can set off from cover
    // is a tool; one that only a zombie standing on it can trigger is a
    // gamble. Unarmed mines are ignored so you cannot shoot one out of
    // your own hand as you place it. Small target on purpose: 0.3 m, so
    // this is a deliberate shot and never a stray one.
    let mineHit = null, mineT = Infinity;
    for (const mn of this.mines.values()) {
      if (mn.armT > 0) continue;
      const centre = mn.pos.clone(); centre.y += 0.14;
      const oc = centre.sub(o);
      const t = oc.dot(d);
      if (t < 0 || t > 200) continue;
      if (oc.lengthSq() - t * t > 0.3 * 0.3) continue;
      if (t < mineT) { mineT = t; mineHit = mn; }
    }
    if (mineHit && mineT < (best ? bestT : Infinity)) {
      const hp = o.clone().addScaledVector(d, mineT);
      if (!segmentBlocked(o.x, o.z, hp.x, hp.z, this._tall())) {
        this.detonateMine(mineHit, byId);
        return null;
      }
    }
    if (!best) return null;
    const hit = o.clone().addScaledVector(d, bestT);
    const tall = this._tall();
    if (segmentBlocked(o.x, o.z, hit.x, hit.z, tall)) return null;
    if (best.type === 'butcher') {
      const t = this._nearestStanding(best.pos);
      if (t) {
        const facing = new THREE.Vector3().subVectors(t.p.pos, best.pos).setY(0).normalize();
        if (facing.dot(d) > 0.4) {
          damage *= TUNING.enemies.butcher.backstabMult;   // weak back plate
          this.events.push({ e: 'crit', id: best.id });
        }
      }
    }
    if (knockback > 0) {
      const shove = knockback * (best.type === 'brute' ? 0.5 : 1);
      best.pos.addScaledVector(new THREE.Vector3(d.x, 0, d.z).normalize(), shove);
      resolveCircle(best.pos, TUNING.enemies[best.type].radius * 0.8, this._zColliders(best.pos.y));
      best.stunT = Math.max(best.stunT || 0, 0.3);   // a visible pause: weight
    }
    if (bestHead) {
      damage *= TUNING.weapons.headshotMult;
      this.events.push({ e: 'head', id: best.id, by: byId, p: best.pos.toArray() });
    }
    this.damageZombie(best, damage, false, byId);
    return best;
  }


  _tall() {
    return this.level.collidersTall
      || (this.level.collidersTall = this.level.colliders.filter((c) => c.tall));
  }

  // Colliders the HORDE obeys: player-only barriers are invisible to them
  // (they are there to stop the player walking off an open edge), and a
  // platform low enough to step onto must not eject them either.
  _zColliders(y = 0) {
    const base = this.level.collidersZ
      || (this.level.collidersZ = this.level.colliders.filter((c) => !c.playerOnly));
    return blockingFor(this.level, y, base);
  }

  damageZombie(z, damage, isMelee, byId = null) {
    if (!z.alive) return;
    z.hp -= damage;
    if (z.hp <= 0) {
      z.alive = false;
      this.kills++;
      let scrap = TUNING.economy.scrapPerKill[z.type] || TUNING.enemies[z.type].scrap || 10;
      scrap += isMelee ? TUNING.economy.meleeKillBonus : 0;
      if (this.mod === 'loot') scrap = Math.round(scrap * TUNING.modifiers.loot.scrapMult);
      const killer = byId ? this.players.get(byId) : null;
      if (killer) killer.inv.s += scrap;
      const die = { e: 'zdie', id: z.id, type: z.type, p: z.pos.toArray(), scrap, by: byId };
      if (z.blast) die.v = z.blast;
      this.events.push(die);
      this.zombies.delete(z.id);
      this._maybeDrop(z);
    } else {
      this.events.push({ e: 'zhit', id: z.id, by: byId });
    }
  }

  // A barrel takes 2 damage to pop, then detonates like a big grenade and
  // chains into other barrels in range.
  _damageBarrel(b, damage, byId, depth = 0) {
    if (!this.barrels.has(b.id)) return;
    b.hp -= damage;
    if (b.hp > 0) {
      this.events.push({ e: 'bhit', id: b.id });
      return;
    }
    this.barrels.delete(b.id);
    const idx = this.level.colliders.findIndex((c) => c.barrel === b.id);
    if (idx >= 0) this.level.colliders.splice(idx, 1);
    this.level.collidersTall = null;   // cached lists are stale now
    this.level.collidersZ = null;
    this.level.nav = null;             // a popped barrel opens a route
    this.events.push({ e: 'bboom', id: b.id, p: b.pos.toArray() });
    const R = TUNING.economy.barrel.blastRadius;
    for (const z of [...this.zombies.values()]) {
      const dist = z.pos.distanceTo(b.pos);
      if (dist > R) continue;
      const push = new THREE.Vector3(z.pos.x - b.pos.x, 0, z.pos.z - b.pos.z).normalize()
        .multiplyScalar(3.0 * (1 - dist / R) + 0.8);
      z.blast = [push.x, push.z];
      this.damageZombie(z, TUNING.economy.barrel.damage * (1 - dist / R * 0.6), false, byId);
      z.blast = null;
    }
    for (const [pid, p] of this.players) {
      if (p.down) continue;
      const dist = p.pos.distanceTo(b.pos);
      if (dist < R * 0.7) this.damagePlayer(pid, Math.round(20 * (1 - dist / (R * 0.7))));
    }
    // Chain reaction (bounded depth so a barrel farm cannot recurse away).
    // Mines count: a barrel going off next to a minefield sets the whole
    // field off, which is the point of putting them there.
    if (depth < 4) {
      for (const other of [...this.barrels.values()]) {
        if (other.pos.distanceTo(b.pos) <= R * 1.1) {
          this._damageBarrel(other, 99, byId, depth + 1);
        }
      }
      for (const mine of [...this.mines.values()]) {
        if (mine.pos.distanceTo(b.pos) <= R) this.detonateMine(mine, byId, depth + 1);
      }
    }
  }

  _maybeDrop(z) {
    const roll = Math.random() / (this.mod === 'loot' ? TUNING.modifiers.loot.dropMult : 1);
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
    if (!kind) return;
    // LOOT YOU CANNOT REACH IS NOT LOOT. On a holdout level most zombies
    // die out in the field, which the squad is deliberately confined out
    // of. A drop there used to be litter you could see and never touch.
    //
    // Close kills fall inside the base. Distant ones become a FIELD CRATE
    // with a beacon, and fetching it is the drone's second real job
    // alongside placing traps.
    if (this._reachable(z.pos)) { this.spawnItem(kind, z.pos); return; }
    const home = this._nearestReachable(z.pos);
    if (home && z.pos.distanceTo(home) < TUNING.economy.lootFallsInsideWithin) {
      this.spawnItem(kind, home);
    } else {
      this.spawnItem(kind, z.pos, true);
    }
  }

  // Can a player walk to this? Only a level that CONFINES the squad has
  // unreachable ground, and only a holdout does that: its wall is the
  // boundary and the drone is how you touch the field beyond it.
  //
  // ARCHETYPE PARITY: this used to answer from baseCentre and
  // playableHalf, which a traverse also sets. So on a traverse a kill in
  // the corner of the room dropped a FIELD CRATE, which only a drone can
  // fetch, and the drone cannot fly underground. The loot was gone
  // forever and nothing said why.
  _reachable(pos) {
    if (!this.level.confined) return true;
    const c = this.level.baseCentre;
    const half = this.level.playableHalf;
    if (!c || !half) return true;
    return Math.abs(pos.x - c.x) <= half && Math.abs(pos.z - c.z) <= half;
  }

  // The closest point inside the playable area to `pos`, so a kill just
  // outside the wall drops its loot just inside it.
  _nearestReachable(pos) {
    const c = this.level.baseCentre;
    const half = this.level.playableHalf;
    if (!c || !half) return pos.clone();
    const inset = half - 0.7;
    const p = pos.clone();
    p.x = Math.max(c.x - inset, Math.min(p.x, c.x + inset));
    p.z = Math.max(c.z - inset, Math.min(p.z, c.z + inset));
    p.y = this.level.heightAt(p.x, p.z);
    return p;
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

  // A ROUTE level has no clock. "Movement forward is the objective, not
  // survival timers. Waves come because you ADVANCE, not because a clock
  // ticks." (docs/level-design.md)
  _enterRoute() {
    const wave = this.wave;
    wave.phase = 'route';
    wave.night = 1;
    wave.t = 0;
    wave.left = 0;
    wave.queue = [];
    wave.spawnT = 0;
    wave.pushed = 0;             // how many pushes the squad has triggered
    wave.reached = 0;            // furthest fraction of the route reached
    wave.exitT = 0;
    this.mod = null;
    // ARCHETYPE PARITY: supplies are handed out by _enterDay, and a route
    // level has no day. Without this a traverse started you with whatever
    // you walked in with and offered nothing on the floor.
    this._spawnDayLoot();
    this.events.push({ e: 'route' });
  }

  // How far along the route the squad has got, 0 at the arrival plate and
  // 1 at the exit. Measured on the leading player: the squad advances
  // together or the person in front pays for it.
  _routeProgress() {
    const from = this.level.hordeAnchor;
    const to = this.level.exitZone;
    if (!from || !to) return 0;
    const total = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    let best = 0;
    for (const p of this.players.values()) {
      if (p.down) continue;
      const along = Math.hypot(p.pos.x - from.x, p.pos.z - from.z) / total;
      best = Math.max(best, Math.min(1, along));
    }
    return best;
  }

  // ---- Frame step ------------------------------------------------------
  step(dt) {
    const wave = this.wave;
    switch (wave.phase) {
      case 'route': {
        // Leaving a route level by any path other than its exit (a debug
        // jump, a level swap) must not strand the phase machine here:
        // without an exit zone there is nothing for this phase to do.
        if (!this.level.exitZone) { this._enterDay(false); break; }
        // NO WAVE DIRECTOR HERE. A traverse is a route from A to B where
        // you clear what stands in the way, not a siege you survive. The
        // wave counter, the night number and the modifier all stay out of
        // it: what is on the level is what you have to get past.
        const T = TUNING.pacing.route;
        // ADVANCING is what summons them. Cross a quarter of the room and
        // the holes answer; stand still and the pressure stays where you
        // left it, which is the whole difference from a holdout.
        const progress = this._routeProgress();
        if (progress > wave.reached) wave.reached = progress;
        const wantPushes = Math.floor(wave.reached / T.pushEvery);
        while (wave.pushed < wantPushes) {
          wave.pushed++;
          const players = Math.max(1, this.players.size);
          const n = Math.round(T.perPush * players * (1 + wave.pushed * 0.35));
          for (let i = 0; i < n; i++) wave.queue.push(this._routeEnemy());
          this.events.push({ e: 'push', n: wave.pushed });
        }
        // A slow background trickle, so standing still is uncomfortable
        // without being a death sentence.
        wave.spawnT -= dt;
        if (wave.spawnT <= 0) {
          wave.spawnT = T.trickle;
          if (this.zombies.size < T.maxAlive) wave.queue.push(this._routeEnemy());
        }
        while (wave.queue.length && this.zombies.size < T.maxAlive) {
          this.spawnZombie(wave.queue.pop());
        }
        wave.left = this.zombies.size;

        // Standing on the exit plate finishes the level. It takes a beat,
        // so it cannot happen by brushing past it while running.
        const zone = this.level.exitZone;
        let onPlate = false;
        for (const p of this.players.values()) {
          if (p.down) continue;
          if (Math.abs(p.pos.x - zone.x) <= zone.hx && Math.abs(p.pos.z - zone.z) <= zone.hz) {
            onPlate = true;
            break;
          }
        }
        wave.exitT = onPlate ? wave.exitT + dt : 0;
        if (wave.exitT >= T.boardSeconds) this._enterRide();
        break;
      }
      case 'day': {
        wave.t -= dt;
        // Daylight raid: a slow steady trickle through the same visible
        // entrances the night horde uses.
        const D = TUNING.pacing.dayRaid;
        if (wave.dayQueue && wave.dayQueue.length && this.zombies.size < D.maxAlive) {
          wave.daySpawnT -= dt;
          if (wave.daySpawnT <= 0) {
            wave.daySpawnT = D.interval;
            this.spawnZombie(wave.dayQueue.pop(), { daylight: true });
          }
        }
        if (wave.t <= 0) this._enterCountdown();
        break;
      }
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
      case 'finale':
        wave.t -= dt;
        if (wave.t <= 0) this._win();
        break;
      default:
        break;
    }

    // THE HORDE MOVES WHENEVER THE GAME IS LIVE.
    //
    // This used to name two phases, 'night' and 'elevator'. Every phase
    // added since has silently omitted the horde: daylight raiders froze
    // where they spawned, and on a route level nothing moved at all, which
    // read as "zombies do not attack on L2". They attacked fine; they were
    // never stepped.
    //
    // A list of phases where enemies DO move is a list that gets forgotten.
    // A list of phases where the game is not running is short and stable.
    if (LIVE_PHASES.has(wave.phase)) this._stepZombies(dt);
    this._stepGrenades(dt);
    this._stepEffects(dt);
    this._stepMines(dt);
    this._stepTraps(dt);
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

    // NO DEAD AIR (playtest): if the player has nothing to fight and
    // nothing scheduled, bring the next beat forward.
    const nothingHappening = this.zombies.size === 0
      && !(wave.dayQueue && wave.dayQueue.length)
      && !wave.queue.length;
    if (wave.phase === 'day' && nothingHappening) {
      this.idleT = (this.idleT || 0) + dt;
      if (this.idleT > TUNING.pacing.maxIdleSeconds && wave.t > 2.5) {
        wave.t = 2.5;                     // skip straight to the countdown
      }
    } else {
      this.idleT = 0;
    }

    wave.left = wave.queue.length + this.zombies.size
      + ((wave.dayQueue && wave.dayQueue.length) || 0);
  }

  // ---- The horde brain --------------------------------------------------
  // Rebuilt after the playtest. Every agent follows a real A* path over the
  // level's navigation grid, re-planned on a budget, with string-pulling so
  // movement looks like walking rather than grid-stepping, plus separation
  // so a crowd spreads across a breach instead of jamming into one point.
  _stepZombies(dt) {
    this._planBudget = 6;   // A* searches allowed per frame (cost control)
    for (const z of this.zombies.values()) {
      const stats = TUNING.enemies[z.type];
      // GROUND FIRST, before any branch can `continue` past it. A body
      // standing over a void with no path returned no steering and skipped
      // the rest of the loop, so it hovered in the chasm forever. Whatever
      // else happens this frame, it happens on solid ground.
      this._placeOnGround(z);
      if (z.stunT > 0) { z.stunT -= dt; continue; }
      if (z.type === 'spitter' && this._stepSpitter(z, stats, dt)) continue;
      if (z.type === 'screamer' && this._stepScreamer(z, stats, dt)) continue;
      if (z.type === 'butcher' && this._stepButcher(z, stats, dt)) continue;

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

      // A lure outranks the player it was thrown for: this is how the
      // squad decides WHERE the wave dies when they cannot go out there.
      const lure = this._lureFor(z.pos);
      const goal = lure ? lure.pos : target.pos;

      const dist = z.pos.distanceTo(target.pos);
      const losBlocked = segmentBlocked(z.pos.x, z.pos.z, target.pos.x, target.pos.z, this._tall());

      let speedMult = this._cloudSlowAt(z.pos) * this._tarSlowAt(z.pos);
      if (z.daylight) speedMult *= TUNING.pacing.dayRaid.speedMult;
      if (z.type === 'crawler' && dist < stats.lungeRange) {
        speedMult *= stats.lungeSpeed / stats.speed;
      }
      if (z.type === 'runner' && this.mod === 'frenzy') {
        speedMult *= TUNING.modifiers.frenzy.runnerSpeedMult;
      }

      const reach = stats.radius + 0.55;
      // Attack whatever is in front: the player if reachable, otherwise
      // the barricade in the way (bases are meant to be broken into).
      if (dist <= reach && !losBlocked) {
        z.biteT += dt;
        z.path = null;
        if (z.biteT >= stats.biteInterval) {
          z.biteT = 0;
          this.events.push({ e: 'bite', id: z.id });
          this.damagePlayer(z.targetId, stats.biteDamage);
        }
        continue;
      }

      // HOLDOUT: no player in reach, but the base wall might be. A walled
      // base would otherwise be a permanent safe box; chewing through it
      // IS the level. The pathfinder already walks them to the wall
      // because a sealed perimeter leaves no route in, so this is simply
      // "what do you do when you arrive".
      if (this.level.baseWall && this._attackWall(z, stats, dt)) continue;
      z.attacking = false;         // walking again: drop the hammer pose
      z.biteT = 0;

      const steer = this._navSteer(z, stats, goal, dt);
      if (!steer) continue;

      // Separation: push apart from close neighbours so the horde spreads
      // along a wall or through a breach instead of stacking on one cell.
      let sx = 0, sz = 0;
      const sepR = stats.radius * 2.1;
      for (const o of this.zombies.values()) {
        if (o === z) continue;
        const dx = z.pos.x - o.pos.x, dz = z.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > sepR * sepR || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (sepR - d) / sepR;
        sx += (dx / d) * push;
        sz += (dz / d) * push;
      }
      const sepLen = Math.hypot(sx, sz);
      if (sepLen > 0) {
        sx = (sx / sepLen) * Math.min(1, sepLen);
        sz = (sz / sepLen) * Math.min(1, sepLen);
      }

      // Blend path direction with separation, then move.
      const SEP_W = 0.55;
      let mx = steer.x + sx * SEP_W;
      let mz = steer.z + sz * SEP_W;
      const mlen = Math.hypot(mx, mz);
      if (mlen < 1e-6) continue;
      mx /= mlen; mz /= mlen;

      const step = stats.speed * speedMult * dt;
      const beforeX = z.pos.x, beforeZ = z.pos.z;
      z.pos.x += mx * step;
      z.pos.z += mz * step;
      resolveCircle(z.pos, stats.radius * 0.8, this._zColliders(z.pos.y));
      this._placeOnGround(z);

      // WATCHDOG. Moving is not the same as getting anywhere: a zombie
      // shut inside a house can circle its rooms forever and never look
      // stuck. What matters is whether it is closing on its target, and
      // one enemy that never arrives makes the whole round unwinnable
      // (this is the same class of bug as the wave counter freezing at
      // "1 left"), so it is solved here at the system level rather than
      // per level.
      this._watchdog(z, stats, goal, dt);

      // Stuck detection: if pushout keeps eating the movement, force a
      // replan; if that fails too, sidestep. An agent must NEVER freeze.
      const moved = Math.hypot(z.pos.x - beforeX, z.pos.z - beforeZ);
      if (moved < step * 0.3) {
        z.stuckT += dt;
        if (z.stuckT > 0.5) {
          z.path = null; z.pathT = 0;
          // Slide along the wall rather than grinding into it.
          z.pos.x += -mz * step * 0.9;
          z.pos.z += mx * step * 0.9;
          resolveCircle(z.pos, stats.radius * 0.8, this._zColliders(z.pos.y));
          this._placeOnGround(z);
        }
        if (z.stuckT > 4) {
          // Last resort: teleport to the nearest legal cell. Being briefly
          // wrong is better than a zombie welded to a corner forever.
          z.stuckT = 0;
          const nav = this._nav();
          if (nav) {
            const [cx, cz] = nav.nearestFree(z.pos.x, z.pos.z);
            z.pos.x = nav.worldX(cx);
            z.pos.z = nav.worldZ(cz);
          }
        }
      } else {
        z.stuckT = 0;
      }
    }
    this._separateBodies();
  }

  // THE ONE WAY A BODY IS PUT ON THE GROUND.
  //
  // There were three copies of this and only one of them handled a void,
  // so a zombie pushed over the chasm stood on thin air at floor level.
  // Anything over nothing gets moved to the nearest real ground, because
  // the alternative is a body hovering in a hole.
  _placeOnGround(z) {
    const gy = groundHeight(this.level, z.pos.x, z.pos.z, z.pos.y);
    if (Number.isFinite(gy)) { z.pos.y = gy; return; }
    const nav = this._nav();
    if (nav) {
      const [cx, cz] = nav.nearestFree(z.pos.x, z.pos.z);
      z.pos.x = nav.worldX(cx);
      z.pos.z = nav.worldZ(cz);
      z.path = null;
    }
    const gy2 = groundHeight(this.level, z.pos.x, z.pos.z, Infinity);
    z.pos.y = Number.isFinite(gy2) ? gy2 : (this.level.baseY || 0);
  }

  // Steering separation is a suggestion: it biases where an agent WANTS
  // to go, and under crowd pressure it loses to the pull toward the
  // player, so bodies end up standing inside each other. This is the
  // hard pass that runs after everyone has moved and physically pushes
  // overlapping pairs apart, the way solid bodies actually behave.
  //
  // Three relaxation iterations is enough for a crowd of this size, and
  // it stays cheap: with maxAlive 24 that is about 830 pair tests a frame.
  _separateBodies() {
    const list = [];
    for (const z of this.zombies.values()) {
      if (z.alive && !(z.type === 'spitter' && z.spitT > 0)) list.push(z);
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const ra = TUNING.enemies[a.type].radius;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const rb = TUNING.enemies[b.type].radius;
          // Bodies touch shoulder to shoulder rather than at their full
          // steering radius, so a horde can still crowd a breach.
          const min = (ra + rb) * 0.82;
          let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
          let d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          if (d2 < 1e-8) {
            // Exactly co-located (two spawns on the same point): nudge
            // them apart deterministically by id so the host and every
            // client resolve it the same way.
            dx = ((a.id + b.id) % 2) ? 1 : 0;
            dz = dx ? 0 : 1;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          // A heavier body gives less ground: a brute wading through
          // walkers should push them aside, not be shoved by them.
          const ma = TUNING.enemies[a.type].mass || 1;
          const mb = TUNING.enemies[b.type].mass || 1;
          const total = ma + mb;
          const push = (min - d) / d;
          const sa = (mb / total) * push, sb = (ma / total) * push;
          a.pos.x -= dx * sa; a.pos.z -= dz * sa;
          b.pos.x += dx * sb; b.pos.z += dz * sb;
        }
      }
    }
    // Being pushed must never shove anyone into geometry, off a ledge or
    // into a hole. A body pushed over a void used to stand on thin air at
    // ground level, because the fallback clamped it back to baseY.
    for (const z of list) {
      const stats = TUNING.enemies[z.type];
      resolveCircle(z.pos, stats.radius * 0.8, this._zColliders(z.pos.y));
      this._placeOnGround(z);
    }
  }

  // The level's navigation grid, built lazily and cached on the level.
  _nav() {
    if (this.level.nav) return this.level.nav;
    if (!NavGrid) return null;
    const half = (this.level.navSize || LEVEL_SIZE) / 2 + 4;
    const b = this.level.navBounds || { minX: -half, maxX: half, minZ: -half, maxZ: half };
    const nav = new NavGrid(b, 0.6);
    nav.build(this.level.colliders, 0.4, voidBlocker(this.level));
    this.level.nav = nav;
    return nav;
  }

  // Returns a unit direction to move this frame, from the agent's path.
  _navSteer(z, stats, goalPos, dt) {
    const nav = this._nav();
    if (!nav) {
      const dx = goalPos.x - z.pos.x, dz = goalPos.z - z.pos.z;
      const l = Math.hypot(dx, dz);
      return l > 1e-6 ? { x: dx / l, z: dz / l } : null;
    }
    z.pathT = (z.pathT || 0) - dt;
    const goalMoved = !z.pathGoal
      || (z.pathGoal.x - goalPos.x) ** 2 + (z.pathGoal.z - goalPos.z) ** 2 > 4;
    // Replan when the path is gone, stale, or the target has walked off.
    if ((!z.path || !z.path.length || z.pathT <= 0 || goalMoved) && this._planBudget > 0) {
      this._planBudget--;
      z.path = nav.findPath(z.pos.x, z.pos.z, goalPos.x, goalPos.z);
      z.pathGoal = { x: goalPos.x, z: goalPos.z };
      z.pathT = 0.7 + Math.random() * 0.5;   // stagger replans across agents
    }
    if (!z.path || !z.path.length) {
      // No path yet this frame: keep drifting toward the goal so the agent
      // never stands still waiting for the planner.
      const dx = goalPos.x - z.pos.x, dz = goalPos.z - z.pos.z;
      const l = Math.hypot(dx, dz);
      return l > 1e-6 ? { x: dx / l, z: dz / l } : null;
    }
    // String-pulling: skip every waypoint we can already see straight to,
    // so the agent cuts corners like a walker instead of tracing cells.
    let idx = 0;
    for (let i = Math.min(z.path.length - 1, 6); i >= 0; i--) {
      if (nav.lineClear(z.pos.x, z.pos.z, z.path[i].x, z.path[i].z)) { idx = i; break; }
    }
    if (idx > 0) z.path.splice(0, idx);
    const wp = z.path[0];
    let dx = wp.x - z.pos.x, dz = wp.z - z.pos.z;
    let l = Math.hypot(dx, dz);
    if (l < 0.35) {
      z.path.shift();
      if (!z.path.length) {
        const gx = goalPos.x - z.pos.x, gz = goalPos.z - z.pos.z;
        const gl = Math.hypot(gx, gz);
        return gl > 1e-6 ? { x: gx / gl, z: gz / gl } : null;
      }
      dx = z.path[0].x - z.pos.x; dz = z.path[0].z - z.pos.z;
      l = Math.hypot(dx, dz);
    }
    return l > 1e-6 ? { x: dx / l, z: dz / l } : null;
  }

  // ---- Special enemy brains --------------------------------------------
  _nearestStanding(pos) {
    let best = null, bid = null, bd = Infinity;
    for (const [id, p] of this.players) {
      if (p.down) continue;
      const d = pos.distanceToSquared(p.pos);
      if (d < bd) { bd = d; best = p; bid = id; }
    }
    return best ? { p: best, id: bid, dist: Math.sqrt(bd) } : null;
  }

  // Spitter: holds a firing band (spitKeep..spitRange), lobs acid on a
  // timer, backs off when crowded. Returns true = handled this frame.
  _stepSpitter(z, stats, dt) {
    const t = this._nearestStanding(z.pos);
    if (!t) return true;
    z.spitT = (z.spitT || 0) - dt;
    const move = new THREE.Vector3();
    if (t.dist > stats.spitRange) {
      move.subVectors(t.p.pos, z.pos);
    } else if (t.dist < stats.spitKeep) {
      move.subVectors(z.pos, t.p.pos);   // back away
    } else if (z.spitT <= 0) {
      z.spitT = stats.spitInterval;
      // Lob an acid glob on a ~1 s ballistic arc at the player.
      const gid = this.nextGid++;
      const flight = 1.0;
      const dy = (t.p.pos.y + 0.4) - (z.pos.y + 1.2);
      const vel = new THREE.Vector3(
        (t.p.pos.x - z.pos.x) / flight,
        dy / flight + 4.9 * flight,
        (t.p.pos.z - z.pos.z) / flight);
      this.grenades.set(gid, {
        id: gid, owner: null, kind: 'spit',
        pos: z.pos.clone().setY(z.pos.y + 1.2),
        vel, fuse: 3.0,
      });
      this.events.push({ e: 'spit', id: z.id });
      return true;
    } else {
      return true;   // hold position, glaring
    }
    move.y = 0;
    if (move.lengthSq() > 1e-6) {
      move.normalize().multiplyScalar(stats.speed * dt);
      z.pos.add(move);
      resolveCircle(z.pos, stats.radius * 0.8, this._zColliders(z.pos.y));
      this._placeOnGround(z);
    }
    return true;
  }

  // Screamer: keeps its distance and calls reinforcement bursts. Killing
  // it fast is the whole point.
  _stepScreamer(z, stats, dt) {
    const t = this._nearestStanding(z.pos);
    if (!t) return true;
    z.screamT = (z.screamT ?? 2.0) - dt;
    if (z.screamT <= 0) {
      z.screamT = stats.screamInterval;
      this.events.push({ e: 'scream', id: z.id, p: z.pos.toArray() });
      for (let i = 0; i < stats.screamSpawns && this.zombies.size < TUNING.waves.maxAlive; i++) {
        this.spawnZombie(Math.random() < 0.6 ? 'walker' : 'runner');
      }
      return true;
    }
    if (t.dist < stats.keepRange) {
      const away = new THREE.Vector3().subVectors(z.pos, t.p.pos);
      away.y = 0;
      if (away.lengthSq() > 1e-6) {
        away.normalize().multiplyScalar(stats.speed * dt);
        z.pos.add(away);
        resolveCircle(z.pos, stats.radius * 0.8, this.level.colliders);
        z.pos.y = this.level.heightAt(z.pos.x, z.pos.z);
      }
      return true;
    }
    return false;   // out of range: default approach brings it closer
  }

  // Butcher: telegraphed line charge with a punished recovery window.
  _stepButcher(z, stats, dt) {
    z.chargeCd = (z.chargeCd ?? 3) - dt;
    if (z.chargeState === 'telegraph') {
      z.chargeT -= dt;
      if (z.chargeT <= 0) {
        z.chargeState = 'charging';
        z.chargeDist = 0;
      }
      return true;   // stands still, roaring
    }
    if (z.chargeState === 'charging') {
      const step = stats.chargeSpeed * dt;
      const before = z.pos.clone();
      z.pos.addScaledVector(z.chargeDir, step);
      resolveCircle(z.pos, stats.radius * 0.8, this._zColliders(z.pos.y));
      this._placeOnGround(z);
      z.chargeDist += step;
      const moved = z.pos.distanceTo(before);
      // Hit a player?
      for (const [pid, p] of this.players) {
        if (p.down) continue;
        if (p.pos.distanceTo(z.pos) < stats.radius + 0.6) {
          this.damagePlayer(pid, stats.chargeDamage);
          z.chargeState = null;
          z.stunT = stats.chargeRecover;
          this.events.push({ e: 'crash', id: z.id, p: z.pos.toArray() });
          return true;
        }
      }
      if (z.chargeDist > stats.chargeRange || moved < step * 0.4) {
        // Overran or slammed a wall: recovery window (shoot the back!).
        z.chargeState = null;
        z.stunT = stats.chargeRecover;
        this.events.push({ e: 'crash', id: z.id, p: z.pos.toArray() });
      }
      return true;
    }
    const t = this._nearestStanding(z.pos);
    if (t && z.chargeCd <= 0 && t.dist < stats.chargeRange && t.dist > 2.5) {
      z.chargeCd = 7;
      z.chargeState = 'telegraph';
      z.chargeT = stats.chargeTelegraph;
      z.chargeDir = new THREE.Vector3().subVectors(t.p.pos, z.pos).setY(0).normalize();
      this.events.push({ e: 'roar', id: z.id, p: z.pos.toArray() });
      return true;
    }
    return false;   // default lumbering chase
  }

  _stepGrenades(dt) {
    for (const g of [...this.grenades.values()]) {
      const prevX = g.pos.x, prevZ = g.pos.z;
      g.vel.y -= 9.8 * dt;
      g.pos.addScaledVector(g.vel, dt);
      // Walls stop grenades: bounce off tall colliders below their top
      // (2.4 m) instead of tunneling through (review find).
      let hitWall = false;
      if (g.pos.y < 2.4) {
        for (const c of this._tall()) {
          if (Math.abs(g.pos.x - c.x) < c.hx + 0.1 && Math.abs(g.pos.z - c.z) < c.hz + 0.1) {
            g.pos.x = prevX; g.pos.z = prevZ;
            g.vel.x *= -0.3; g.vel.z *= -0.3;
            hitWall = true;
            break;
          }
        }
      }
      const floor = this.level.heightAt(g.pos.x, g.pos.z) + 0.12;
      let hitGround = false;
      if (g.pos.y < floor) {
        g.pos.y = floor;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.6; g.vel.z *= 0.6;
        hitGround = true;
      }
      g.fuse -= dt;
      // Molotovs shatter on first impact; frags and smokes cook off.
      if (((g.kind === 'molotov' || g.kind === 'spit') && (hitGround || hitWall)) || g.fuse <= 0) {
        this.grenades.delete(g.id);
        this._detonate(g);
      }
    }
  }

  _detonate(g) {
    if (g.kind === 'spit') {
      this.events.push({ e: 'acid', p: g.pos.toArray() });
      for (const [pid, p] of this.players) {
        if (p.down) continue;
        if (p.pos.distanceTo(g.pos) < 1.5) {
          this.damagePlayer(pid, TUNING.enemies.spitter.spitDamage);
        }
      }
      return;
    }
    if (g.kind === 'smoke') {
      const S = TUNING.weapons.smokeGrenade;
      this.clouds.push({ pos: g.pos.clone(), t: S.cloudDuration });
      this.events.push({ e: 'smoke', p: g.pos.toArray(), d: S.cloudDuration });
      return;
    }
    if (g.kind === 'molotov') {
      const M = TUNING.weapons.molotov;
      this.fires.push({ pos: g.pos.clone(), t: M.burnDuration, tickT: 0, owner: g.owner });
      this.events.push({ e: 'fire', p: g.pos.toArray(), d: M.burnDuration });
      return;
    }
    const G = TUNING.weapons.fragGrenade;
    this.events.push({ e: 'boom', p: g.pos.toArray() });
    for (const b of [...this.barrels.values()]) {
      if (b.pos.distanceTo(g.pos) <= G.falloffRadius) this._damageBarrel(b, 99, g.owner);
    }
    for (const z of [...this.zombies.values()]) {
      const dist = z.pos.distanceTo(g.pos);
      if (dist > G.falloffRadius) continue;
      const dmg = G.damageCenter + (G.damageAtEdge - G.damageCenter) * (dist / G.falloffRadius);
      // Blast impulse: corpses (and survivors) are thrown outward.
      const push = new THREE.Vector3(z.pos.x - g.pos.x, 0, z.pos.z - g.pos.z).normalize()
        .multiplyScalar(3.5 * (1 - dist / G.falloffRadius) + 1.0);
      z.blast = [push.x, push.z];
      z.pos.addScaledVector(push, 0.12);
      this.damageZombie(z, dmg, false, g.owner);
      z.blast = null;
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
          if (z.pos.distanceTo(f.pos) <= M.burnRadius) this.damageZombie(z, M.dps, false, f.owner || null);
        }
      }
      if (f.t <= 0) this.fires.splice(i, 1);
    }
    // Drones: out to the drop point, release the payload, fly home.
    // Three readable phases, because "did my drone actually do anything"
    // was the old version's whole problem.
    for (const d of [...this.drones.values()]) {
      if (d.phase === 'fly') {
        const to = d.target.clone().sub(d.pos);
        const dist = to.length();
        if (dist < 0.5) { d.phase = 'drop'; d.dropT = 0.7; }
        else d.pos.addScaledVector(to.normalize(), Math.min(dist, 13 * dt));
      } else if (d.phase === 'drop') {
        d.dropT -= dt;
        if (d.dropT <= 0) {
          this._dropPayload(d);
          d.phase = 'home';
        }
      } else {
        const to = d.home.clone().sub(d.pos);
        const dist = to.length();
        // A fetched crate hangs under the drone the whole way back, so the
        // player can watch their loot coming home.
        if (d.carrying) {
          const item = this.items.get(d.carrying);
          if (item) { item.pos.set(d.pos.x, Math.max(0, d.pos.y - 0.6), d.pos.z); }
          else d.carrying = null;
        }
        if (dist < 0.6) {
          if (d.carrying) {
            const item = this.items.get(d.carrying);
            if (item) {
              const land = this._nearestReachable(new THREE.Vector3(d.home.x, 0, d.home.z));
              item.pos.copy(land);
              item.field = false;
              item.carried = false;
              this.events.push({ e: 'delivered', id: item.id, kind: item.kind });
            }
          }
          this.drones.delete(d.id);
        } else {
          d.pos.addScaledVector(to.normalize(), Math.min(dist, 13 * dt));
        }
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
      if (mine.armT > 0) {
        mine.armT -= dt;
        // ARMED. A mine is inert for its first second and there was no
        // way to tell, so "why did that not go off" had no answer. The
        // arming countdown is host-only sim state and emitted nothing,
        // hence a new event rather than a rewiring.
        if (mine.armT <= 0) this.events.push({ e: 'armed', id: mine.id, p: mine.pos.toArray() });
        continue;
      }
      let tripped = false;
      for (const z of this.zombies.values()) {
        if (z.pos.distanceToSquared(mine.pos) < M.triggerRadius * M.triggerRadius) { tripped = true; break; }
      }
      if (tripped) this.detonateMine(mine, mine.owner);
    }
  }

  // ONE detonation path. A mine used to explode inline inside the step
  // loop, which meant only a zombie could ever set one off: shooting one
  // did nothing, a barrel going off beside it did nothing, and it could
  // not hurt the person who laid it. An explosive that only some things
  // can trigger is furniture, not a hazard.
  //
  // Everything in the blast is affected: zombies, players (inside the
  // inner radius, exactly like a barrel), other mines, and barrels. Depth
  // is bounded so a minefield laid against a barrel stack cannot recurse
  // away.
  detonateMine(mine, byId = null, depth = 0) {
    if (!this.mines.has(mine.id)) return;
    this.mines.delete(mine.id);
    const M = TUNING.economy.mine;
    this.events.push({ e: 'boom', p: mine.pos.toArray() });
    for (const z of [...this.zombies.values()]) {
      if (z.pos.distanceTo(mine.pos) <= M.blastRadius) {
        this.damageZombie(z, M.damage, false, byId || mine.owner);
      }
    }
    // Your own trap is a hazard to you, the same way a barrel is.
    for (const [pid, p] of this.players) {
      if (p.down) continue;
      const dist = p.pos.distanceTo(mine.pos);
      const inner = M.blastRadius * 0.7;
      if (dist < inner) this.damagePlayer(pid, Math.max(1, Math.round(M.damage * 0.6 * (1 - dist / inner))));
    }
    if (depth >= 4) return;
    for (const other of [...this.mines.values()]) {
      if (other.pos.distanceTo(mine.pos) <= M.blastRadius) {
        this.detonateMine(other, byId, depth + 1);
      }
    }
    for (const b of [...this.barrels.values()]) {
      if (b.pos.distanceTo(mine.pos) <= M.blastRadius) {
        this._damageBarrel(b, 99, byId, depth + 1);
      }
    }
  }

  _stepPickups() {
    for (const item of [...this.items.values()]) {
      for (const [pid, p] of this.players) {
        if (p.down) continue;
        if (item.field) continue;          // out in the field: send the drone
        // MEASURE FROM THE PLAYER, NOT THE PLAY SPACE. In roomscale VR
        // p.pos is the rig origin and the player can be two metres from
        // it, so a pickup at their feet was two metres away as far as this
        // check was concerned. The head position is where they actually
        // are; it is already on the wire for the avatars.
        const at = p.h && p.h.p ? p.h.p : null;
        const px = at ? at[0] : p.pos.x;
        const pz = at ? at[2] : p.pos.z;
        const dx = px - item.pos.x, dz = pz - item.pos.z;
        if (dx * dx + dz * dz > TUNING.economy.pickupRadius ** 2) continue;
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
        rv: p.down ? +p.reviveT.toFixed(2) : 0,
        h: p.h, hl: p.hl, hr: p.hr,
        inv: p.inv,
      };
    }
    const zs = [];
    for (const z of this.zombies.values()) zs.push(zombieRow(z, true));
    const gs = [];
    const GKINDS = ['frag', 'smoke', 'molotov', 'spit'];
    for (const g of this.grenades.values()) {
      gs.push([g.id, +g.pos.x.toFixed(2), +g.pos.y.toFixed(2), +g.pos.z.toFixed(2), GKINDS.indexOf(g.kind || 'frag')]);
    }
    const bs = [];
    for (const b of this.barrels.values()) {
      bs.push([b.id, +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2)]);
    }
    const ds = [];
    for (const d of this.drones.values()) {
      ds.push([d.id, +d.pos.x.toFixed(2), +d.pos.y.toFixed(2), +d.pos.z.toFixed(2),
        DRONE_LOADS.indexOf(d.payload || 'mine'), d.phase === 'home' ? 1 : 0]);
    }
    const is = [];
    for (const item of this.items.values()) {
      is.push([item.id, ITEM_KINDS.indexOf(item.kind),
        +item.pos.x.toFixed(2), +item.pos.y.toFixed(2), +item.pos.z.toFixed(2),
        item.field ? 1 : 0]);
    }
    const ms = [];
    for (const mine of this.mines.values()) {
      ms.push([mine.id, +mine.pos.x.toFixed(2), +mine.pos.y.toFixed(2), +mine.pos.z.toFixed(2)]);
    }
    const tr = [];
    for (const t of this.traps.values()) {
      tr.push([t.id, TRAP_KINDS.indexOf(t.kind),
        +t.pos.x.toFixed(2), +t.pos.y.toFixed(2), +t.pos.z.toFixed(2), +t.t.toFixed(1)]);
    }
    // Base wall integrity rides the snapshot so a late joiner sees the
    // same holes as everyone else without replaying every damage event.
    const bw = this.level.baseWall
      ? this.level.baseWall.segments.map((sg) => Math.round(sg.hp)) : null;
    const ev = this.events; this.events = [];
    const w = this.wave;
    return {
      t: 'snap', ts, players, zs, gs, is, ms, ds, bs, tr, bw,
      wave: { ph: w.phase, n: w.night, lv: w.level, t: Math.max(0, Math.ceil(w.t)), left: w.left, mod: this.mod || null },
      ev,
    };
  }
}
