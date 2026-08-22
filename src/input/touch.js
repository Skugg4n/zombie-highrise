// Mobile input: left virtual joystick to move, drag right zone to look,
// tap right zone (or the FIRE button) to shoot. No pointer lock on mobile
// (LESSONS.md); the touch layer owns its own camera control.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const STICK_RADIUS = 45;

export class TouchInput {
  constructor(ctx) {
    this.ctx = ctx;               // { rig, camera, fire(), isPlaying() }
    this.move = { x: 0, y: 0 };   // normalized -1..1
    this.stickId = null;
    this.lookId = null;
    this.lookLast = null;
    this.lookStart = null;

    this.ui = document.getElementById('touch-ui');
    this.base = document.getElementById('stick-base');
    this.nub = document.getElementById('stick-nub');
    const stickZone = document.getElementById('stick-zone');
    const lookZone = document.getElementById('look-zone');
    const fireBtn = document.getElementById('btn-fire');
    this.ui.classList.remove('hidden');
    fireBtn.style.display = 'block';

    stickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.stickId !== null) return;
      const t = e.changedTouches[0];
      this.stickId = t.identifier;
      this.stickOrigin = { x: t.clientX, y: t.clientY };
      this._showStick(t.clientX, t.clientY, t.clientX, t.clientY);
    }, { passive: false });
    stickZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this.stickId) continue;
        let dx = t.clientX - this.stickOrigin.x;
        let dy = t.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        this.move.x = dx / STICK_RADIUS;
        this.move.y = dy / STICK_RADIUS;
        this._showStick(this.stickOrigin.x, this.stickOrigin.y, this.stickOrigin.x + dx, this.stickOrigin.y + dy);
      }
    }, { passive: false });
    const stickEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.stickId) continue;
        this.stickId = null;
        this.move.x = this.move.y = 0;
        this.base.style.display = this.nub.style.display = 'none';
      }
    };
    stickZone.addEventListener('touchend', stickEnd);
    stickZone.addEventListener('touchcancel', stickEnd);

    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.lookId !== null) return;
      const t = e.changedTouches[0];
      this.lookId = t.identifier;
      this.lookLast = { x: t.clientX, y: t.clientY };
      this.lookStart = { x: t.clientX, y: t.clientY, time: performance.now() };
    }, { passive: false });
    lookZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
        const rig = this.ctx.rig;
        rig.yaw -= (t.clientX - this.lookLast.x) * 0.0045;
        rig.pitch = THREE.MathUtils.clamp(
          rig.pitch - (t.clientY - this.lookLast.y) * 0.0045, -1.45, 1.45);
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
        this.lookId = null;
        // Quick tap without dragging = shoot.
        const moved = Math.hypot(t.clientX - this.lookStart.x, t.clientY - this.lookStart.y);
        const held = performance.now() - this.lookStart.time;
        if (moved < 12 && held < 300 && this.ctx.isPlaying()) this._fireFromCamera();
      }
    };
    lookZone.addEventListener('touchend', lookEnd);
    lookZone.addEventListener('touchcancel', lookEnd);

    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.ctx.isPlaying()) this._fireFromCamera();
    }, { passive: false });
  }

  _showStick(bx, by, nx, ny) {
    this.base.style.display = this.nub.style.display = 'block';
    this.base.style.left = bx + 'px'; this.base.style.top = by + 'px';
    this.nub.style.left = nx + 'px'; this.nub.style.top = ny + 'px';
  }

  _fireFromCamera() {
    const cam = this.ctx.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.ctx.fire(origin, dir);
  }

  update(dt) {
    if (!this.ctx.isPlaying()) return;
    const { x, y } = this.move;
    if (!x && !y) return;
    const rig = this.ctx.rig;
    const speed = CONFIG.PLAYER_SPEED * dt;
    const sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
    // Stick up (negative y) = forward.
    rig.group.position.x += (x * cos + y * sin) * speed;
    rig.group.position.z += (-x * sin + y * cos) * speed;
  }
}
