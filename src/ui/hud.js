// HUD readouts and the always-visible version tag (debug layer, z 900).
import { VERSION } from '../config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    $('version').textContent = 'v' + VERSION;
  }
  setRoom(code) { $('hud-room').textContent = code ? 'ROOM ' + code : 'SOLO'; }
  setHealth(hp) {
    $('hud-health').textContent = 'HP ' + hp;
    $('hud-health').style.color = hp <= 25 ? 'var(--danger)' : 'var(--accent2)';
  }
  // info: { name, mag, reserve (-1 = infinite, null = melee), reloading,
  //         grenades, packs }
  setWeapon(info) {
    $('hud-weapon').textContent = info.name;
    const ammoEl = $('hud-ammo');
    if (info.mag === null) {
      ammoEl.textContent = 'MELEE';
      ammoEl.style.color = '';
    } else if (info.reloading) {
      ammoEl.textContent = 'RELOADING...';
      ammoEl.style.color = 'var(--accent)';
    } else {
      const res = info.reserve < 0 ? '∞' : info.reserve;
      ammoEl.textContent = `${info.mag} / ${res}`;
      // Low-ammo state: amber at a quarter mag, red when empty.
      ammoEl.style.color = info.mag === 0 ? 'var(--danger)'
        : info.magMax && info.mag <= info.magMax * 0.25 ? 'var(--accent)' : '';
    }
    $('hud-items').textContent = `${(info.throwSel || 'frag').toUpperCase()} x${info.throwCount ?? info.grenades}  P ${info.packs}  M ${info.mines || 0}`;
  }
  setScrap(n) { $('hud-scrap').textContent = 'SCRAP ' + n; }
  // Night vision battery readout; hidden until the device is owned.
  setNightVision(owned, on, battery) {
    const el = $('hud-nv');
    el.classList.toggle('hidden', !owned);
    if (owned) {
      el.textContent = 'NV ' + (on ? 'ON ' : '') + Math.ceil(battery) + 's';
      el.style.color = on ? 'var(--accent2)' : 'var(--text)';
    }
  }
  setWave(text) { $('hud-wave').textContent = text; }
}
