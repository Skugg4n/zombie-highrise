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
    this.cooldownR = 0;      // dual pistols: the right hand has its own timer
    // Recoil heat: 0 when settled, 1 when the weapon is as wild as it
    // gets. Rises per shot, bleeds off when you stop pulling the trigger.
    this.heat = 0;
    // Where we are in the weapon's recoil pattern. Resets once the weapon
    // has cooled, so a player who paces their shots always starts the
    // pattern from the top and can learn one shape rather than many.
    this.shotIndex = 0;
    this.lastHand = 'right'; // so single-click akimbo still alternates
    this.reloading = false;
    this.reloadT = 0;
    this.reloadTotal = 0;    // for the reload animation curve
    this.reloadGraceT = 0;   // post-reload window before host mag sync resumes
    this.ads = false;
    this.adsT = 0;           // 0..1 eased aim-down-sights amount
  }

  isAkimbo() { return this.active === 'akimbo'; }

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
      // Skip the clamp during a reload AND for a short grace after it:
      // in-flight snapshots carrying the host's pre-reload magazine must
      // not zero a freshly reloaded weapon (review find).
      const protectedNow = (this.reloading || this.reloadGraceT > 0) && w === this.active;
      if (!protectedNow) {
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
  fire(origin, dir, hand = null) {
    const w = this.active;
    if (w === 'akimbo') {
      // Alternate hands. An explicit hand comes from the matching mouse
      // button; a plain click takes whichever hand is ready next.
      const h = hand || (this.lastHand === 'left' ? 'right' : 'left');
      if (h === 'right' ? this.cooldownR > 0 : this.cooldown > 0) return false;
      if (this.reloading) return false;
      const defA = this.def(w);
      const a = this.ammo[w];
      if (!a || a.mag <= 0) {
        if (this.effects.dry) this.effects.dry();
        this.reload();
        return false;
      }
      a.mag--;
      this.lastHand = h;
      if (h === 'right') this.cooldownR = defA.fireCooldown;
      else this.cooldown = defA.fireCooldown;
      const kickA = this.recoilKick();
      this.dispatch({ t: 'shoot', w, o: origin.toArray(), d: dir.toArray(), sp: this.spreadMult() });
      this.addHeat();
      this.effects.muzzle(origin, dir, w, h, kickA);
      this.onHudChange();
      if (a.mag === 0) this.reload();
      return true;
    }
    if (this.cooldown > 0 || this.reloading) return false;
    if (w === 'machete') return this.swing(origin, dir);
    const def = this.def(w);
    const a = this.ammo[w];
    if (!a || a.mag <= 0) {
      if (this.effects.dry) this.effects.dry();
      this.reload();
      return false;
    }
    a.mag--;
    this.cooldown = def.fireCooldown;
    const kick = this.recoilKick();
    this.dispatch({ t: 'shoot', w, o: origin.toArray(), d: dir.toArray(), sp: this.spreadMult() });
    this.addHeat();
    this.effects.muzzle(origin, dir, w, null, kick);
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

  // Drop any reload in progress. Used by the authoritative respawn, so a
  // player who went down mid-reload does not come back mid-reload.
  cancelReload() {
    this.reloading = false;
    this.reloadT = 0;
    this.heat = 0;
    this.shotIndex = 0;
    this.onHudChange();
  }

  reload() {
    const w = this.active;
    if (!this.isGun(w) || this.reloading) return;
    const def = this.def(w);
    const a = this.ammo[w];
    if (!a || a.mag >= def.magazine || a.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = def.reloadTime;
    this.reloadTotal = def.reloadTime;
    if (this.effects.reload) this.effects.reload();
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
  update(dt, fireHeld, getAimRay, fireHeldR = false) {
    const R = TUNING.weapons.recoil;
    if (this.heat > 0) {
      this.heat = Math.max(0, this.heat - R.decayPerSecond * dt);
      if (this.heat <= R.resetHeat) { this.heat = 0; this.shotIndex = 0; }
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.cooldownR > 0) this.cooldownR -= dt;
    // Aim-down-sights easing (never instant: the transition IS the feel).
    const adsTarget = this.ads && this.isGun() && !this.reloading ? 1 : 0;
    const rate = dt / TUNING.weapons.ads.enterTime;
    this.adsT += Math.sign(adsTarget - this.adsT) * Math.min(rate, Math.abs(adsTarget - this.adsT));
    if (this.reloadGraceT > 0) this.reloadGraceT -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloading = false;
        this.reloadGraceT = 0.6;
        const def = this.def();
        const a = this.ammo[this.active];
        if (a) {
          const need = def.magazine - a.mag;
          const take = a.reserve === Infinity ? need : Math.min(need, a.reserve);
          a.mag += take;
          if (a.reserve !== Infinity) a.reserve -= take;
        }
        this.dispatch({ t: 'reloadDone', w: this.active });
        // The moment the fresh magazine seats. Without this the reload
        // just... ends, and the player has no idea when they can fire.
        if (this.effects.magSeated) this.effects.magSeated();
        this.onHudChange();
      }
    }
    if (fireHeld && this.isGun() && this.def().auto) {
      const ray = getAimRay();
      if (ray) this.fire(ray.origin, ray.dir);
    }
    // Holding both buttons on dual pistols runs both hands.
    if (this.isAkimbo()) {
      const ray = getAimRay();
      if (ray) {
        if (fireHeld && this.cooldown <= 0) this.fire(ray.origin, ray.dir, 'left');
        if (fireHeldR && this.cooldownR <= 0) this.fire(ray.origin, ray.dir, 'right');
      }
    }
  }

  // Spread shrinks hard while aiming: ADS is a real accuracy choice.
  // It also grows with recoil heat, which is what makes fast fire cost
  // something rather than being free damage.
  spreadMult() {
    const ads = 1 - this.adsT * (1 - TUNING.weapons.ads.spreadMult);
    const R = TUNING.weapons.recoil;
    const perWeapon = R[this.active];
    if (!perWeapon) return ads;
    return ads * (1 + this.heat * perWeapon.spreadHeat);
  }

  // The kick this shot applies to the player's aim, as { up, side } in
  // radians. `up` is always up and always the same for a given shot in
  // the burst; `side` follows the weapon's fixed pattern with a small
  // jitter on top. That is what makes it learnable: pull down and against
  // the drift and your group stays tight even at ten shots a second.
  //
  // Called at the moment of firing, BEFORE heat is added, so the first
  // shot of any burst is the clean one.
  recoilKick() {
    const R = TUNING.weapons.recoil;
    const perWeapon = R[this.active];
    if (!perWeapon) return { up: 0, side: 0 };
    const hot = 1 + this.heat * R.growth;
    const steadied = 1 - this.adsT * (1 - R.adsKickMult);
    const up = perWeapon.kick * hot * steadied;
    const pat = perWeapon.pattern || [0];
    const drift = pat[this.shotIndex % pat.length];
    const noise = (Math.random() - 0.5) * 2 * R.jitter;
    return { up, side: up * (drift + noise) };
  }

  // Called once per shot, after the kick has been read.
  addHeat() {
    const R = TUNING.weapons.recoil;
    const perWeapon = R[this.active];
    if (!perWeapon) return;
    const steadied = 1 - this.adsT * (1 - R.adsHeatMult);
    this.heat = Math.min(R.maxHeat, this.heat + perWeapon.heat * steadied);
    this.shotIndex++;
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
      name: this.def(w).name, mag: a.mag, magMax: this.def(w).magazine,
      reserve: a.reserve === Infinity ? -1 : a.reserve,
      reloading: this.reloading, ...common,
    };
  }
}
