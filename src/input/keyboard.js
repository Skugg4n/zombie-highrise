// Desktop input: WASD + mouse with pointer lock.
//   click/hold  shoot (hold = auto weapons keep firing)
//   R reload, 1-4 weapon slots, Q cycle, G grenade, H health pack,
//   F flashlight, M tactical map, T mine, HOLD E to repair the base wall
import * as THREE from 'three';
import { TUNING } from '../game/tuning.js';

const SLOT_KEYS = { Digit1: 'pistol', Digit2: 'shotgun', Digit3: 'smg', Digit4: 'machete', Digit5: 'ak' };

export class KeyboardInput {
  constructor(ctx) {
    this.ctx = ctx;               // shared input context, see main.js
    this.keys = new Set();
    this.fireHeld = false;
    this.wishX = 0;
    this.wishZ = 0;   // desired velocity, m/s; the controller applies it

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const act = ctx.actions;
      if (e.code === 'KeyR') act.reload();
      else if (e.code === 'KeyQ') act.cycle();
      else if (e.code === 'KeyG') act.grenade();
      else if (e.code === 'KeyH') act.pack();
      else if (e.code === 'KeyF') act.flashlight();
      else if (e.code === 'KeyM') act.map();
      else if (e.code === 'KeyT') act.mine();
      else if (e.code === 'KeyE') act.repairHold(true);
      else if (e.code === 'F8') { e.preventDefault(); act.debugMenu(); }
      else if (act.debugMenuOpen && act.debugMenuOpen()) {
        // While the debug menu is up it owns the arrows and Enter.
        if (e.code === 'ArrowUp') act.debugMenuMove(-1);
        else if (e.code === 'ArrowDown') act.debugMenuMove(1);
        else if (e.code === 'Enter') act.debugMenuPick();
      }
      else if (e.code === 'KeyV') act.throwCycle();
      else if (e.code === 'KeyN') act.nightVision();
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') act.setAds(true);
      else if (SLOT_KEYS[e.code]) act.switchTo(SLOT_KEYS[e.code]);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') ctx.actions.setAds(false);
      // Repair is a HOLD: you watch a ring fill, so releasing cancels it.
      else if (e.code === 'KeyE') ctx.actions.repairHold(false);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.fireHeld = false; this.fireHeldR = false;
      ctx.actions.setAds(false);
    });

    ctx.dom.addEventListener('contextmenu', (e) => e.preventDefault());
    ctx.dom.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        // Right button: with dual pistols it fires the RIGHT gun (so the
        // pair alternates instead of firing in lifeless sync); with any
        // other weapon it aims down sights.
        if (!ctx.isPlaying()) return;
        if (ctx.isMapActive && ctx.isMapActive()) return;
        if (ctx.isModalOpen && ctx.isModalOpen()) return;
        if (document.pointerLockElement !== ctx.dom) return;
        if (ctx.actions.isAkimbo()) { this.fireHeldR = true; ctx.actions.fireRight(); }
        else ctx.actions.setAds(true);
        return;
      }
      if (e.button !== 0) return;
      if (!ctx.isPlaying()) return;
      if (ctx.isMapActive && ctx.isMapActive()) return;   // map owns clicks
      if (ctx.isModalOpen && ctx.isModalOpen()) return;   // shop/gameover own clicks
      if (document.pointerLockElement !== ctx.dom) {
        ctx.dom.requestPointerLock();
        return;
      }
      this.fireHeld = true;
      ctx.actions.fire();          // semi weapons fire once per press
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) { this.fireHeldR = false; ctx.actions.setAds(false); }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== ctx.dom) return;
      const sens = 0.0022 * (this.ctx.actions.adsAmount() > 0.5
        ? TUNING.weapons.ads.sensMult : 1);
      this.ctx.rig.yaw -= e.movementX * sens;
      this.ctx.rig.pitch = THREE.MathUtils.clamp(
        this.ctx.rig.pitch - e.movementY * sens, -1.45, 1.45);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== ctx.dom) {
        this.fireHeld = false; this.fireHeldR = false;
        ctx.actions.setAds(false);
      }
    });
  }

  // Reports WHERE THE PLAYER WANTS TO GO, in metres per second. It does
  // not move anything: the character controller owns position, and it is
  // the only thing that does.
  update(dt) {
    this.wishX = 0;
    this.wishZ = 0;
    if (!this.ctx.isPlaying()) return;
    const rig = this.ctx.rig;
    let fwd = 0, str = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) str -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) str += 1;
    if (!fwd && !str) return;
    const len = Math.hypot(fwd, str) || 1;
    const speed = TUNING.player.walkSpeed / len;
    const sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
    this.wishX = (str * cos - fwd * sin) * speed;
    this.wishZ = (-str * sin - fwd * cos) * speed;
    void dt;
  }
}
