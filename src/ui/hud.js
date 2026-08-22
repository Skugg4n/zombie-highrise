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
  setAmmo(cur, mag, reloading) {
    $('hud-ammo').textContent = reloading ? 'RELOADING...' : cur + ' / ' + mag;
  }
  setWave(text) { $('hud-wave').textContent = text; }
}
