// THE VR PANEL: modal state, in world space, with actions you can take.
//
// Ola, v0.13.x VR playtest: "being downed in VR is a softlock. No text, no
// explanation, nothing happens, and there is no way to restart or quit.
// The game just stops."
//
// Everything that stops the game in flat mode is a DOM overlay, and DOM
// does not exist inside a headset. So the downed state, game over and the
// victory screen were all invisible AND unactionable. A player must always
// be able to understand their state and always have a way forward.
//
// This is that way forward: a panel that appears in front of the player,
// says plainly what has happened, and lists the buttons that resolve it.
// Actions are bound to FACE BUTTONS rather than a laser pointer, because a
// downed player should not have to aim at anything to get out of it.
import * as THREE from 'three';

const W = 1024, H = 640;

const COL = {
  bg: 'rgba(10,12,16,0.94)',
  edge: '#2c3843',
  title: '#e8e4da',
  body: '#aab6c0',
  key: '#0d1014',
  keyBg: '#e0a33c',
  danger: '#d83020',
  good: '#7fb069',
};

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export class VrPanel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.625),
      new THREE.MeshBasicMaterial({
        map: this.tex, transparent: true, depthTest: false, toneMapped: false,
      }));
    // depthTest off and a high render order: a panel you cannot read
    // because a zombie is standing in front of it is not a way forward.
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;

    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.mesh.position.set(0, 0, -1.5);

    this.actions = [];      // [{ key: 'A', label, run }]
    this._key = '';
    this.open = false;
  }

  // Parented to the camera so it stays in front of the player however they
  // turn: a modal they have to hunt for is not a modal.
  attachTo(camera) {
    if (this.group.parent !== camera) camera.add(this.group);
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.mesh.visible = false;
    this.actions = [];
    this._key = '';
  }

  // tone: 'danger' | 'good' | null
  show(title, lines, actions, tone = null) {
    const key = `${title}|${lines.join('|')}|${actions.map((a) => a.key + a.label).join('|')}|${tone}`;
    this.open = true;
    this.mesh.visible = true;
    this.actions = actions;
    if (key === this._key) return;
    this._key = key;

    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = COL.bg;
    roundRect(c, 8, 8, W - 16, H - 16, 28);
    c.fill();
    c.strokeStyle = tone === 'danger' ? COL.danger : tone === 'good' ? COL.good : COL.edge;
    c.lineWidth = 5;
    c.stroke();

    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = tone === 'danger' ? COL.danger : tone === 'good' ? COL.good : COL.title;
    c.font = 'bold 76px system-ui, sans-serif';
    c.fillText(title, W / 2, 56);

    c.fillStyle = COL.body;
    c.font = '34px system-ui, sans-serif';
    let y = 168;
    for (const line of lines) {
      c.fillText(line, W / 2, y);
      y += 46;
    }

    // The actions, as button glyphs. These are the whole point: the panel
    // exists to tell you which button gets you out of this.
    let ay = H - 60 - actions.length * 78;
    for (const a of actions) {
      c.textAlign = 'left';
      const boxX = 150;
      c.fillStyle = COL.keyBg;
      roundRect(c, boxX, ay, 92, 62, 14);
      c.fill();
      c.fillStyle = COL.key;
      c.font = 'bold 42px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(a.key, boxX + 46, ay + 10);
      c.textAlign = 'left';
      c.fillStyle = COL.title;
      c.font = 'bold 40px system-ui, sans-serif';
      c.fillText(a.label, boxX + 122, ay + 12);
      ay += 78;
    }
    c.textAlign = 'left';
    this.tex.needsUpdate = true;
  }

  // Returns true if the press was consumed, so the game does not also
  // cycle a weapon while the player is trying to restart a lost run.
  press(key) {
    if (!this.open) return false;
    const a = this.actions.find((x) => x.key === key);
    if (!a) return false;
    a.run();
    return true;
  }
}
