// THE DEBUG MENU, in world space so it works everywhere.
//
// Ola: "fixa en debug menu för både VR (knapp på armen?) och
// desktop/mobile, så jag kan adda vapen, byta banor och få credits mm,
// för att kunna testa allt vi har."
//
// Two jobs, and the second is the one that matters right now:
//
//   REACH EVERYTHING. Weapons, scrap, levels and phases are otherwise
//   gated behind twenty minutes of play, so most of what has been built
//   is never seen, let alone tested.
//
//   SAY WHAT IS HAPPENING. It prints live state at the top: phase, health,
//   downed, archetype, level. When something goes wrong in a headset the
//   only evidence available is what Ola can read out loud, and "I am still
//   dead" is much easier to act on when it comes with "phase: day, downed:
//   yes", which localises the fault in one sentence.
//
// World space rather than DOM, for the reason everything else here is:
// DOM does not exist inside a headset, and a debug menu that only works on
// a monitor is exactly the tool you cannot use when you need it.
import * as THREE from 'three';

const W = 1024, H = 768;
const COLS = 2;

const COL = {
  bg: 'rgba(10,12,16,0.95)',
  edge: '#2c3843',
  head: '#e0a33c',
  text: '#e8e4da',
  dim: '#8d9aa5',
  good: '#7fb069',
  bad: '#d83020',
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

export class DebugMenu {
  // actions: [{ label, run }] in the order they should appear.
  // status: () => [[key, value], ...] read fresh every redraw.
  constructor(actions, status) {
    this.actions = actions;
    this.status = status;
    this.index = 0;
    this.open = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.675),
      new THREE.MeshBasicMaterial({
        map: this.tex, transparent: true, depthTest: false, toneMapped: false,
      }));
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.mesh.position.set(0, 0, -1.1);
    this._key = '';
  }

  attachTo(parent) {
    if (this.group.parent !== parent) parent.add(this.group);
  }

  toggle() {
    this.open = !this.open;
    this.mesh.visible = this.open;
    this._key = '';
    return this.open;
  }

  move(delta) {
    if (!this.open) return;
    const n = this.actions.length;
    this.index = (this.index + delta + n) % n;
    this._key = '';
  }

  activate() {
    if (!this.open) return false;
    const a = this.actions[this.index];
    if (a && a.run) a.run();
    this._key = '';
    return true;
  }

  draw() {
    if (!this.open) return;
    const rows = this.status ? this.status() : [];
    const key = `${this.index}|${rows.map((r) => r.join(':')).join('|')}`;
    if (key === this._key) return;
    this._key = key;

    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = COL.bg;
    roundRect(c, 6, 6, W - 12, H - 12, 20);
    c.fill();
    c.strokeStyle = COL.edge;
    c.lineWidth = 3;
    c.stroke();

    c.textBaseline = 'top';
    c.textAlign = 'left';
    c.fillStyle = COL.head;
    c.font = 'bold 34px system-ui, sans-serif';
    c.fillText('DEBUG', 30, 24);

    // ---- Live state, so a fault can be described in one sentence ----
    c.font = '22px system-ui, sans-serif';
    let sx = 190, sy = 28;
    for (const [k, v] of rows) {
      c.fillStyle = COL.dim;
      c.fillText(`${k}`, sx, sy);
      c.fillStyle = /^(no|0|false|ok)$/i.test(String(v)) ? COL.good
        : /^(yes|true|down|dead)$/i.test(String(v)) ? COL.bad : COL.text;
      c.fillText(String(v), sx + 96, sy);
      sy += 28;
      if (sy > 84) { sy = 28; sx += 300; }
    }

    c.strokeStyle = COL.edge;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(24, 124);
    c.lineTo(W - 24, 124);
    c.stroke();

    // ---- The actions, in two columns ----
    const perCol = Math.ceil(this.actions.length / COLS);
    const colW = (W - 60) / COLS;
    for (let i = 0; i < this.actions.length; i++) {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = 30 + col * colW;
      const y = 144 + row * 52;
      if (i === this.index) {
        c.fillStyle = 'rgba(224,163,60,0.22)';
        roundRect(c, x - 8, y - 6, colW - 14, 46, 8);
        c.fill();
        c.fillStyle = COL.head;
        c.font = 'bold 30px system-ui, sans-serif';
        c.fillText('>', x - 2, y);
      }
      c.fillStyle = i === this.index ? COL.text : COL.dim;
      c.font = `${i === this.index ? 'bold ' : ''}28px system-ui, sans-serif`;
      c.fillText(this.actions[i].label, x + 26, y);
    }

    c.fillStyle = COL.dim;
    c.font = '20px system-ui, sans-serif';
    c.fillText(this.hint || '', 30, H - 46);
    this.tex.needsUpdate = true;
  }
}
