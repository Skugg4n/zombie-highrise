// Client-side weapon controller: owned weapons, active slot, predicted
// ammo, reload timing, auto fire, melee swing, grenade throw, health pack
// use. The HOST is authoritative (state.js applyAction); this controller
// predicts locally for a snappy HUD and reconciles from snapshots.
//
// Reload per platform (all feed the same reload() here):
//   desktop R key, mobile RELOAD button, VR grip squeeze.
import { TUNING } from './tuning.js';

export const GUN_SLOTS = ['pistol', 'akimbo', 'shotgun', 'smg', 'ak', 'machete'];
export const THROWABLES = ['frag', 'smoke', 'molotov'];

export class Arsenal {
  constructor({ dispatch, onHudChange, effects }) {
    this.dispatch = dispatch;         // (msgObject) => routed to sim or net
    this.onHudChange = onHudChange;   // () => HUD refresh
    this.effects = effects;           // { muzzle(o,d,w), swing(), throw() }
    this.owned = ['pistol', 'machete'];
    this.active = 'pistol';
    this.ammo = {
      pistol: { mag: TUNING.weapons.pistol.magazine, reserve: Infinity },
    };
    this.grenades = 1;
    this.smokes = 0;
    this.molotovs = 0;
    this.throwSel = 'frag';
    this.packs = 0;
    this.mines = 0;
    this.nightVision = false;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
  }

  def(w = this.active) { return TUNING.weapons[w]; }
  isGun(w = this.active) { return w !== 'machete'; }

  // ---- Reconcile from the host snapshot --------------------------------
  syncFromHost(inv) {
    if (!inv) return;
    this.owned = inv.w.slice();
    this.grenades = inv.g;
    this.smokes = inv.gs || 0;
    this.molotovs = inv.gm || 0;
    this.packs = inv.k;
    this.mines = inv.m || 0;
    this.nightVision = !!inv.nv;
    for (const [w, pair] of Object.entries(inv.a)) {
      const mine = this.ammo[w] || (this.ammo[w] = { mag: 0, reserve: 0 });
      // While a local reload is in flight the local mag view is ahead of
      // the host; otherwise take min(local, host) for the magazine: local
      // shots the host has not processed yet must not bounce the counter
      // back up, while host corrections still land.
      if (!this.reloading || w !== this.active) {
        mine.mag = w === this.active ? Math.min(mine.mag, pair[0]) : pair[0];
        mine.reserve = pair[1] < 0 ? Infinity : pair[1];
      }
    }
    if (!this.owned.includes(this.active)) this.active = 'pistol';
    this.onHudChange();
  }

  // ---- Actions ---------------------------------------------------------
  switchTo(w) {
    // Slot 1 prefers the akimbo upgrade once owned.
    if (w === 'pistol' && this.owned.includes('akimbo') && this.active !== 'akimbo') w = 'akimbo';
    if (!this.owned.includes(w) || w === this.active) return;
    this.active = w;
    this.reloading = false;
    this.cooldown = Math.max(this.cooldown, 0.15);
    this.dispatch({ t: 'switch', w });
    this.onHudChange();
  }

  cycle() {
    const list = GUN_SLOTS.filter((w) => this.owned.includes(w));
    const idx = list.indexOf(this.active);
    this.switchTo(list[(idx + 1) % list.length]);
  }

  // origin/dir: THREE.Vector3 world ray of the aim (camera or VR hand).
  fire(origin, dir) {
    if (this.cooldown > 0 || this.reloading) return false;
    const w = this.active;
    if (w === 'machete') return this.swing(origin, dir);
    const def = this.def(w);
    const a = this.ammo[w];
    if (!a || a.mag <= 0) { this.reload(); return false; }
    a.mag--;
    this.cooldown = def.fireCooldown;
    this.dispatch({ t: 'shoot', w, o: origin.toArray(), d: dir.toArray() });
    this.effects.muzzle(origin, dir, w);
    this.onHudChange();
    if (a.mag === 0) this.reload();   // auto-reload on empty
    return true;
  }

  swing(origin, dir) {
    const def = TUNING.weapons.machete;
    this.cooldown = def.swingCooldown;
    this.dispatch({ t: 'melee', o: origin.toArray(), d: dir.toArray() });
    this.effects.swing();
    return true;
  }

  reload() {
    const w = this.active;
    if (!this.isGun(w) || this.reloading) return;
    const def = this.def(w);
    const a = this.ammo[w];
    if (!a || a.mag >= def.magazine || a.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = def.reloadTime;
    this.onHudChange();
  }

  throwCount(kind = this.throwSel) {
    return kind === 'smoke' ? this.smokes : kind === 'molotov' ? this.molotovs : this.grenades;
  }

  cycleThrowable() {
    const idx = THROWABLES.indexOf(this.throwSel);
    for (let i = 1; i <= THROWABLES.length; i++) {
      const next = THROWABLES[(idx + i) % THROWABLES.length];
      if (this.throwCount(next) > 0 || i === THROWABLES.length) {
        this.throwSel = next;
        break;
      }
    }
    this.onHudChange();
  }

  throwGrenade(origin, dir) {
    if (this.cooldown > 0) return;
    if (this.throwCount() <= 0) { this.cycleThrowable(); if (this.throwCount() <= 0) return; }
    const kind = this.throwSel;
    if (kind === 'smoke') this.smokes--;
    else if (kind === 'molotov') this.molotovs--;
    else this.grenades--;
    this.cooldown = 0.5;
    this.dispatch({ t: 'throwG', kind, o: origin.toArray(), d: dir.toArray() });
    this.effects.throw();
    this.onHudChange();
  }

  usePack() {
    if (this.packs <= 0) return;
    this.packs--;
    this.dispatch({ t: 'use', item: 'pack' });
    this.onHudChange();
  }

  // Hand-placed mine at a world position (prep phases only, host enforces).
  placeMine(pos) {
    if (this.mines <= 0) return;
    this.mines--;
    this.dispatch({ t: 'placeMine', p: pos.toArray(), via: 'hand' });
    this.onHudChange();
  }

  // ---- Frame -----------------------------------------------------------
  // fireHeld: auto weapons keep firing while the trigger/button is held.
  update(dt, fireHeld, getAimRay) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloading = false;
        const def = this.def();
        const a = this.ammo[this.active];
        if (a) {
          const need = def.magazine - a.mag;
          const take = a.reserve === Infinity ? need : Math.min(need, a.reserve);
          a.mag += take;
          if (a.reserve !== Infinity) a.reserve -= take;
        }
        this.dispatch({ t: 'reloadDone', w: this.active });
        this.onHudChange();
      }
    }
    if (fireHeld && this.isGun() && this.def().auto) {
      const ray = getAimRay();
      if (ray) this.fire(ray.origin, ray.dir);
    }
  }

  hudInfo() {
    const w = this.active;
    const common = {
      grenades: this.grenades, smokes: this.smokes, molotovs: this.molotovs,
      throwSel: this.throwSel, throwCount: this.throwCount(),
      packs: this.packs, mines: this.mines, nightVision: this.nightVision,
    };
    if (!this.isGun(w)) {
      return { name: 'MACHETE', mag: null, reserve: null, reloading: false, ...common };
    }
    const a = this.ammo[w] || { mag: 0, reserve: 0 };
    return {
      name: this.def(w).name, mag: a.mag,
      reserve: a.reserve === Infinity ? -1 : a.reserve,
      reloading: this.reloading, ...common,
    };
  }
}
