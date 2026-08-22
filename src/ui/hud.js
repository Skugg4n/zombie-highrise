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
    if (info.mag === null) {
      $('hud-ammo').textContent = 'MELEE';
    } else if (info.reloading) {
      $('hud-ammo').textContent = 'RELOADING...';
    } else {
      const res = info.reserve < 0 ? '∞' : info.reserve;
      $('hud-ammo').textContent = `${info.mag} / ${res}`;
    }
    $('hud-items').textContent = `G ${info.grenades}  P ${info.packs}  M ${info.mines || 0}`;
  }
  setScrap(n) { $('hud-scrap').textContent = 'SCRAP ' + n; }
  setWave(text) { $('hud-wave').textContent = text; }
}
