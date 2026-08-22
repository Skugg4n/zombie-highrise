// Instanced horde renderer: the entire horde (alive + toppling corpses)
// renders as SEVEN instanced draw calls (legs x2, arms x2, torso, head,
// blob shadow), whatever the zombie count. Each zombie is a virtual
// skeleton whose per-part matrices are composed every frame.
// Per-type proportions and accent colors ride in the instance transform
// and instanceColor (torso only; skin/pants use flat shared colors).
import * as THREE from 'three';

const LOOKS = {
  walker: { accent: new THREE.Color(0x8c3b2e), sx: 1.0, sy: 1.0, lean: 0.10, armLen: 0.55 },
  runner: { accent: new THREE.Color(0xd8a020), sx: 0.78, sy: 1.08, lean: 0.55, armLen: 0.45 },
  brute: { accent: new THREE.Color(0x6e1f18), sx: 1.7, sy: 1.05, lean: 0.18, armLen: 0.65 },
};
const FLASH = new THREE.Color(0xff5040);

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class HordeRenderer {
  constructor(scene, max = 40, castShadows = false) {
    this.max = max;
    this.scene = scene;
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const mkPart = (material, withColor = false) => {
      const m = new THREE.InstancedMesh(unit, material, max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = castShadows;
      if (withColor) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      scene.add(m);
      return m;
    };
    const skin = new THREE.MeshStandardMaterial({ color: 0xb8bdb4, roughness: 0.95 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.95 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    this.parts = {
      legL: mkPart(pants), legR: mkPart(pants),
      armL: mkPart(skin), armR: mkPart(skin),
      torso: mkPart(shirt, true),
      head: mkPart(skin),
    };
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.InstancedMesh(shadowGeo,
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }), max);
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadow.count = 0;
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);

    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._base = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  // entries: [{x, y, z, rotY, type, animT, stagger, flash, fall, sink}]
  //   fall: 0..1 death topple progress; sink: extra downward offset
  update(entries) {
    const n = Math.min(entries.length, this.max);
    const P = this.parts;
    for (const key of Object.keys(P)) P[key].count = n;
    this.shadow.count = n;

    for (let i = 0; i < n; i++) {
      const z = entries[i];
      const look = LOOKS[z.type] || LOOKS.walker;
      const s = Math.sin(z.animT);
      // Base: position + yaw (+ death topple around X).
      this._e.set(-(Math.PI / 2) * (z.fall || 0) ** 2, z.rotY, 0, 'YXZ');
      this._q.setFromEuler(this._e);
      this._base.compose(
        this._v.set(z.x, z.y - (z.sink || 0), z.z),
        this._q, this._s.setScalar(z.scale || 1));

      // Legs: pivot at hip (y 0.75), swing +-0.45.
      this._part(P.legL, i, look,
        -0.11 * look.sx, 0.75, 0, s * 0.45, 0.16 * look.sx, 0.75, 0.16, 0, -0.375, 0);
      this._part(P.legR, i, look,
        0.11 * look.sx, 0.75, 0, -s * 0.45, 0.16 * look.sx, 0.75, 0.16, 0, -0.375, 0);
      // Arms: pivot at shoulder, stretched forward with sway + stagger.
      const armRx = -0.52 - look.lean * 0.45 + (z.stagger || 0) * 0.5;
      this._part(P.armL, i, look,
        -0.28 * look.sx, 1.22, 0.05, armRx + s * 0.1, 0.11, 0.11, look.armLen, 0, 0, look.armLen / 2);
      this._part(P.armR, i, look,
        0.28 * look.sx, 1.22, 0.05, armRx - s * 0.1, 0.11, 0.11, look.armLen, 0, 0, look.armLen / 2);
      // Torso with hit-flash color and walk roll.
      this._part(P.torso, i, look,
        0, 1.05, 0, look.lean * 0.5 - (z.stagger || 0) * 0.35,
        0.44 * look.sx, 0.6 * look.sy, 0.24 * look.sx, 0, 0, 0, s * 0.06);
      const col = (z.flash || 0) > 0 ? FLASH : look.accent;
      P.torso.setColorAt(i, col);
      // Head, lolling.
      this._part(P.head, i, look,
        look.lean * 0.15, z.type === 'brute' ? 1.42 : 1.52 * look.sy, look.lean * 0.3,
        0.25, 0.24, 0.26, 0.24, 0, 0, 0);

      // Blob shadow stays flat on the ground regardless of topple.
      this._m.compose(
        this._v.set(z.x, z.y + 0.02, z.z),
        this._q.set(0, 0, 0, 1),
        this._s.setScalar(z.type === 'brute' ? 1.3 : 0.9));
      this.shadow.setMatrixAt(i, this._m);
    }
    for (const key of Object.keys(P)) {
      P[key].instanceMatrix.needsUpdate = true;
    }
    if (P.torso.instanceColor) P.torso.instanceColor.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
  }

  // localMatrix = base * T(px,py,pz) * R(rx[,rz]) * T(pivot) * S(dims)
  _part(mesh, i, look, px, py, pz, rx, w, h, d, ox, oy, oz, rz = 0) {
    this._e.set(rx, 0, rz, 'XYZ');
    this._q.setFromEuler(this._e);
    this._m.compose(this._v.set(px, py, pz), this._q, this._s.set(1, 1, 1));
    this._m2.makeTranslation(ox, oy, oz);
    this._m.multiply(this._m2);
    this._m2.makeScale(w, h, d);
    this._m.multiply(this._m2);
    this._m.premultiply(this._base);
    mesh.setMatrixAt(i, this._m);
  }
}
