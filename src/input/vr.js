// VR input and session management (WebXR, Quest 2/3).
// - "Enter VR" is its own always-visible button whenever WebXR is
//   available, in the lobby AND in-game; the session starts synchronously
//   inside the click handler (WebXR gesture requirement, LESSONS.md).
// - Reference space: local-floor. The world is generated around the
//   player's origin; no calibration for a single VR player.
// - Locomotion: ROOMSCALE (walk physically) or STATIONARY (left stick
//   smooth move, right stick snap turn), chosen in the lobby.
// - Trigger = shoot. Controllers get simple pistol models on grip poses.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

function makePistolMesh() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.55, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.9 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.16), metal);
  slide.position.set(0, 0.015, -0.05);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.09, 0.045), grip);
  handle.position.set(0, -0.045, 0.02);
  handle.rotation.x = 0.25;
  g.add(slide, handle);
  return g;
}

export class VRInput {
  constructor(ctx) {
    // ctx: { rig, camera, renderer, fire(origin, dir), getLocoMode(), onSessionChange(active) }
    this.ctx = ctx;
    this.button = document.getElementById('btn-vr');
    this.active = false;
    this.snapReady = { left: true, right: true };
    this.controllers = [];

    const renderer = ctx.renderer;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      controller.addEventListener('selectstart', () => this._fireFrom(controller));
      ctx.rig.group.add(controller);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(makePistolMesh());
      ctx.rig.group.add(grip);
      this.controllers.push(controller);
    }

    this.button.addEventListener('click', () => {
      if (this.active) {
        renderer.xr.getSession()?.end();
        return;
      }
      // Must be called synchronously in the click handler.
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

  _fireFrom(controller) {
    const origin = controller.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    this.ctx.fire(origin, dir);
  }

  // Head-relative planar forward for stick locomotion.
  _headForward() {
    const q = this.ctx.camera.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    f.y = 0;
    return f.lengthSq() > 0.0001 ? f.normalize() : new THREE.Vector3(0, 0, -1);
  }

  _snapTurn(sign) {
    const rig = this.ctx.rig;
    const cam = this.ctx.camera;
    // Pivot around the head, not the rig origin, so the player stays put.
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
      if (!gp || gp.axes.length < 4) continue;
      const x = gp.axes[2], y = gp.axes[3];

      if (src.handedness === 'left' && stationary) {
        // Smooth locomotion relative to where the player looks.
        if (Math.abs(x) > 0.12 || Math.abs(y) > 0.12) {
          const fwd = this._headForward();
          const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
          const move = fwd.multiplyScalar(-y).add(right.multiplyScalar(x));
          this.ctx.rig.group.position.addScaledVector(move, CONFIG.VR_MOVE_SPEED * dt);
        }
      }
      if (src.handedness === 'right' && stationary) {
        // Snap turn with hysteresis so one flick = one turn.
        if (Math.abs(x) > 0.6 && this.snapReady.right) {
          this.snapReady.right = false;
          this._snapTurn(x > 0 ? -1 : 1);
        } else if (Math.abs(x) < 0.3) {
          this.snapReady.right = true;
        }
      }
    }
  }
}
