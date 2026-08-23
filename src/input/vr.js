// VR input and session management (WebXR, Quest 2/3).
// - "Enter VR" is its own always-visible button whenever WebXR is
//   available, in the lobby AND in-game; the session starts synchronously
//   inside the click handler (WebXR gesture requirement, LESSONS.md).
// - Reference space: local-floor; world generated around the origin.
// - Locomotion: ROOMSCALE (walk physically) or STATIONARY (left stick
//   smooth move, right stick snap turn), chosen in the lobby.
// - Controls: trigger = shoot (hold for auto), grip squeeze = reload,
//   A = cycle weapon, B = grenade, X = health pack, Y = flashlight.
// - Reload: point the gun straight down and hold. The grip still works.
// - The active weapon's model sits on both controller grips.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeWeaponMesh, makeGloveMesh } from '../world/weapons3d.js';

// Quest touch controller gamepad button indices (xr-standard mapping):
// 0 trigger, 1 squeeze, 3 stick press, 4 A/X, 5 B/Y.
const BTN_STICK = 3, BTN_AX = 4, BTN_BY = 5;

// How long the gun must point at the floor before it reloads.
const RELOAD_HOLD = 0.35;

// How far down -Z the barrel tip sits on each weapon model, so tracers and
// muzzle flash leave the gun and not the player's wrist.
const MUZZLE = { pistol: 0.16, akimbo: 0.14, smg: 0.39, shotgun: 0.48, ak: 0.52, machete: 0.45 };

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
    this.weaponKind = 'pistol';
    this._q = new THREE.Quaternion();           // scratch, avoid per-frame allocation
    this._fwd = new THREE.Vector3();
    this.downT = 0;                             // how long the gun has pointed down
    this.downArmed = true;                      // one reload per gesture

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
          // Left squeeze is contextual: patch the base wall if you are
          // standing at a damaged bit during prep, otherwise drop a mine.
          const pos = grip.getWorldPosition(new THREE.Vector3());
          if (!ctx.actions.repair()) ctx.actions.mineAt(pos);
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
        // Handedness decides which hand holds the gun, so re-dress now
        // that we finally know which grip is which.
        this._dressHands();
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
  // ONE weapon, in the hand that is actually holding it.
  //
  // Every grip used to get a full copy of the model, so a player with
  // dual pistols saw a gun in each hand AND the flat-mode viewmodel
  // hanging off the camera: three weapons for two hands. Now only akimbo
  // arms both hands; everything else is the dominant hand, and the free
  // hand gets a glove so it is still visibly a hand.
  setWeaponModel(kind) {
    this.weaponKind = kind;
    this._dressHands();
  }

  _dressHands() {
    const kind = this.weaponKind;
    const twoHanded = kind === 'akimbo';
    for (let i = 0; i < this.gripWeapons.length; i++) {
      const holder = this.gripWeapons[i];
      const grip = this.grips[i];
      // Until handedness arrives from the 'connected' event, treat the
      // first grip as the main hand so something is always visible.
      const isMain = this.hands.right ? grip === this.hands.right : i === 0;
      const want = (twoHanded || isMain) ? kind : 'glove';
      if (holder.userData.shown === want) continue;
      holder.userData.shown = want;
      holder.clear();
      holder.add(want === 'glove' ? makeGloveMesh() : makeWeaponMesh(kind));
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
    return this._muzzle(c);
  }

  _fireFrom(controller) {
    this._alignWeapons();
    const { origin, dir } = this._muzzle(controller);
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

  // FOUNDATION BUG 3: the weapon pointed roughly 45 degrees off the aim.
  //
  // WebXR gives two poses per controller. The GRIP pose is the hand: its
  // origin is the palm, and on Oculus Touch its forward axis is tilted well
  // away from where the user thinks they are pointing. The TARGET RAY pose
  // is the pointing direction. Three.js exposes them as getControllerGrip(i)
  // and getController(i).
  //
  // The gun models hung off the grip (right place, wrong angle) while shots
  // fired along the target ray. That gap is the whole bug, and its size is
  // controller-specific, so we do not hardcode an angle: we read the live
  // rotation between the two poses and cancel it out. The gun then sits in
  // the hand AND points exactly where the shot goes, on any headset.
  _alignWeapons() {
    for (let i = 0; i < this.gripWeapons.length; i++) {
      const grip = this.grips[i], ray = this.controllers[i], holder = this.gripWeapons[i];
      if (!grip || !ray || !holder) continue;
      // Both poses share rig.group as their parent, so local quaternions
      // compose directly: holderLocal = grip^-1 * targetRay.
      holder.quaternion.copy(this._q.copy(grip.quaternion).invert().multiply(ray.quaternion));
      // Re-apply the reload cant on top of the aim alignment (the pose
      // pass writes rotation.z, which this copy would otherwise erase).
      if (holder.userData.reloadRoll) holder.rotateZ(holder.userData.reloadRoll);
    }
  }

  // RELOAD BY POINTING THE GUN AT THE FLOOR.
  //
  // In VR you never see the flat-mode reload animation, so reloading had
  // no readable trigger and no feedback. Pointing the barrel straight
  // down is the standard VR gesture and it is one you cannot do by
  // accident while fighting. Hold it briefly, and the gun reloads.
  _reloadGesture(dt) {
    const grip = this.hands.right || this.grips[0];
    const i = this.grips.indexOf(grip);
    const holder = i >= 0 ? this.gripWeapons[i] : null;
    if (!holder) return;
    this._fwd.set(0, 0, -1).applyQuaternion(holder.getWorldQuaternion(this._q));
    // -0.85 is about 32 degrees of slack around straight down: deliberate
    // enough that lowering the gun to walk does not trigger it.
    const pointingDown = this._fwd.y < -0.85;
    if (!pointingDown) {
      this.downT = 0;
      this.downArmed = true;
      this.ctx.actions.setReloadHint(0);
      return;
    }
    this.downT += dt;
    // Feed the hold back to the game so the weapon can show it filling.
    this.ctx.actions.setReloadHint(Math.min(1, this.downT / RELOAD_HOLD));
    if (this.downT >= RELOAD_HOLD && this.downArmed) {
      this.downArmed = false;
      this.ctx.actions.reload();
    }
  }

  // The VR reload animation. There is no camera-mounted viewmodel in the
  // headset, so the weapon in your hand has to carry the whole state:
  // it cants over while the magazine is worked, and a charge light on it
  // fills while you hold the barrel down.
  setReloadPose(arsenal, hint) {
    for (let i = 0; i < this.gripWeapons.length; i++) {
      const holder = this.gripWeapons[i];
      if (holder.userData.shown === 'glove') continue;
      let roll = 0, drop = 0;
      if (arsenal.reloading && arsenal.reloadTotal > 0) {
        const p = 1 - arsenal.reloadT / arsenal.reloadTotal;
        const dip = Math.sin(Math.min(1, p * 1.25) * Math.PI);
        roll = dip * 1.1;                     // cant it over to work the mag
        drop = dip * 0.06;
      } else if (hint > 0) {
        roll = hint * 0.25;                   // it starts to tip as you hold
      }
      holder.userData.reloadRoll = roll;
      holder.position.y = -drop;
      // The charge light: amber while you hold the gesture, green the
      // moment the fresh magazine is in.
      let lamp = holder.userData.lamp;
      if (!lamp) {
        lamp = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.018),
          new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0xffa030 }));
        lamp.position.set(0.026, 0.03, 0.02);
        holder.add(lamp);
        holder.userData.lamp = lamp;
      }
      const charging = !arsenal.reloading && hint > 0;
      lamp.material.emissive.setHex(arsenal.reloading ? 0xffa030 : charging ? 0xffd060 : 0x30ff70);
      lamp.material.emissiveIntensity = arsenal.reloading ? 1.8
        : charging ? 0.4 + 2.2 * hint
        : (arsenal.hudInfo && arsenal.hudInfo().mag === 0 ? 0.2 : 1.0);
    }
  }

  // World-space barrel tip of a controller's weapon model.
  _muzzle(controller) {
    const i = this.controllers.indexOf(controller);
    const holder = i >= 0 ? this.gripWeapons[i] : null;
    const origin = (holder || controller).getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion((holder || controller).getWorldQuaternion(new THREE.Quaternion()));
    origin.addScaledVector(dir, MUZZLE[this.weaponKind] ?? 0.2);
    return { origin, dir };
  }

  update(dt) {
    if (!this.active) return;
    const session = this.ctx.renderer.xr.getSession();
    if (!session) return;
    this._alignWeapons();
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
        if (pressed(BTN_AX)) this.ctx.actions.cycle();          // A
        if (pressed(BTN_BY)) this._grenadeFrom(src);            // B
        if (pressed(BTN_STICK)) this.ctx.actions.throwCycle();  // R-stick press
      } else if (src.handedness === 'left') {
        if (pressed(BTN_AX)) this.ctx.actions.pack();           // X
        if (pressed(BTN_BY)) this.ctx.actions.flashlight();     // Y
        if (pressed(BTN_STICK)) this.ctx.actions.nightVision(); // L-stick press
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
