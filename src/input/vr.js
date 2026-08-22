// VR input and session management (WebXR, Quest 2/3).
// - "Enter VR" is its own always-visible button whenever WebXR is
//   available, in the lobby AND in-game; the session starts synchronously
//   inside the click handler (WebXR gesture requirement, LESSONS.md).
// - Reference space: local-floor; world generated around the origin.
// - Locomotion: ROOMSCALE (walk physically) or STATIONARY (left stick
//   smooth move, right stick snap turn), chosen in the lobby.
// - Controls: trigger = shoot (hold for auto), grip squeeze = reload,
//   A = cycle weapon, B = grenade, X = health pack, Y = flashlight.
// - The active weapon's model sits on both controller grips.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeWeaponMesh } from '../world/weapons3d.js';

// Quest touch controller gamepad button indices (xr-standard mapping):
// 0 trigger, 1 squeeze, 3 stick press, 4 A/X, 5 B/Y.
const BTN_AX = 4, BTN_BY = 5;

export class VRInput {
  constructor(ctx) {
    this.ctx = ctx;
    this.button = document.getElementById('btn-vr');
    this.active = false;
    this.snapReady = { right: true };
    this.controllers = [];
    this.grips = [];
    this.gripWeapons = [];
    this.hands = { left: null, right: null };   // handedness -> grip (by connection order)
    this.fireHeld = false;
    this.firingController = null;
    this.prevButtons = new Map();               // inputSource -> [bool,...]

    const renderer = ctx.renderer;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      controller.addEventListener('selectstart', () => {
        this.firingController = controller;
        this.fireHeld = true;
        this._fireFrom(controller);
      });
      controller.addEventListener('selectend', () => {
        if (this.firingController === controller) this.fireHeld = false;
      });
      ctx.rig.group.add(controller);

      const grip = renderer.xr.getControllerGrip(i);
      // Right squeeze reloads; left squeeze drops a mine at the hand.
      controller.addEventListener('squeezestart', () => {
        if (this.hands.left === grip) {
          const pos = grip.getWorldPosition(new THREE.Vector3());
          ctx.actions.mineAt(pos);
        } else {
          ctx.actions.reload();
        }
      });
      const weaponHolder = new THREE.Group();
      weaponHolder.add(makeWeaponMesh('pistol'));
      grip.add(weaponHolder);
      ctx.rig.group.add(grip);
      this.grips.push(grip);
      this.gripWeapons.push(weaponHolder);

      controller.addEventListener('connected', (e) => {
        const h = e.data && e.data.handedness;
        if (h === 'left' || h === 'right') this.hands[h] = grip;
      });
      controller.addEventListener('disconnected', () => {
        for (const h of ['left', 'right']) if (this.hands[h] === grip) this.hands[h] = null;
      });
      this.controllers.push(controller);
    }

    this.button.addEventListener('click', () => {
      if (this.active) {
        renderer.xr.getSession()?.end();
        return;
      }
      navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['bounded-floor', 'hand-tracking'],
      }).then((session) => {
        renderer.xr.setSession(session);
      }).catch((err) => {
        console.warn('VR session request failed', err);
        this.button.textContent = 'VR FAILED - RETRY';
      });
    });

    renderer.xr.addEventListener('sessionstart', () => {
      this.active = true;
      this.button.textContent = 'EXIT VR';
      ctx.onSessionChange(true);
    });
    renderer.xr.addEventListener('sessionend', () => {
      this.active = false;
      this.fireHeld = false;
      this.button.textContent = 'ENTER VR';
      ctx.onSessionChange(false);
    });

    this._detect();
  }

  async _detect() {
    let supported = false;
    try {
      supported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr');
    } catch { supported = false; }
    if (supported) this.button.classList.remove('hidden');
  }

  // Swap the weapon model on both grips (active weapon changed).
  setWeaponModel(kind) {
    for (const holder of this.gripWeapons) {
      holder.clear();
      holder.add(makeWeaponMesh(kind));
    }
  }

  // World transform of a tracked hand, or null when untracked.
  getHandPose(hand) {
    const grip = this.hands[hand];
    if (!grip || !this.active) return null;
    return {
      p: grip.getWorldPosition(new THREE.Vector3()).toArray(),
      q: grip.getWorldQuaternion(new THREE.Quaternion()).toArray(),
    };
  }

  // Aim ray of the last-firing (or right) controller, for auto fire.
  getAimRay() {
    const c = this.firingController || this.controllers[0];
    if (!c || !this.active) return null;
    return {
      origin: c.getWorldPosition(new THREE.Vector3()),
      dir: new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion())),
    };
  }

  _fireFrom(controller) {
    const origin = controller.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    this.ctx.actions.fireFrom(origin, dir);
  }

  _headForward() {
    const q = this.ctx.camera.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    f.y = 0;
    return f.lengthSq() > 0.0001 ? f.normalize() : new THREE.Vector3(0, 0, -1);
  }

  _snapTurn(sign) {
    const rig = this.ctx.rig;
    const cam = this.ctx.camera;
    const before = cam.getWorldPosition(new THREE.Vector3());
    rig.group.rotation.y += sign * THREE.MathUtils.degToRad(CONFIG.SNAP_TURN_DEG);
    rig.group.updateMatrixWorld(true);
    const after = cam.getWorldPosition(new THREE.Vector3());
    rig.group.position.x += before.x - after.x;
    rig.group.position.z += before.z - after.z;
  }

  update(dt) {
    if (!this.active) return;
    const session = this.ctx.renderer.xr.getSession();
    if (!session) return;
    const stationary = this.ctx.getLocoMode() === 'stationary';

    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;

      // Face buttons with edge detection.
      const prev = this.prevButtons.get(src) || [];
      const now = gp.buttons.map((b) => b.pressed);
      this.prevButtons.set(src, now);
      const pressed = (i) => now[i] && !prev[i];
      if (src.handedness === 'right') {
        if (pressed(BTN_AX)) this.ctx.actions.cycle();      // A
        if (pressed(BTN_BY)) this._grenadeFrom(src);        // B
      } else if (src.handedness === 'left') {
        if (pressed(BTN_AX)) this.ctx.actions.pack();       // X
        if (pressed(BTN_BY)) this.ctx.actions.flashlight(); // Y
      }

      if (gp.axes.length < 4) continue;
      const x = gp.axes[2], y = gp.axes[3];
      if (src.handedness === 'left' && stationary) {
        if (Math.abs(x) > 0.12 || Math.abs(y) > 0.12) {
          const fwd = this._headForward();
          const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
          const move = fwd.multiplyScalar(-y).add(right.multiplyScalar(x));
          this.ctx.rig.group.position.addScaledVector(move, CONFIG.VR_MOVE_SPEED * dt);
        }
      }
      if (src.handedness === 'right' && stationary) {
        if (Math.abs(x) > 0.6 && this.snapReady.right) {
          this.snapReady.right = false;
          this._snapTurn(x > 0 ? -1 : 1);
        } else if (Math.abs(x) < 0.3) {
          this.snapReady.right = true;
        }
      }
    }
  }

  _grenadeFrom(src) {
    const grip = this.hands[src.handedness];
    if (!grip) { this.ctx.actions.grenade(); return; }
    const origin = grip.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0.35, -1).normalize()
      .applyQuaternion(grip.getWorldQuaternion(new THREE.Quaternion()));
    this.ctx.actions.grenadeFrom(origin, dir);
  }
}
