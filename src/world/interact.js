// HOLD-TO-ACT: in-world targets, proximity prompts and progress rings.
//
// Ola: "'OBJECTIVE: REPAIR WALL' tells the player nothing about how. Every
// objective needs an in-world target: highlight the damaged section, show
// a prompt when the player is near it, and a hold-to-act with a visible
// progress ring. If an objective cannot currently be performed in VR, that
// is a bug, not a missing nicety."
//
// Two things were announced and not actionable: repairing the wall, and
// reviving a teammate. Both are now the same interaction, because they
// are the same interaction: go to a marked thing, hold, watch it fill.
//
// The pieces:
//   HIGHLIGHT  a pulsing outline on the target itself, so "which bit?"
//              has an answer you can see from across the base
//   BEACON     for a downed player, a marker that draws THROUGH geometry,
//              because the whole problem is that you cannot see them
//   PROMPT     a world-space label that appears when you are close enough
//   RING       a progress arc that fills while you hold, visible to
//              everyone, so the person being revived sees it too
//
// All of it is world-space, so it works identically flat and in VR. That
// is the point: a DOM prompt would have been half a feature again.
import * as THREE from 'three';

const RING_SEGMENTS = 48;

function makeLabelTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(10,12,16,0.86)';
  x.beginPath();
  x.roundRect(6, 6, 500, 148, 22);
  x.fill();
  x.strokeStyle = '#e0a33c';
  x.lineWidth = 3;
  x.stroke();
  x.textAlign = 'center';
  x.fillStyle = '#e8e4da';
  x.font = 'bold 46px system-ui, sans-serif';
  x.textBaseline = 'middle';
  x.fillText(text, 256, sub ? 58 : 80);
  if (sub) {
    x.fillStyle = '#8d9aa5';
    x.font = '30px system-ui, sans-serif';
    x.fillText(sub, 256, 108);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A ring that fills clockwise from the top as `t` goes 0 to 1.
function makeProgressRing() {
  const g = new THREE.Group();
  const track = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.19, RING_SEGMENTS),
    new THREE.MeshBasicMaterial({
      color: 0x1b232b, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthTest: false,
    }));
  const fill = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.19, RING_SEGMENTS, 1, Math.PI / 2, 0.001),
    new THREE.MeshBasicMaterial({
      color: 0xe0a33c, transparent: true,
      side: THREE.DoubleSide, depthTest: false,
    }));
  g.add(track, fill);
  g.renderOrder = 998;
  g.userData.fill = fill;
  return g;
}

function setRing(ring, t) {
  const fill = ring.userData.fill;
  fill.geometry.dispose();
  // thetaStart at the top, sweeping clockwise: a clock face, which is what
  // everyone already reads a filling arc as.
  const span = Math.max(0.001, Math.min(1, t) * Math.PI * 2);
  fill.geometry = new THREE.RingGeometry(
    0.15, 0.19, RING_SEGMENTS, 1, Math.PI / 2 - span, span);
  fill.material.color.setHex(t >= 1 ? 0x7fb069 : 0xe0a33c);
}

export class InteractionLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // The prompt: a billboarded label above the target.
    this.promptTex = null;
    this.prompt = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.19),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }));
    this.prompt.renderOrder = 999;
    this.prompt.visible = false;
    this.group.add(this.prompt);

    this.ring = makeProgressRing();
    this.ring.visible = false;
    this.group.add(this.ring);

    // The highlight: a flat pulsing outline laid over the target.
    this.highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.58, 24),
      new THREE.MeshBasicMaterial({
        color: 0xe0a33c, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthTest: false,
      }));
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.renderOrder = 997;
    this.highlight.visible = false;
    this.group.add(this.highlight);

    this._labelKey = '';
    this.beacons = new Map();     // id -> marker for a downed player
  }

  // A downed teammate has to be findable through walls: not being able to
  // see them IS the problem the marker solves.
  setBeacons(entries) {
    const keep = new Set();
    for (const e of entries) {
      keep.add(e.id);
      let b = this.beacons.get(e.id);
      if (!b) {
        b = new THREE.Group();
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6),
          new THREE.MeshBasicMaterial({
            color: 0xd83020, transparent: true, opacity: 0.75, depthTest: false,
          }));
        post.position.y = 1.4;
        const chev = new THREE.Mesh(
          new THREE.ConeGeometry(0.22, 0.34, 4),
          new THREE.MeshBasicMaterial({ color: 0xd83020, depthTest: false }));
        chev.rotation.x = Math.PI;
        chev.position.y = 2.4;
        b.add(post, chev);
        b.renderOrder = 996;
        b.traverse((o) => { o.renderOrder = 996; });
        this.group.add(b);
        this.beacons.set(e.id, b);
      }
      b.position.set(e.x, e.y, e.z);
      const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 220);
      b.scale.setScalar(pulse);
      b.children[1].position.y = 2.4 + 0.12 * Math.sin(performance.now() / 300);
    }
    for (const [id, b] of this.beacons) {
      if (keep.has(id)) continue;
      this.group.remove(b);
      b.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.beacons.delete(id);
    }
  }

  // target: { x, y, z, label, sub, progress } or null to clear.
  // camera is used to billboard the prompt and the ring at the reader.
  show(target, camera) {
    if (!target) {
      this.prompt.visible = false;
      this.ring.visible = false;
      this.highlight.visible = false;
      return;
    }
    const key = `${target.label}|${target.sub || ''}`;
    if (key !== this._labelKey) {
      this._labelKey = key;
      if (this.promptTex) this.promptTex.dispose();
      this.promptTex = makeLabelTexture(target.label, target.sub);
      this.prompt.material.map = this.promptTex;
      this.prompt.material.needsUpdate = true;
    }
    this.prompt.position.set(target.x, target.y + 1.5, target.z);
    this.prompt.visible = true;
    this.prompt.lookAt(camera.getWorldPosition(TMP));

    this.ring.position.set(target.x, target.y + 1.05, target.z);
    this.ring.visible = target.progress > 0;
    if (target.progress > 0) {
      setRing(this.ring, target.progress);
      this.ring.lookAt(camera.getWorldPosition(TMP));
    }

    this.highlight.position.set(target.x, target.y + 0.06, target.z);
    this.highlight.visible = true;
    const p = 0.4 + 0.25 * Math.sin(performance.now() / 260);
    this.highlight.material.opacity = target.progress > 0 ? 0.75 : p;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

const TMP = new THREE.Vector3();
