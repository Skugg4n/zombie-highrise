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
import { makeWeaponMesh, makeFlashlightMesh, makeUnderBarrelLight } from '../world/weapons3d.js';
import { WristDisplay, WeaponAmmoTag, CalibrationCard, DEFAULT_WRIST_TILT } from '../world/wrist.js';
import { VrPanel } from '../world/vrpanel.js';

// Quest touch controller gamepad button indices (xr-standard mapping):
// 0 trigger, 1 squeeze, 3 stick press, 4 A/X, 5 B/Y.
const BTN_STICK = 3, BTN_AX = 4, BTN_BY = 5;

// How long the gun must point at the floor before it reloads.
const RELOAD_HOLD = 0.35;
// Long enough that a reload squeeze at the hip never trips it, short
// enough that stowing feels immediate.
const HOLSTER_HOLD = 0.35;

// Six buttons in the xr-standard layout, all released. Used only by the
// test seam below.
function fakeButtons() {
  return Array.from({ length: 6 }, () => ({ pressed: false }));
}

// How far the slide travels back on a shot. Small: this is a 3 cm part
// on a weapon held at arm's length, and overdoing it reads as a toy.
const SLIDE_TRAVEL = 0.032;

// How far down -Z the barrel tip sits on each weapon model, so tracers and
// muzzle flash leave the gun and not the player's wrist.
// Barrel length per weapon, for the muzzle position. `akimbo` is the same
// as `pistol` in VR because each hand now holds a single pistol; the 0.14
// here was measured off the two-guns-in-one-object flat viewmodel.
const MUZZLE = { pistol: 0.16, akimbo: 0.16, smg: 0.39, shotgun: 0.48, ak: 0.52, machete: 0.45 };

// Module scratch. Allocating vectors inside a per-frame gesture check is
// how a headset finds its garbage collector.
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3(), _q1 = new THREE.Quaternion();

export class VRInput {
  constructor(ctx) {
    this.ctx = ctx;
    this.button = document.getElementById('btn-vr');
    this.active = false;
    this.snapReady = { right: true };
    this.controllers = [];
    this.armFrames = [];        // grip-parented, aligned like the weapon
    this.grips = [];
    this.gripWeapons = [];
    this.hands = { left: null, right: null };   // handedness -> grip (by connection order)
    this.fireHeld = false;
    this.firingController = null;
    this.prevButtons = new Map();               // inputSource -> [bool,...]
    this.wishX = 0;
    this.wishZ = 0;   // desired velocity, m/s; the controller applies it
    this.weaponKind = 'pistol';
    this._q = new THREE.Quaternion();           // scratch, avoid per-frame allocation
    this._fwd = new THREE.Vector3();
    this.downT = 0;                             // how long the gun has pointed down
    this.downArmed = true;                      // one reload per gesture

    // THE STRATEGY VIEW and THE HOLSTER.
    // Ola: "the wrist is the TRIGGER, not the whole surface." So the wrist
    // display is a glance detector: hold your forearm up and look at it,
    // and the big panel unfolds. Look away and it folds again after a
    // moment, because a map welded open in front of your face is worse
    // than no map.
    this.glanceT = 0;                           // seconds spent looking at the wrist
    this.strategyOpen = false;
    this.awayT = 0;                             // seconds spent looking away from the panel
    this.holstered = false;                     // is the main weapon on the hip?
    this.holster = null;                        // the loop on the hip, a real object
    this.pointer = null;                        // the beam from the pointing hand

    const renderer = ctx.renderer;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      controller.addEventListener('selectstart', () => {
        // THE PANEL OWNS THE TRIGGER while it is open. You are pointing
        // at a map, not at the field, and a shot fired at your own
        // strategy display would be a comedy.
        if (this.strategyOpen && this.ctx.actions.strategyClick) {
          this.ctx.actions.strategyClick();
          return;
        }
        // BUG (Ola): "the flashlight fires bullets." Since the off hand
        // started carrying a torch, its trigger was still wired to the
        // gun. Only a hand actually holding a weapon can shoot.
        //
        // And the other half of the same thought, which was missing:
        // if the hand is NOT holding a gun it is holding the torch, so
        // its trigger is the torch's switch. Ola: "the flashlight in the
        // hand does not toggle on the trigger. It should." Before this
        // the only switch was the F key, which does not exist in a
        // headset, so the lamp could only ever be turned on by the level
        // being dark.
        if (!this._holdsGun(controller)) {
          if (this.ctx.actions.flashlight) this.ctx.actions.flashlight();
          return;
        }
        this.firingController = controller;
        this.fireHeld = true;
        this.sinceShot = 0;
        this._fireFrom(controller);
      });
      controller.addEventListener('selectend', () => {
        if (this.firingController === controller) this.fireHeld = false;
      });
      ctx.rig.group.add(controller);

      const grip = renderer.xr.getControllerGrip(i);
      // Right squeeze reloads; left squeeze drops a mine at the hand.
      controller.addEventListener('squeezestart', () => {
        // THE HOLSTER IS A PLACE, NOT A BUTTON, and it is checked FIRST
        // for EITHER hand. Reaching to your own hip and squeezing can
        // only sensibly mean one thing, and making it depend on which
        // hand meant that when handedness had not arrived from the
        // runtime (`this.hands` is filled in by a `connected` event that
        // does not always fire) the gesture went to the wrong branch and
        // reloaded instead.
        // ONLY THE GUN HAND USES THE HOLSTER, and only on a HOLD.
        //
        // Your hip and your resting hand are in the same place, so being
        // near the holster cannot mean "I meant the holster". A quick
        // squeeze there still reloads, exactly as it does everywhere
        // else; holding for a third of a second stows or draws. That is
        // the same hold-to-act vocabulary the wall repair and the door
        // already use, so it is a gesture the game has taught already.
        if (grip === this.gripFor('right') && this._handAtHolster(grip)) {
          this._holsterHold = 0;
          this._holsterFired = false;
        } else if (this.gripFor('left') === grip) {
          // Left squeeze is contextual: HOLD it to patch the base wall if
          // you are standing at a damaged bit, otherwise it drops a mine.
          // The hold is the same interaction the flat player gets, with
          // the same ring, because the ring is world-space.
          if (ctx.actions.canRepairHere()) {
            ctx.actions.repairHold(true);
          } else {
            ctx.actions.mineAt(grip.getWorldPosition(new THREE.Vector3()));
          }
        } else {
          ctx.actions.reload();
        }
      });
      controller.addEventListener('squeezeend', () => {
        if (this.gripFor('left') === grip) ctx.actions.repairHold(false);
        // Let go before the hold completed: you meant the reload.
        if (this._holsterHold !== null && !this._holsterFired) {
          ctx.actions.reload();
        }
        this._holsterHold = null;
        this._holsterFired = false;
      });
      // THE ARM FRAME. Same alignment as the weapon holder, and nothing
      // else on top of it.
      //
      // This exists because of the wrist display, and because of an error
      // worth writing down. The weapon's axes ARE known good: -Z is the
      // barrel and +Y is the top of the gun, which is why the gun looks
      // right in the hand and shoots where it points. But those axes are
      // the HOLDER's, and the holder is not the grip: _alignWeapons sets
      // holder = grip^-1 * targetRay precisely because the two differ,
      // and on Oculus Touch they differ by about 47 degrees (LESSONS.md,
      // "the VR weapon points about 45 degrees away from where it
      // shoots"). Deriving the wrist display's placement from the
      // weapon's axes and then applying it in GRIP space carries that
      // whole 47 degrees straight into the answer.
      //
      // So the display gets the weapon's frame itself, rather than a
      // description of it. The frame carries no reload cant and no recoil
      // kick, because a watch does not jump when you fire.
      const armFrame = new THREE.Group();
      grip.add(armFrame);
      this.armFrames.push(armFrame);
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
        // Re-dress, or the hand assignment and what each hand is HOLDING
        // fall out of step: a controller going to sleep would move
        // gripFor('right') to the other hand while the meshes stayed put,
        // and you could end up holstering the flashlight.
        this._dressHands();
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
        // NO HAND TRACKING. Nothing in the game supports it (no hand
        // meshes, no pinch gestures), and asking for it half-enables
        // something that breaks the wrist mount: with controllers the
        // grip and target-ray poses are two fixed frames on one piece of
        // plastic, so the arm frame is rigid, but with tracked hands the
        // ray is derived from a finger and the display would swim along
        // the forearm as he points. Noted in OPEN-QUESTIONS.md.
        optionalFeatures: ['bounded-floor'],
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
  // ONE weapon, in the hand that is actually holding it, and a
  // FLASHLIGHT in the other.
  //
  // Every grip used to get a full copy of the model, so a player with
  // dual pistols saw a gun in each hand AND the flat-mode viewmodel
  // hanging off the camera: three weapons for two hands. Now only akimbo
  // arms both hands, and when it does the light moves under the barrel
  // rather than vanishing.
  setWeaponModel(kind) {
    this.weaponKind = kind;
    this._dressHands();
  }

  _dressHands() {
    // The hip loop exists whenever there is a body to hang it on. Built
    // here rather than lazily on first reach, because a holster you
    // cannot SEE is not something a player will ever try to reach for.
    this._buildHolster();
    const kind = this.weaponKind;
    const bothHands = kind === 'akimbo';
    // FOUR GUNS. Ola: "köper man 2 pistoler i VR så får man två i varje
    // hand!" The 'akimbo' MESH is two pistols side by side, because on a
    // flat screen one viewmodel has to represent both. Handing that mesh
    // to each hand gives two hands holding two guns each. In VR akimbo
    // means one pistol per hand, which is what the word means.
    const perHand = bothHands ? 'pistol' : kind;
    this.lamps = [];
    for (let i = 0; i < this.gripWeapons.length; i++) {
      const holder = this.gripWeapons[i];
      const grip = this.grips[i];
      // Until handedness arrives from the 'connected' event, treat the
      // first grip as the main hand so something is always visible.
      const isMain = this.hands.right ? grip === this.hands.right : i === 0;
      const want = (bothHands || isMain) ? perHand : 'light';
      if (holder.userData.shown !== want) {
        holder.userData.shown = want;
        holder.userData.lamp = null;
        holder.userData.ammoTag = null;
        holder.userData.slide = null;
        holder.userData.mag = undefined;      // re-found on the new mesh
        holder.userData.flash = null;
        holder.clear();
        if (want === 'light') {
          holder.add(makeFlashlightMesh());
        } else {
          // perHand, NOT kind. The whole point of perHand is that the
          // 'akimbo' mesh is two pistols in one object, and this line was
          // still asking for it, so each hand got both guns. The variable
          // was computed, used for the label, and then dropped on the
          // floor here: the fix existed everywhere except where it acts.
          holder.add(makeWeaponMesh(perHand));
          // Ammo has to be readable without looking away from the fight,
          // so it rides on the gun itself.
          const tag = new WeaponAmmoTag();
          holder.add(tag.mesh);
          holder.userData.ammoTag = tag;
          // Both hands full: the light goes under the barrel.
          if (bothHands && !isMain) holder.add(makeUnderBarrelLight());
        }
      }
    }
    this._placeWrist();
    // The dressing pass called holder.clear(), so anything parented into
    // a holder is gone, and that includes the torch beam. Switching
    // weapons on a dark level disconnected the light until you toggled it
    // off and on again, and switching to akimbo did it every time
    // because both hands change at once.
    this._redressed = true;
    if (this.handLightOn) {
      const was = this.handLightOn;
      this.handLightOn = null;
      this.setHandLight(was);
    }
  }

  // Is this controller's hand holding a weapon, as opposed to the torch?
  _holdsGun(controller) {
    const i = this.controllers.indexOf(controller);
    if (i < 0) return true;              // unknown hand: do not break firing
    const holder = this.gripWeapons[i];
    if (!holder || holder.userData.shown === 'light') return false;
    // A holstered weapon is on your hip, not in your hand. Without this
    // the empty hand would still fire an invisible pistol, which is the
    // same class of bug as the flashlight that fired bullets.
    if (this.holstered && holder.parent === this.holsterSlot) return false;
    return true;
  }

  // The wrist display lives on the LEFT forearm. Left is the off hand for
  // the default player, so the gesture is a natural wrist turn rather
  // than taking the gun off target.
  _placeWrist() {
    if (!this.wrist) {
      this.wrist = new WristDisplay();
      // A saved calibration wins over any default. Once Ola reads a pair
      // of bracelet coordinates out, that is where it lives, permanently.
      const saved = (() => {
        try { return JSON.parse(localStorage.getItem('zhr-wrist') || 'null'); }
        catch { return null; }
      })();
      if (saved) this.wrist.setCalibration(saved.pip, saved.tilt);
    }
    // Mounted on the ARM FRAME, not the grip: see the comment where the
    // arm frames are built. The grip and the frame the weapon uses differ
    // by about 47 degrees on Touch controllers, and putting a
    // weapon-derived offset in grip space carries all 47 into the result.
    const leftGrip = this.gripFor('left');
    const left = this.armFrames[this.grips.indexOf(leftGrip)] || leftGrip;
    if (left) {
      this.wrist.attachTo(left);
      if (this.wrist.bracelet) left.add(this.wrist.bracelet);
    }
  }

  // Step the bracelet: `which` is 'pip' or 'tilt'. Returns the new label.
  // The calibration card, in front of the face where the debug menu goes.
  // The bracelet on the arm stays as a secondary hint, but it is no
  // longer the thing you are supposed to read: Ola spent a whole session
  // unable to see it, because it was pinned to the same grip with the
  // same wrong orientation as the display it was meant to fix.
  getCalCard() {
    if (!this.calCard) {
      this.calCard = new CalibrationCard();
      this.calCard.attachTo(this.ctx.camera);
    }
    return this.calCard;
  }

  calibrateWrist(which, delta) {
    if (!this.wrist) this._placeWrist();
    const w = this.wrist;
    w.showBracelet(true);
    const label = which === 'tilt'
      ? w.setCalibration(w.calPip, w.calTilt + delta)
      : w.setCalibration(w.calPip + delta, w.calTilt);
    const card = this.getCalCard();
    card.show(true);
    card.draw(w.calPip, w.calTilt, label);
    try {
      localStorage.setItem('zhr-wrist', JSON.stringify({ pip: w.calPip, tilt: w.calTilt }));
    } catch { /* private browsing */ }
    return label;
  }

  // Back to where the derivation says it belongs, for when a nudge has
  // made things worse. There has to be a way back from a calibration.
  resetWrist() {
    if (!this.wrist) this._placeWrist();
    // 1A is the derived home, not 1C. The reset went to the middle of the
    // tilt list, which is a different place from the one the code calls
    // "the default" everywhere else.
    const label = this.wrist.setCalibration(0, DEFAULT_WRIST_TILT);
    const card = this.getCalCard();
    card.show(true);
    card.draw(this.wrist.calPip, this.wrist.calTilt, label);
    try {
      localStorage.removeItem('zhr-wrist');
    } catch { /* private browsing */ }
    return label;
  }

  finishWristCalibration() {
    if (this.wrist) this.wrist.showBracelet(false);
    if (this.calCard) this.calCard.show(false);
    return this.wrist ? this.wrist.label() : '';
  }

  // The modal panel. Created on demand and parented to the camera, so it
  // is always in front of the player however they turn.
  getPanel() {
    if (!this.panel) {
      this.panel = new VrPanel();
      this.panel.attachTo(this.ctx.camera);
    }
    return this.panel;
  }

  // TEST SEAM. A real XR session cannot be created headlessly, but every
  // line of VR logic above this can run without one: three creates the
  // controller and grip groups on demand. This flips the session flag so
  // a probe can drive the VR interface and assert on it, which is the only
  // way "downed in VR is a softlock" gets caught by a test rather than by
  // Ola putting the headset on.
  debugForceActive(on) {
    if (this.active === on) return;
    this.active = on;
    // update() bails without a session, so a probe would exercise none of
    // the per-frame VR logic. A session with no input sources lets every
    // pose-driven path run (alignment, the reload gesture, recoil) while
    // the gamepad loop simply finds nothing to read.
    // A fake input source with a gamepad, so the BUTTON PATH runs. With an
    // empty inputSources list the whole per-controller loop is skipped,
    // which meant every face-button binding, including the one that
    // restarts a lost run, was never exercised by any test.
    this._fakeSession = on ? {
      inputSources: [
        { handedness: 'right', gamepad: { buttons: fakeButtons(), axes: [0, 0, 0, 0] } },
        { handedness: 'left', gamepad: { buttons: fakeButtons(), axes: [0, 0, 0, 0] } },
      ],
    } : null;
    this._dressHands();
    this.ctx.onSessionChange(on);
  }

  // TEST SEAM: press a face button the way a controller does, through the
  // real gamepad loop, rather than calling the handler directly. The panel
  // that restarts a lost run is reached ONLY through that loop, so calling
  // its handler proves nothing about whether a player can reach it.
  debugPressButton(hand, index) {
    if (!this._fakeSession) return false;
    const src = this._fakeSession.inputSources.find((s) => s.handedness === hand);
    if (!src) return false;
    src.gamepad.buttons[index] = { pressed: true };
    this.update(1 / 60);                    // the frame that sees the press
    src.gamepad.buttons[index] = { pressed: false };
    this.update(1 / 60);                    // and the frame that sees release
    return true;
  }

  // ---- The strategy view ----------------------------------------------
  //
  // GLANCE, DWELL, UNFOLD. The wrist display is the trigger: raise the
  // forearm so the screen faces you and look at it. Half a second of
  // that opens the big panel. It is a dwell rather than a button because
  // the gesture is the one you would make anyway to read a watch.
  //
  // Closing is the mirror: look away from the PANEL for a moment and it
  // folds. Not away from the wrist, which you naturally stop looking at
  // the instant the panel appears.
  _strategyGesture(dt) {
    this.sinceShot = (this.sinceShot || 99) + dt;
    const acts = this.ctx.actions;
    if (!acts.strategy) return;
    // The game owns whether the panel is open. Mirroring it here rather
    // than keeping a second copy means the trigger cannot be routed to a
    // panel that closed itself.
    this.strategyOpen = !!(acts.strategyOpen && acts.strategyOpen());
    const cam = this.ctx.camera;
    const eye = cam.getWorldPosition(_v1);
    const look = cam.getWorldDirection(_v2);

    if (!this.strategyOpen) {
      const w = this.wrist && this.wrist.group;
      if (!w) { this.glanceT = 0; return; }
      w.updateWorldMatrix(true, false);
      const at = w.getWorldPosition(_v3);
      const toWrist = _v4.copy(at).sub(eye);
      const dist = toWrist.length();
      if (dist < 0.12 || dist > 0.85) { this.glanceT = 0; return; }
      toWrist.divideScalar(dist);
      // Are you looking at it, and is it facing you? Both, or a wrist
      // that happens to drift through your sightline opens the map in the
      // middle of a fight.
      const facing = _v5.set(0, 0, 1).applyQuaternion(w.getWorldQuaternion(_q1));
      const looking = look.dot(toWrist);
      const presented = facing.dot(toWrist) < -0.45;
      // NOT WHILE A MENU IS UP. The glance gesture runs before the input
      // loop, so nothing else was stopping the map from unfolding on top
      // of the debug menu, and the panel then eats A, B, X and the stick
      // before the menu block sees them: the menu becomes unusable until
      // the panel is closed. Most likely of all during calibration, when
      // he is deliberately staring at his own wrist.
      if (acts.debugMenuOpen && acts.debugMenuOpen()) { this.glanceT = 0; return; }
      // NOT WHILE YOU ARE FIGHTING. A map that unfolds itself because you
      // happened to raise your gun hand is worse than no map, and the
      // display now correctly sits on top of the forearm, which is a
      // place a shooting stance can bring into view. The dwell alone is
      // not enough insurance.
      if (this.fireHeld || this.sinceShot < 1.2) {
        this.glanceT = 0;
        return;
      }
      if (looking > 0.86 && presented) {
        this.glanceT += dt;
        if (this.glanceT > 0.5) { this.glanceT = 0; acts.strategy(true); }
      } else {
        this.glanceT = Math.max(0, this.glanceT - dt * 2);
      }
      return;
    }

    // Open: point, and fold when you look away.
    this.glanceT = 0;
    const panelAt = acts.strategyCentre ? acts.strategyCentre() : null;
    if (panelAt) {
      const toPanel = _v3.set(panelAt[0], panelAt[1], panelAt[2]).sub(eye).normalize();
      this.awayT = look.dot(toPanel) < 0.6 ? this.awayT + dt : 0;
      if (this.awayT > 0.8) { this.awayT = 0; acts.strategy(false); return; }
    } else {
      // No panel centre means the game no longer thinks it is open, so
      // neither do we. Without this the two could disagree and the
      // trigger would keep being swallowed by a panel that is not there.
      this.strategyOpen = false;
      return;
    }
    // The pointing hand: the free one if the pistol is stowed, otherwise
    // the barrel. Ola asked for both, and this is both without a mode
    // switch: what you are holding decides.
    const ray = this._pointRay();
    if (ray && acts.strategyPoint) acts.strategyPoint(ray.origin, ray.dir);
  }

  // The ray you are aiming with. Barrel pointing uses the same target-ray
  // space the gun shoots along, so what you point at is what you would
  // hit: the panel is aimed at exactly like a target.
  _pointRay() {
    const useOff = this.holstered;
    const grip = this.gripFor(useOff ? 'left' : 'right');
    const i = this.grips.indexOf(grip);
    const controller = this.controllers[i];
    if (!controller) return null;
    controller.updateWorldMatrix(true, false);
    const origin = controller.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    return { origin, dir };
  }

  // ---- The holster --------------------------------------------------
  //
  // A visible loop on the right hip, parented to the play space so it
  // stays with your body rather than swinging with your head. Stowing the
  // pistol is what frees a hand for pointing at the map, and it is a
  // physical gesture rather than a menu because reaching for your hip is
  // the thing that feels good.
  _buildHolster() {
    if (this.holster) return this.holster;
    const g = new THREE.Group();
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.012, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.9 }));
    loop.rotation.x = Math.PI / 2;
    g.add(loop);
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.10, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x2b241c, roughness: 0.95 }));
    strap.position.set(0, 0.05, -0.03);
    g.add(strap);
    // The stowed weapon lives here, so it is visible on your hip and you
    // can see at a glance that you are unarmed.
    this.holsterSlot = new THREE.Group();
    this.holsterSlot.rotation.x = -0.5;
    g.add(this.holsterSlot);
    // Position is set every frame by _placeHolster(), because a hip is
    // attached to a body and not to the play space.
    this.holster = g;
    this.ctx.rig.group.add(g);
    this._placeHolster();
    return g;
  }

  // WHERE YOUR HIP ACTUALLY IS.
  //
  // Ola: "det går inte att sätta fast någon pistol i hölster." It was
  // pinned to a fixed spot near the RIG ORIGIN, and in roomscale the
  // player walks away from the rig origin: the camera moves, the rig does
  // not. So the loop sat wherever he had started the level, often several
  // metres behind him, and reaching for his own hip found nothing. This
  // is the same mistake as sampling the ground under the rig instead of
  // under the feet, which cost a whole version to find last time.
  //
  // Hip height is derived from eye height rather than assumed, so it is
  // in the right place for a tall player and a short one.
  _placeHolster() {
    if (!this.holster) return;
    const cam = this.ctx.camera;
    const eye = cam.position;                 // local to the rig
    // The camera matrix's third column IS its local +Z, and a camera
    // looks along -Z, so e[8] = sin(yaw) and e[10] = cos(yaw). Negating
    // both adds 180 degrees, which put the holster on the LEFT hip and
    // four centimetres BEHIND it: out of reach of the right hand, and
    // permanently inside the left hand's resting position, which turned
    // the left grip into a random stow-the-pistol button. Verified
    // numerically against the vendored three build rather than reasoned
    // about a second time.
    const yaw = Math.atan2(
      cam.matrix.elements[8], cam.matrix.elements[10]);   // heading only
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    this.holster.position.set(
      eye.x + right.x * 0.20 + fwd.x * 0.04,
      Math.max(0.55, eye.y * 0.56),
      eye.z + right.z * 0.20 + fwd.z * 0.04);
    this.holster.rotation.y = yaw;
  }

  // Is this hand close enough to the hip to mean it? Generous, because
  // reaching for your own hip in a headset is done by feel.
  _handAtHolster(grip) {
    if (!this.holster) return false;
    const a = grip.getWorldPosition(new THREE.Vector3());
    const b = this.holster.getWorldPosition(new THREE.Vector3());
    // 0.22, and PROXIMITY IS NOT THE WHOLE GESTURE (see setHolstered's
    // caller). A holster sits at the hip and a relaxed arm hangs at the
    // hip: they are about 0.18 m apart, so no radius can tell them
    // apart. Widening this to 0.34 to compensate for the holster being
    // in the wrong place mirrored onto the right hand exactly the bug
    // that had just been removed from the left, and the right grip is
    // the RELOAD. Lowering the gun and squeezing is how everyone
    // reloads; it would have stowed the pistol instead, mid-wave.
    //
    // The distinction is the HOLD, not the distance.
    return a.distanceTo(b) < 0.22;
  }

  // The hold that separates "stow this" from "reload this". Fires while
  // the grip is still held, because a gesture that only resolves when you
  // let go feels like it did not work.
  _stepHolsterHold(dt) {
    if (this._holsterHold === null || this._holsterHold === undefined) return;
    if (this._holsterFired) return;
    this._holsterHold += dt;
    if (this._holsterHold >= HOLSTER_HOLD) {
      this._holsterFired = true;
      this.setHolstered(!this.holstered);
    }
  }

  // Light it up when a hand is close enough to use it, so "am I near it"
  // is a thing you can SEE rather than a thing you find out by squeezing
  // and getting a reload instead.
  _highlightHolster() {
    if (!this.holster) return;
    // Lit only for the hand that can actually use it, or the highlight
    // promises something the squeeze will not do.
    const gun = this.gripFor('right');
    const near = !!gun && this._handAtHolster(gun);
    if (near === this._holsterLit) return;
    this._holsterLit = near;
    this.holster.traverse((o) => {
      if (!o.material || !o.material.emissive) return;
      o.material.emissive.setHex(near ? 0xe0a33c : 0x000000);
      o.material.emissiveIntensity = near ? 1.4 : 0;
    });
  }

  // Stow or draw. The weapon mesh physically moves between the hand and
  // the hip, so what you see is what is true.
  setHolstered(on) {
    if (this.holstered === on) return this.holstered;
    this._buildHolster();
    const grip = this.gripFor('right');
    const i = this.grips.indexOf(grip);
    const holder = this.gripWeapons[i];
    if (!holder) return this.holstered;
    // You cannot holster a torch. Without this, a hand reassignment
    // (which a sleeping controller can cause) could put the flashlight in
    // the holster and leave the gun in mid-air.
    if (!this.holstered && holder.userData.shown === 'light') return this.holstered;
    this.holstered = on;
    if (on) {
      this.holsterSlot.add(holder);
      holder.position.set(0, 0, 0);
      holder.rotation.set(0, 0, 0);
    } else {
      grip.add(holder);
      holder.position.set(0, 0, 0);
      holder.rotation.set(0, 0, 0);
    }
    if (this.ctx.actions.setHolstered) this.ctx.actions.setHolstered(on);
    return this.holstered;
  }

  // Which grip is which hand. `this.hands` is filled in by the controller
  // `connected` event, which does not fire for every runtime and does not
  // fire at all in a test, so every caller needs the same fallback: the
  // main hand is grip 0 and the off hand is grip 1. That fallback was
  // written out by hand in four places and now lives here once.
  gripFor(hand) {
    if (hand === 'right') return this.hands.right || this.grips[0];
    return this.hands.left || this.grips[1] || this.grips[0];
  }

  // TEST SEAM: the holster, as a player experiences it. Move the hand to
  // the hip and squeeze: the same listener a real controller calls.
  // TEST SEAM: squeeze the gun hand's grip with the arm WHERE IT IS,
  // rather than teleported onto the holster. This is the gesture that the
  // holster check hijacked, and no probe could see it because the only
  // holster seam moved the hand onto the target first.
  // holdSeconds: how long the grip is held before letting go. The
  // holster is a HOLD now, so a seam that only presses and releases can
  // only ever test the quick squeeze.
  debugSqueezeAt(hand, x, y, z, holdSeconds = 0) {
    const grip = this.gripFor(hand);
    const i = this.grips.indexOf(grip);
    const controller = this.controllers[i];
    if (!controller) return null;
    grip.position.set(x, y, z);
    grip.updateMatrix();
    grip.updateWorldMatrix(true, false);
    const atHolster = this._handAtHolster(grip);
    controller.dispatchEvent({ type: 'squeezestart' });
    // Run the hold forward in real frames' worth of time.
    let t = 0;
    while (t < holdSeconds) { this._stepHolsterHold(1 / 60); t += 1 / 60; }
    controller.dispatchEvent({ type: 'squeezeend' });
    return { atHolster, holstered: this.holstered, held: holdSeconds };
  }

  debugReachHolster() {
    this._buildHolster();
    const grip = this.gripFor('right');
    const i = this.grips.indexOf(grip);
    const controller = this.controllers[i];
    if (!controller || !this.holster) return null;
    // Put the hand where the hip is, exactly as reaching for it would.
    const at = this.holster.getWorldPosition(new THREE.Vector3());
    this.ctx.rig.group.worldToLocal(at);
    grip.position.copy(at);
    // Controller groups run with matrixAutoUpdate off, because WebXR
    // writes their matrix directly every frame. Moving one by setting
    // .position therefore does nothing until the matrix is recomposed by
    // hand, which is why the first version of this reached for the hip
    // and stayed where it was.
    grip.updateMatrix();
    grip.updateWorldMatrix(true, false);
    const near = this._handAtHolster(grip);
    controller.dispatchEvent({ type: 'squeezestart' });
    // HOLD it: a quick squeeze at the hip is the reload now, so a seam
    // that only taps would be testing the wrong gesture.
    let t = 0;
    while (t < 0.5) { this._stepHolsterHold(1 / 60); t += 1 / 60; }
    controller.dispatchEvent({ type: 'squeezeend' });
    return { near, holstered: this.holstered, visible: !!this.holster.visible };
  }

  // TEST SEAM: pull a trigger, through the listener the runtime calls.
  // Returns whether that hand was holding a gun, which is the thing that
  // decides whether the trigger shoots or works the torch.
  debugPullTrigger(hand) {
    const grip = this.gripFor(hand);
    const i = this.grips.indexOf(grip);
    const controller = this.controllers[i];
    if (!controller) return null;
    const armed = this._holdsGun(controller);
    controller.dispatchEvent({ type: 'selectstart' });
    controller.dispatchEvent({ type: 'selectend' });
    return { armed };
  }

  // Called every frame from the game with everything a flat player can
  // read off the screen. Nothing important may exist only as flat HUD.
  setWristState(state, dt = 0) {
    if (!this.wrist) return false;
    this.wrist.step(dt);
    return this.wrist.update(state);
  }

  // Ammo tag on whichever hand is holding a gun.
  setAmmoTag(mag, magMax, reloading) {
    for (const holder of this.gripWeapons) {
      const tag = holder.userData.ammoTag;
      if (tag) tag.update(mag, magMax, reloading);
    }
  }

  // The hand light. `on` is decided by the game: a lit torch in bright
  // daylight is absurd, so holdout levels leave it dark and the hand just
  // carries the tool.
  setHandLight(on) {
    // `_redressed` is raised by _dressHands, which calls holder.clear()
    // and therefore throws away the beam's parent. Without noticing that,
    // this early return meant switching weapons on a dark level
    // disconnected the torch until you turned it off and on again, and
    // switching to akimbo did it every time because both hands change.
    if (this.handLightOn === on && !this._redressed) return;
    this._redressed = false;
    this.handLightOn = on;
    for (const holder of this.gripWeapons) {
      holder.traverse((o) => {
        if (o.material && o.material.emissive && o.geometry
          && o.geometry.type === 'CircleGeometry') {
          o.material.emissiveIntensity = on ? 2.2 : 0;
        }
      });
    }
    if (!this.handBeam) {
      // One real spot light, parented to whichever hand carries the lamp.
      this.handBeam = new THREE.SpotLight(0xffe9c0, 0, 22, 0.55, 0.6, 1.0);
      this.handBeamTarget = new THREE.Object3D();
      this.handBeamTarget.position.set(0, 0, -6);
      this.handBeam.target = this.handBeamTarget;
    }
    const carrier = this.gripWeapons.find((h) => h.userData.shown === 'light')
      || this.gripWeapons[0];
    if (carrier && this.handBeam.parent !== carrier) {
      carrier.add(this.handBeam, this.handBeamTarget);
    }
    this.handBeam.intensity = on ? 5.5 : 0;
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
      // The arm frame gets the same base alignment and stops there: no
      // reload cant, no recoil. Anything mounted on the forearm rides
      // this instead of the grip.
      const arm = this.armFrames[i];
      if (arm) arm.quaternion.copy(this._q);
      // Re-apply the reload cant on top of the aim alignment (the pose
      // pass writes rotation.z, which this copy would otherwise erase).
      if (holder.userData.reloadRoll) holder.rotateZ(holder.userData.reloadRoll);
      // Muzzle rise from recoil, on top of the aim alignment.
      const rec = holder.userData.recoil || 0;
      if (rec > 0) {
        holder.rotateX(rec);
        holder.position.z = rec * 0.35;
      } else if (holder.position.z !== 0) {
        holder.position.z = 0;
      }
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

  // Recoil in VR: the weapon snaps back and up in the hand and settles.
  // It cannot move the player's aim (their real hand IS the aim), so the
  // accuracy cost of fast fire lands in spread instead. This is the part
  // you can see and feel.
  addRecoil(hand, amount) {
    const grip = hand === 'left' ? (this.hands.left || this.grips[1])
      : (this.hands.right || this.grips[0]);
    const i = this.grips.indexOf(grip);
    const holder = i >= 0 ? this.gripWeapons[i] : null;
    if (!holder) return;
    holder.userData.recoil = Math.min(0.09, (holder.userData.recoil || 0) + amount * 2.4);
    // The slide cycle and the flash are their own timers: they are a fixed
    // mechanical event, not proportional to how hard the shot kicked.
    holder.userData.cycleT = 1;
    holder.userData.flashT = 1;
  }

  // What makes a shot read in VR is the WEAPON doing something, since the
  // aim must never be moved for the player. Three things happen at once:
  // the whole gun rotates back about the grip, the slide cycles, and the
  // muzzle flashes. Ola: "the pistol has no visible recoil in VR, so the
  // shot feels dead."
  _stepRecoil(dt) {
    for (const holder of this.gripWeapons) {
      const r = holder.userData.recoil || 0;
      if (r > 0) holder.userData.recoil = Math.max(0, r - dt * 0.55);

      // The slide: snaps back fast, returns slower, exactly like the real
      // thing. 0.09 s all in, which is short enough to read as mechanical
      // rather than as the gun coming apart.
      const c = holder.userData.cycleT || 0;
      if (c > 0) {
        holder.userData.cycleT = Math.max(0, c - dt / 0.09);
        const slide = holder.userData.slide
          || (holder.userData.slide = holder.getObjectByName('slide') || null);
        if (slide) {
          if (slide.userData.homeZ === undefined) slide.userData.homeZ = slide.position.z;
          // Back in the first third, forward over the rest.
          const t = 1 - holder.userData.cycleT;
          const back = t < 0.34 ? t / 0.34 : 1 - (t - 0.34) / 0.66;
          slide.position.z = slide.userData.homeZ + back * SLIDE_TRAVEL;
        }
      }

      // The muzzle flash: a light AND a visible flare, because a light
      // alone is invisible against a bright daylight field.
      const f = holder.userData.flashT || 0;
      if (f > 0) {
        holder.userData.flashT = Math.max(0, f - dt / 0.055);
        const fl = holder.userData.flash || this._makeMuzzleFlash(holder);
        fl.visible = true;
        fl.scale.setScalar(0.55 + 1.5 * holder.userData.flashT);
        fl.rotation.z += dt * 22;
        fl.children[0].material.opacity = holder.userData.flashT;
        fl.children[1].intensity = 9 * holder.userData.flashT;
      } else if (holder.userData.flash && holder.userData.flash.visible) {
        holder.userData.flash.visible = false;
        holder.userData.flash.children[1].intensity = 0;
      }
    }
  }

  // A flare quad plus a point light, parked at the barrel tip.
  _makeMuzzleFlash(holder) {
    const g = new THREE.Group();
    const flare = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false,
      }));
    g.add(flare);
    const light = new THREE.PointLight(0xffc070, 0, 6, 2);
    g.add(light);
    g.position.set(0, 0, -(MUZZLE[this.weaponKind] ?? 0.2));
    g.visible = false;
    holder.add(g);
    holder.userData.flash = g;
    return g;
  }

  // The VR reload animation. There is no camera-mounted viewmodel in the
  // headset, so the weapon in your hand has to carry the whole state:
  // it cants over while the magazine is worked, and a charge light on it
  // fills while you hold the barrel down.
  setReloadPose(arsenal, hint) {
    for (let i = 0; i < this.gripWeapons.length; i++) {
      const holder = this.gripWeapons[i];
      if (holder.userData.shown === 'light') continue;   // the torch does not reload
      // THE RELOAD, IN THREE BEATS.
      //
      // Ola: "the reload animation in VR is a slow quarter turn left and
      // back, and it is not readable as a reload." It was one sine sweep
      // rolling the whole gun over and back, which is a gun tipping, not
      // a reload. What makes a reload legible is the MAGAZINE: you see
      // the old one leave and a new one arrive. So:
      //
      //   0.00-0.18  CANT AND DROP. The gun snaps over fast and the
      //              magazine falls out of the well.
      //   0.18-0.58  EMPTY. The well is visibly empty. This is the beat
      //              that says "you cannot shoot right now".
      //   0.58-0.82  SEAT. A fresh magazine rises and snaps home.
      //   0.82-1.00  BACK UP. The gun snaps upright and the slide runs
      //              forward.
      //
      // The motion between beats is sharp, not sinusoidal: a reload is a
      // series of fast movements with pauses, and easing everything
      // smoothly is what made it read as one slow turn.
      let roll = 0, drop = 0, magDrop = 0, magHidden = false;
      if (arsenal.reloading && arsenal.reloadTotal > 0) {
        const p = Math.max(0, Math.min(1, 1 - arsenal.reloadT / arsenal.reloadTotal));
        const seg = (a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));
        const snap = (t) => 1 - (1 - t) * (1 - t) * (1 - t);   // fast out
        const slam = (t) => t * t * t;                          // fast in
        // The cant: on quickly, held, off quickly.
        roll = 0.62 * (p < 0.82 ? snap(seg(0, 0.18)) : 1 - snap(seg(0.82, 1)));
        drop = 0.05 * (p < 0.82 ? snap(seg(0, 0.18)) : 1 - snap(seg(0.82, 1)));
        if (p < 0.18) {
          magDrop = 0.16 * slam(seg(0, 0.18));       // falls, accelerating
        } else if (p < 0.58) {
          magHidden = true;                          // gone: the empty beat
        } else if (p < 0.82) {
          magDrop = 0.16 * (1 - snap(seg(0.58, 0.82)));   // rises and seats
        }
      } else if (hint > 0) {
        roll = hint * 0.25;                   // it starts to tip as you hold
      }
      // The magazine part, found once and remembered.
      let mag = holder.userData.mag;
      if (mag === undefined) {
        mag = holder.userData.mag = holder.getObjectByName('mag') || null;
        if (mag) holder.userData.magHome = mag.position.y;
      }
      if (mag) {
        mag.visible = !magHidden;
        mag.position.y = holder.userData.magHome - magDrop;
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
    this.wishX = 0;
    this.wishZ = 0;
    if (!this.active) return;
    const session = this.ctx.renderer.xr.getSession() || this._fakeSession;
    if (!session) return;
    this._alignWeapons();
    this._stepRecoil(dt);
    this._reloadGesture(dt);
    this._placeHolster();
    this._stepHolsterHold(dt);
    this._highlightHolster();
    this._strategyGesture(dt);
    const stationary = this.ctx.getLocoMode() === 'stationary';

    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;

      // Face buttons with edge detection.
      const prev = this.prevButtons.get(src) || [];
      const now = gp.buttons.map((b) => b.pressed);
      this.prevButtons.set(src, now);
      const pressed = (i) => now[i] && !prev[i];
      // A modal panel eats its buttons first: a player trying to restart a
      // lost run must not cycle a weapon instead.
      if (this.panel && this.panel.open) {
        const name = src.handedness === 'right'
          ? (pressed(BTN_AX) ? 'A' : pressed(BTN_BY) ? 'B' : null)
          : (pressed(BTN_AX) ? 'X' : pressed(BTN_BY) ? 'Y' : null);
        if (name && this.panel.press(name)) continue;
        if (name) continue;              // swallow it either way while open
      }
      // THE STRATEGY PANEL, AND THE WAY OUT OF IT.
      //
      // Ola got stuck inside this: "den går inte att ta bort igen! Så man
      // måste DÖ för att få bort den!" Nothing in this game may ever
      // require dying to dismiss, so closing it is now bound to every
      // face button except the one that cycles the payload. Four ways
      // out, on both hands, plus clicking a stick, plus looking away.
      // (An earlier version of this comment also claimed a CLOSE button
      // on the panel. There is no such button: hitTest has no close area
      // and strategyClick never closes anything. Counting a way out that
      // does not exist is how you end up believing a trap is escapable.)
      if (this.strategyOpen) {
        if (src.handedness === 'left' && pressed(BTN_BY)) {
          if (this.ctx.actions.strategyCyclePayload) this.ctx.actions.strategyCyclePayload();
          continue;
        }
        if (pressed(BTN_AX) || pressed(BTN_BY)) {
          this.ctx.actions.strategy(false);
          continue;
        }
        // The stick, too, because a player fighting a stuck panel will
        // mash everything and one of those things is the stick.
        if (pressed(BTN_STICK)) {
          this.ctx.actions.strategy(false);
          continue;
        }
      }
      // THE DEBUG MENU owns its own inputs while it is open, so nothing
      // else fires underneath it.
      if (this.ctx.actions.debugMenuOpen && this.ctx.actions.debugMenuOpen()) {
        if (src.handedness === 'left' && pressed(BTN_BY)) {
          this.ctx.actions.debugMenu();                          // Y closes
          continue;
        }
        if (src.handedness === 'left' && gp.axes.length >= 4) {
          const ay = gp.axes[3];
          if (Math.abs(ay) > 0.6 && !this._menuStickHeld) {
            this._menuStickHeld = true;
            this.ctx.actions.debugMenuMove(ay > 0 ? 1 : -1);
          } else if (Math.abs(ay) < 0.3) {
            this._menuStickHeld = false;
          }
        }
        if (now[0] && !prev[0]) this.ctx.actions.debugMenuPick();  // trigger
        continue;
      }
      if (src.handedness === 'right') {
        if (pressed(BTN_AX)) this.ctx.actions.cycle();          // A
        if (pressed(BTN_BY)) this._grenadeFrom(src);            // B
        if (pressed(BTN_STICK)) this.ctx.actions.throwCycle();  // R-stick press
      } else if (src.handedness === 'left') {
        if (pressed(BTN_AX)) this.ctx.actions.pack();           // X
        // With akimbo BOTH hands hold a gun, so no hand carries the torch
        // and its trigger switch does not exist. X doubles as the light
        // in that case, since a light with no switch is the bug this was
        // supposed to fix.
        if (pressed(BTN_AX) && this.weaponKind === 'akimbo'
          && this.ctx.actions.flashlight) this.ctx.actions.flashlight();
        // Y opens the debug menu. It was the flashlight toggle, which is
        // moving to the trigger anyway (see docs/TODO.md).
        if (pressed(BTN_BY)) this.ctx.actions.debugMenu();       // Y
        if (pressed(BTN_STICK)) this.ctx.actions.nightVision(); // L-stick press
      }

      if (gp.axes.length < 4) continue;
      const x = gp.axes[2], y = gp.axes[3];
      if (src.handedness === 'left' && stationary) {
        if (Math.abs(x) > 0.12 || Math.abs(y) > 0.12) {
          // Intent, not position. Stick locomotion goes through the same
          // character controller as everything else, so a VR player is
          // stopped by the same walls as a desktop one.
          const fwd = this._headForward();
          const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
          const move = fwd.multiplyScalar(-y).add(right.multiplyScalar(x));
          this.wishX = move.x * CONFIG.VR_MOVE_SPEED;
          this.wishZ = move.z * CONFIG.VR_MOVE_SPEED;
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
