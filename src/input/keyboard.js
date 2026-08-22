// Desktop input: WASD + mouse with pointer lock.
//   click/hold  shoot (hold = auto weapons keep firing)
//   R reload, 1-4 weapon slots, Q cycle, G grenade, H health pack,
//   F flashlight, M tactical map (Phase 1 Pass D)
import * as THREE from 'three';
import { TUNING } from '../game/tuning.js';

const SLOT_KEYS = { Digit1: 'pistol', Digit2: 'shotgun', Digit3: 'smg', Digit4: 'machete' };

export class KeyboardInput {
  constructor(ctx) {
    this.ctx = ctx;               // shared input context, see main.js
    this.keys = new Set();
    this.fireHeld = false;

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
      else if (SLOT_KEYS[e.code]) act.switchTo(SLOT_KEYS[e.code]);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; });

    ctx.dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!ctx.isPlaying()) return;
      if (ctx.isMapActive && ctx.isMapActive()) return;   // map owns clicks
      if (document.pointerLockElement !== ctx.dom) {
        ctx.dom.requestPointerLock();
        return;
      }
      this.fireHeld = true;
      ctx.actions.fire();          // semi weapons fire once per press
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== ctx.dom) return;
      this.ctx.rig.yaw -= e.movementX * 0.0022;
      this.ctx.rig.pitch = THREE.MathUtils.clamp(
        this.ctx.rig.pitch - e.movementY * 0.0022, -1.45, 1.45);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== ctx.dom) this.fireHeld = false;
    });
  }

  update(dt) {
    if (!this.ctx.isPlaying()) return;
    const rig = this.ctx.rig;
    let fwd = 0, str = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) str -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) str += 1;
    if (!fwd && !str) return;
    const len = Math.hypot(fwd, str) || 1;
    const speed = TUNING.player.walkSpeed * dt / len;
    const sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
    rig.group.position.x += (str * cos - fwd * sin) * speed;
    rig.group.position.z += (-str * sin - fwd * cos) * speed;
  }
}
