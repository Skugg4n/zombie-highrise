// Desktop input: WASD + mouse with pointer lock. Click shoots, R reloads.
// Pointer lock is requested from a user gesture on the canvas while playing.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class KeyboardInput {
  constructor(ctx) {
    this.ctx = ctx;               // { rig, camera, dom, fire(), reload(), isPlaying() }
    this.keys = new Set();
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') ctx.reload();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    ctx.dom.addEventListener('click', () => {
      if (!ctx.isPlaying()) return;
      if (document.pointerLockElement !== ctx.dom) {
        ctx.dom.requestPointerLock();
      } else {
        this._fireFromCamera();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== ctx.dom) return;
      this.ctx.rig.yaw -= e.movementX * 0.0022;
      this.ctx.rig.pitch = THREE.MathUtils.clamp(
        this.ctx.rig.pitch - e.movementY * 0.0022, -1.45, 1.45);
    });
  }

  _fireFromCamera() {
    const cam = this.ctx.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.ctx.fire(origin, dir);
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
    const speed = CONFIG.PLAYER_SPEED * dt / len;
    const sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
    rig.group.position.x += (str * cos - fwd * sin) * speed;
    rig.group.position.z += (-str * sin - fwd * cos) * speed;
  }
}
