// THE WRIST DISPLAY, and the ammo counter on the weapon.
//
// Ola's VR playtest: "there is no HUD, no text and no readable state in
// VR at all. I do not know if the gun is loaded, how many zombies remain,
// or what to do next."
//
// A flat player reads six things off the screen: what to do next, how
// many are left, health, scrap, weapon and ammo. None of that existed in
// the headset. Two surfaces fix it, deliberately split by urgency:
//
//   THE WRIST  strapped to the left forearm, angled so a natural
//              watch-checking turn brings it square to your eyes. Carries
//              everything, including the objective in plain words.
//   THE WEAPON a small counter on the gun itself, because ammo is the one
//              number you need mid-fight and you should never have to
//              look away from a zombie to read it.
//
// Both are canvas textures redrawn only when their content actually
// changes: a per-frame canvas redraw in VR is a frame-rate problem, and
// these are mostly static between events.
import * as THREE from 'three';

const W = 512, H = 320;                 // wrist canvas, 1.6:1
const AMMO_W = 256, AMMO_H = 128;

const COL = {
  bg: '#0d1014',
  panel: '#151b21',
  line: '#2c3843',
  text: '#e8e4da',
  dim: '#8d9aa5',
  accent: '#e0a33c',
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

// A horizontal bar with a label, used for health and base integrity.
function bar(c, x, y, w, h, frac, colour) {
  c.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(c, x, y, w, h, h / 2);
  c.fill();
  c.fillStyle = colour;
  roundRect(c, x, y, Math.max(h, w * Math.max(0, Math.min(1, frac))), h, h / 2);
  c.fill();
}

export class WristDisplay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    this.group = new THREE.Group();

    // The strap and the housing, so it reads as a device on your arm and
    // not a floating rectangle.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.095, 0.016),
      new THREE.MeshStandardMaterial({ color: 0x1a1f25, roughness: 0.7 }));
    this.group.add(body);
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.158, 0.103, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x33393f, roughness: 0.5, metalness: 0.4 }));
    bezel.position.z = -0.004;
    this.group.add(bezel);
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.062, 0.012),
        new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1.0 }));
      strap.position.set(s * 0.088, 0, 0.004);
      strap.rotation.y = s * 0.5;
      this.group.add(strap);
    }

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.138, 0.086),
      new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    screen.position.z = 0.009;
    this.group.add(screen);

    // A faint own-light so the display is legible on a dark traverse
    // level without the player needing the flashlight pointed at it.
    const glow = new THREE.PointLight(0x6fa8d0, 0.35, 0.55);
    glow.position.z = 0.06;
    this.group.add(glow);

    this._key = '';
  }

  // Attach to the left grip, rotated so that turning the wrist inward
  // (the gesture for checking a watch) presents the screen to the eyes.
  attachTo(grip) {
    if (!grip || this.group.parent === grip) return;
    grip.add(this.group);
    this.group.position.set(0.0, 0.045, 0.075);
    this.group.rotation.set(-0.95, 0.0, 0.0);
  }


  // s: { objective, sub, left, hp, hpMax, scrap, weapon, mag, reserve,
  //      reloading, baseIntegrity, packs, mines }
  update(s) {
    // Redraw only on real change: a canvas upload every frame costs more
    // than the whole display is worth on a Quest 2.
    const key = [
      s.objective, s.sub, s.left, s.hp, s.scrap, s.weapon, s.mag, s.reserve,
      s.reloading ? 1 : 0, s.baseIntegrity === null ? -1 : Math.round(s.baseIntegrity * 20),
      s.packs, s.mines,
    ].join('|');
    if (key === this._key) return;
    this._key = key;

    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = COL.bg;
    roundRect(c, 0, 0, W, H, 22);
    c.fill();

    // ---- Objective: the biggest thing on the screen, in plain words ----
    c.fillStyle = COL.panel;
    roundRect(c, 14, 14, W - 28, 92, 12);
    c.fill();
    c.fillStyle = COL.accent;
    c.font = 'bold 20px system-ui, sans-serif';
    c.textBaseline = 'top';
    c.fillText('OBJECTIVE', 30, 26);
    c.fillStyle = COL.text;
    c.font = 'bold 42px system-ui, sans-serif';
    c.fillText(s.objective || '', 30, 52);
    if (s.sub) {
      c.fillStyle = COL.dim;
      c.font = '22px system-ui, sans-serif';
      c.fillText(s.sub, 30, 112);
    }

    // ---- Left to kill, when there is a count worth showing ----
    let y = s.sub ? 146 : 124;
    if (s.left !== null && s.left !== undefined) {
      c.fillStyle = COL.dim;
      c.font = 'bold 20px system-ui, sans-serif';
      c.fillText('REMAINING', 30, y);
      c.fillStyle = s.left <= 3 ? COL.good : COL.text;
      c.font = 'bold 40px system-ui, sans-serif';
      c.fillText(String(s.left), 176, y - 8);
    }

    // ---- Health, and the base if this level has one ----
    y += 46;
    c.fillStyle = COL.dim;
    c.font = 'bold 18px system-ui, sans-serif';
    c.fillText('HP', 30, y + 2);
    const hpFrac = s.hp / (s.hpMax || 100);
    bar(c, 74, y, 170, 18, hpFrac, hpFrac < 0.3 ? COL.bad : COL.good);
    c.fillStyle = COL.text;
    c.font = 'bold 20px system-ui, sans-serif';
    c.fillText(String(Math.max(0, Math.round(s.hp))), 254, y);

    if (s.baseIntegrity !== null && s.baseIntegrity !== undefined) {
      c.fillStyle = COL.dim;
      c.font = 'bold 18px system-ui, sans-serif';
      c.fillText('BASE', 312, y + 2);
      bar(c, 376, y, 110, 18, s.baseIntegrity,
        s.baseIntegrity < 0.25 ? COL.bad : s.baseIntegrity < 0.5 ? COL.accent : COL.good);
    }

    // ---- Weapon, ammo, scrap, kit ----
    y += 36;
    c.fillStyle = COL.line;
    c.fillRect(30, y, W - 60, 2);
    y += 14;
    c.fillStyle = COL.text;
    c.font = 'bold 26px system-ui, sans-serif';
    c.fillText(s.weapon || '', 30, y);
    c.font = 'bold 30px system-ui, sans-serif';
    if (s.reloading) {
      c.fillStyle = COL.accent;
      c.fillText('RELOADING', 232, y - 2);
    } else if (s.mag !== null && s.mag !== undefined) {
      c.fillStyle = s.mag === 0 ? COL.bad : COL.text;
      const res = s.reserve < 0 ? '∞' : s.reserve;
      c.fillText(`${s.mag} / ${res}`, 232, y - 2);
    }
    y += 40;
    c.fillStyle = COL.accent;
    c.font = 'bold 20px system-ui, sans-serif';
    c.fillText(`SCRAP ${s.scrap}`, 30, y);
    c.fillStyle = COL.dim;
    c.fillText(`PACK ${s.packs}   MINE ${s.mines}`, 176, y);

    this.tex.needsUpdate = true;
  }
}

// ---- The counter on the weapon ------------------------------------------
// Ammo is the number you need without looking away. It lives on the gun,
// big and high contrast, angled back toward the shooter's eye.
export class WeaponAmmoTag {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = AMMO_W;
    this.canvas.height = AMMO_H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 0.025),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.mesh.position.set(0.021, 0.036, 0.012);
    this.mesh.rotation.set(-0.5, -0.35, 0);
    this._key = '';
  }

  update(mag, magMax, reloading) {
    const key = `${mag}|${magMax}|${reloading ? 1 : 0}`;
    if (key === this._key) return;
    this._key = key;
    const c = this.ctx;
    c.clearRect(0, 0, AMMO_W, AMMO_H);
    c.fillStyle = 'rgba(8,10,13,0.88)';
    roundRect(c, 4, 4, AMMO_W - 8, AMMO_H - 8, 18);
    c.fill();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (reloading) {
      c.fillStyle = COL.accent;
      c.font = 'bold 54px system-ui, sans-serif';
      c.fillText('↻', AMMO_W / 2, AMMO_H / 2);
    } else if (mag === null) {
      c.fillStyle = COL.dim;
      c.font = 'bold 44px system-ui, sans-serif';
      c.fillText('——'.replace(/—/g, '-'), AMMO_W / 2, AMMO_H / 2);
    } else {
      // Empty is red and unmissable: it is the moment you must act on.
      c.fillStyle = mag === 0 ? COL.bad
        : (magMax && mag <= magMax * 0.25) ? COL.accent : COL.text;
      c.font = 'bold 82px system-ui, sans-serif';
      c.fillText(String(mag), AMMO_W / 2, AMMO_H / 2 + 4);
    }
    this.tex.needsUpdate = true;
  }
}
