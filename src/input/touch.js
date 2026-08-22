// Mobile input: left virtual joystick to move, drag right zone to look,
// tap right zone or hold the FIRE button to shoot (hold = auto weapons).
// Extra buttons: WEAPON (cycle), RELOAD, GRENADE, PACK. No pointer lock on
// mobile (LESSONS.md); the touch layer owns its own camera control.
import * as THREE from 'three';
import { TUNING } from '../game/tuning.js';

const STICK_RADIUS = 45;

export class TouchInput {
  constructor(ctx) {
    this.ctx = ctx;
    this.move = { x: 0, y: 0 };
    this.stickId = null;
    this.lookId = null;
    this.lookLast = null;
    this.lookStart = null;
    this.fireHeld = false;

    this.ui = document.getElementById('touch-ui');
    this.base = document.getElementById('stick-base');
    this.nub = document.getElementById('stick-nub');
    const stickZone = document.getElementById('stick-zone');
    const lookZone = document.getElementById('look-zone');
    const fireBtn = document.getElementById('btn-fire');
    this.ui.classList.remove('hidden');
    fireBtn.style.display = 'block';
    document.getElementById('touch-actions').style.display = 'flex';

    const bind = (id, fn) => {
      document.getElementById(id).addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.ctx.isPlaying()) fn();
      }, { passive: false });
    };
    bind('btn-cycle', () => ctx.actions.cycle());
    bind('btn-reload', () => ctx.actions.reload());
    bind('btn-grenade', () => ctx.actions.grenade());
    bind('btn-pack', () => ctx.actions.pack());
    bind('btn-map', () => ctx.actions.map());

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
        const moved = Math.hypot(t.clientX - this.lookStart.x, t.clientY - this.lookStart.y);
        const held = performance.now() - this.lookStart.time;
        if (moved < 12 && held < 300 && this.ctx.isPlaying()) this.ctx.actions.fire();
      }
    };
    lookZone.addEventListener('touchend', lookEnd);
    lookZone.addEventListener('touchcancel', lookEnd);

    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!this.ctx.isPlaying()) return;
      this.fireHeld = true;
      this.ctx.actions.fire();
    }, { passive: false });
    const fireEnd = (e) => { e.preventDefault(); this.fireHeld = false; };
    fireBtn.addEventListener('touchend', fireEnd, { passive: false });
    fireBtn.addEventListener('touchcancel', fireEnd, { passive: false });
  }

  _showStick(bx, by, nx, ny) {
    this.base.style.display = this.nub.style.display = 'block';
    this.base.style.left = bx + 'px'; this.base.style.top = by + 'px';
    this.nub.style.left = nx + 'px'; this.nub.style.top = ny + 'px';
  }

  update(dt) {
    if (!this.ctx.isPlaying()) return;
    const { x, y } = this.move;
    if (!x && !y) return;
    const rig = this.ctx.rig;
    const speed = TUNING.player.walkSpeed * dt;
    const sin = Math.sin(rig.yaw), cos = Math.cos(rig.yaw);
    rig.group.position.x += (x * cos + y * sin) * speed;
    rig.group.position.z += (-x * sin + y * cos) * speed;
  }
}
