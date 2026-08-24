// THE STRATEGY VIEW: the tactical map, in VR, big enough to aim at.
//
// Ola, v0.15.x VR playtest: "the wrist is the TRIGGER, not the whole
// surface. Looking at the wrist unfolds a larger holographic panel
// floating at a comfortable distance, big enough to read the map and
// place a drone target precisely."
//
// The problem it solves: the drone is the holdout level's answer to
// "loot landed where I cannot walk", and sending it needs a POINT on the
// map. A flat player clicks. A VR player had nothing at all, so the drone
// was unusable in the headset, which is where the game is meant to be
// played.
//
// Two decisions worth writing down:
//
//   THE MAP IS THE REAL MAP. This panel is textured by a render of the
//   same orthographic camera the flat map uses, markers and all. It is not
//   a second drawing of the level that can drift out of agreement with the
//   first. If the flat map shows it, this shows it.
//
//   IT IS WORLD-LOCKED, NOT HEAD-LOCKED. Once unfolded it stays where it
//   was placed. A panel welded to your face moves with every twitch, and
//   you cannot point precisely at something that is running away from your
//   hand. You look away, it stays; you look back, it is where you left it.
import * as THREE from 'three';

const PANEL_W = 0.92, PANEL_H = 0.72;    // metres, roughly a large tablet
const OVER_W = 1024, OVER_H = 800;       // overlay canvas

const COL = {
  frame: '#7fd4e8',
  dim: '#5c9ead',
  text: '#e8f4f8',
  target: '#e0a33c',
  bad: '#d83020',
};

export class StrategyView {
  constructor(renderer) {
    this.renderer = renderer;
    this.open = false;
    this.cursor = null;              // {u, v} in 0..1, or null
    this.target = null;              // {u, v} of the placed marker
    this.label = '';
    this.hint = '';
    this.blocked = false;
    this.painted = false;            // has a map ever landed on it?

    // The map image. 640 is enough to read a level from a metre away and
    // cheap enough to re-render several times a second on a Quest 2.
    this.rt = new THREE.WebGLRenderTarget(640, 640, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.matrixAutoUpdate = true;

    // Backing: a dark slab so the map reads against a bright sky.
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W + 0.06, PANEL_H + 0.06),
      new THREE.MeshBasicMaterial({
        color: 0x0a1016, transparent: true, opacity: 0.92,
        depthTest: false, toneMapped: false,
      }));
    back.renderOrder = 990;
    this.group.add(back);

    // The map itself.
    this.mapMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      new THREE.MeshBasicMaterial({
        map: this.rt.texture, depthTest: false, toneMapped: false,
      }));
    this.mapMesh.position.z = 0.001;
    this.mapMesh.renderOrder = 991;
    this.group.add(this.mapMesh);

    // Overlay: reticle, target marker, mode line, instructions. A separate
    // canvas plane so the map underneath is a plain render with nothing
    // drawn into it.
    this.canvas = document.createElement('canvas');
    this.canvas.width = OVER_W;
    this.canvas.height = OVER_H;
    this.c2d = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      new THREE.MeshBasicMaterial({
        map: this.tex, transparent: true, depthTest: false, toneMapped: false,
      }));
    this.overlay.position.z = 0.002;
    this.overlay.renderOrder = 992;
    this.group.add(this.overlay);

    this._plane = new THREE.Plane();
    this._ray = new THREE.Ray();
    this._hit = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._key = '';
    this._mapT = 0;
  }

  attachTo(scene) {
    if (this.group.parent !== scene) scene.add(this.group);
  }

  // Unfold in front of the player: a comfortable arm's length, slightly
  // below eye level and tilted up, the angle you would hold a clipboard.
  // Placed in WORLD space, from the head's position and heading only, so
  // it does not inherit head roll or pitch and end up askew.
  placeFor(camera) {
    const p = camera.getWorldPosition(new THREE.Vector3());
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    this.group.position.copy(p).addScaledVector(fwd, 0.72);
    this.group.position.y = p.y - 0.30;
    this.group.lookAt(p.x, p.y - 0.02, p.z);
    this.group.rotateX(-0.22);           // tilt the top away, like a desk
  }

  show(camera) {
    this.placeFor(camera);
    this.open = true;
    this.group.visible = true;
    this._key = '';
    this._mapT = 99;                     // force a map render this frame
  }

  hide() {
    this.open = false;
    this.group.visible = false;
    this.cursor = null;
  }

  // Re-render the map into the panel. Throttled: the map is a strategic
  // readout, not an action view, and a full extra scene pass every frame
  // is exactly the kind of cost a Quest 2 cannot absorb.
  renderMap(scene, mapCam, dt) {
    if (!this.open) return false;
    this._mapT += dt;
    if (this._mapT < 0.1) return false;  // ~10 Hz
    this._mapT = 0;
    // THE PANEL WAS BLACK IN THE HEADSET. Ola: "den är HELT svart."
    //
    // Inside a WebXR session, renderer.render(scene, camera) IGNORES the
    // camera it is given and uses the session's own stereo camera, and it
    // draws into the session's framebuffer. So this pass rendered the
    // player's own viewpoint, into the wrong buffer, and what landed on
    // the panel was nothing. On a flat screen the same code works, which
    // is exactly why it shipped: the only place it is broken is the only
    // place the feature is for.
    //
    // Turning xr off for the pass makes the renderer behave like the flat
    // one for that one draw: it honours the camera and the render target.
    // It goes back on immediately, and setRenderTarget(null) then means
    // "the session's framebuffer" again rather than "the canvas".
    const wasXr = this.renderer.xr.enabled;
    const prevTarget = this.renderer.getRenderTarget();
    // The panel must not photograph itself.
    this.group.visible = false;
    this.renderer.xr.enabled = false;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, mapCam);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.xr.enabled = wasXr;
    this.group.visible = true;
    this.painted = true;
    return true;
  }

  // Where does this ray meet the panel? Returns {u, v} in 0..1 with the
  // origin at the top left, or null if the ray misses or comes from
  // behind. u/v are what the caller turns back into world coordinates.
  hitTest(origin, dir) {
    if (!this.open) return null;
    this.group.updateWorldMatrix(true, false);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
    this._plane.setFromNormalAndCoplanarPoint(n, this.group.position);
    this._ray.set(origin, dir);
    if (!this._ray.intersectPlane(this._plane, this._hit)) return null;
    if (this._hit.sub(origin).dot(dir) < 0) return null;     // behind you
    this._hit.add(origin);
    this._local.copy(this._hit);
    this.group.worldToLocal(this._local);
    const u = this._local.x / PANEL_W + 0.5;
    const v = 0.5 - this._local.y / PANEL_H;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { u, v };
  }

  draw() {
    if (!this.open) return;
    const key = [
      this.cursor ? `${this.cursor.u.toFixed(3)},${this.cursor.v.toFixed(3)}` : '-',
      this.target ? `${this.target.u.toFixed(3)},${this.target.v.toFixed(3)}` : '-',
      this.label, this.hint, this.blocked ? 'x' : '', this.painted ? 'p' : '',
    ].join('|');
    if (key === this._key) return;
    this._key = key;

    const c = this.c2d;
    c.clearRect(0, 0, OVER_W, OVER_H);

    // Frame: corner brackets, so the panel reads as an instrument without
    // covering the map with a border.
    c.strokeStyle = COL.frame;
    c.lineWidth = 4;
    const m = 10, L = 64;
    for (const [x, y, dx, dy] of [
      [m, m, 1, 1], [OVER_W - m, m, -1, 1],
      [m, OVER_H - m, 1, -1], [OVER_W - m, OVER_H - m, -1, -1],
    ]) {
      c.beginPath();
      c.moveTo(x + dx * L, y);
      c.lineTo(x, y);
      c.lineTo(x, y + dy * L);
      c.stroke();
    }

    // The placed target: a ring with a stem, so it is visible over any
    // ground colour.
    if (this.target) {
      const x = this.target.u * OVER_W, y = this.target.v * OVER_H;
      c.strokeStyle = COL.target;
      c.lineWidth = 5;
      c.beginPath(); c.arc(x, y, 22, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(x, y - 40); c.lineTo(x, y - 24); c.stroke();
      c.beginPath(); c.moveTo(x, y + 24); c.lineTo(x, y + 40); c.stroke();
    }

    // The cursor: crosshair plus coordinates, because "precisely" was the
    // word in the request.
    if (this.cursor) {
      const x = this.cursor.u * OVER_W, y = this.cursor.v * OVER_H;
      c.strokeStyle = this.blocked ? COL.bad : COL.text;
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(x - 26, y); c.lineTo(x - 8, y); c.stroke();
      c.beginPath(); c.moveTo(x + 8, y); c.lineTo(x + 26, y); c.stroke();
      c.beginPath(); c.moveTo(x, y - 26); c.lineTo(x, y - 8); c.stroke();
      c.beginPath(); c.moveTo(x, y + 8); c.lineTo(x, y + 26); c.stroke();
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2);
      c.fillStyle = this.blocked ? COL.bad : COL.text;
      c.fill();
    }

    // IF NO MAP HAS LANDED YET, SAY SO. A panel that is simply black
    // gives the player nothing to act on: they cannot tell a broken
    // render from an empty level from a frozen game, and the one thing
    // they need to know (how to get out) is not on it either.
    if (!this.painted) {
      c.fillStyle = 'rgba(10,14,20,0.92)';
      c.fillRect(0, 0, OVER_W, OVER_H - 96);
      c.fillStyle = COL.dim;
      c.font = '30px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('map not available', OVER_W / 2, OVER_H / 2 - 20);
      c.fillStyle = COL.text;
      c.font = 'bold 34px system-ui, sans-serif';
      c.fillText('PRESS A OR B TO CLOSE', OVER_W / 2, OVER_H / 2 + 34);
      c.textAlign = 'left';
    }

    // What this will do, and how to do it. Bottom strip, always the same
    // place, so it can be read without hunting.
    c.fillStyle = 'rgba(6,10,14,0.82)';
    c.fillRect(0, OVER_H - 96, OVER_W, 96);
    c.fillStyle = this.blocked ? COL.bad : COL.target;
    c.font = 'bold 34px system-ui, sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText(this.label || '', 28, OVER_H - 62);
    c.fillStyle = COL.dim;
    c.font = '26px system-ui, sans-serif';
    c.fillText(this.hint || '', 28, OVER_H - 26);
    // The way out, always on screen. This is the line that was missing
    // when Ola had to die to dismiss the panel.
    c.textAlign = 'right';
    c.fillStyle = COL.text;
    c.font = 'bold 26px system-ui, sans-serif';
    c.fillText('A OR B TO CLOSE', OVER_W - 28, OVER_H - 44);
    c.textAlign = 'left';
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.rt.dispose();
    this.tex.dispose();
  }
}

export const PANEL_SIZE = { w: PANEL_W, h: PANEL_H };
