// Shared palette and procedural materials. Split out of levelgen.js so
// level builders can live in their own modules without importing each
// other (holdout.js would otherwise form a cycle with levelgen.js).
import * as THREE from 'three';
import { noiseTexture, plankTexture, metalTexture, sandbagTexture, facadeTexture } from './textures.js';

export const PALETTE = {
  daySky: 0xa8c8e0, dayHaze: 0xd6c9a8,
  nightSky: 0x101a2e, nightHaze: 0x18223a,
  sand: 0xc9b088, concrete: 0x9a938a, sandbag: 0xb0a070,
  wood: 0x8a6f4d, hills: 0xb8a583, road: 0x6f6a62,
  basementWall: 0x6e6a63, basementFloor: 0x55524c,
  interiorWall: 0x8f8274, interiorFloor: 0x7a6f5e,
  metal: 0x5a5d63, metalDark: 0x3a3d42, rust: 0x7d5636,
};

export const mat = (color, rough = 0.9, metal = 0.0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
export const matT = (map, rough = 0.9, metal = 0.0, color = 0xffffff) =>
  new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: metal });

// Shared procedural materials (built once, reused by every level build).
export const MATS = {
  get sandGround() { return this._sg || (this._sg = matT(noiseTexture('sand-ground', 0xc9b088, [0xb89e76, 0xd8c29a, 0xa8906a], { repeat: 90, density: 1200 }), 1.0)); },
  get concrete() { return this._co || (this._co = matT(noiseTexture('concrete', 0x9a938a, [0x8a847c, 0xa8a29a, 0x7e7870], { repeat: 5, density: 1400, alpha: 0.2 }), 0.95)); },
  get sandbag() { return this._sb || (this._sb = matT(sandbagTexture('sandbag', 0xb0a070), 1.0)); },
  get crate() { return this._cr || (this._cr = matT(plankTexture('crate', 0x8a6f4d, 0x5c4630), 0.95)); },
  get basementWall() { return this._bw || (this._bw = matT(noiseTexture('bwall', 0x6e6a63, [0x5c584f, 0x7c786f, 0x4c4841], { repeat: 3, density: 1600, alpha: 0.22 }), 1.0)); },
  get basementFloor() { return this._bf || (this._bf = matT(noiseTexture('bfloor', 0x55524c, [0x45423c, 0x63605a, 0x39362f], { repeat: 8, density: 1600, alpha: 0.25 }), 1.0)); },
  get plaster() { return this._pl || (this._pl = matT(noiseTexture('plaster', 0x8f8274, [0x7f7264, 0x9f9284, 0x6f6254], { repeat: 3, density: 900, alpha: 0.15 }), 0.95)); },
  get parquet() { return this._pq || (this._pq = matT(plankTexture('parquet', 0x7a6a52, 0x54462f, { planks: 8, repeat: 1 }), 0.9)); },
  get metalShell() { return this._ms || (this._ms = matT(metalTexture('elev', 0x5a5d63, { repeat: 2 }), 0.55, 0.5)); },
  get metalDoor() { return this._md || (this._md = matT(metalTexture('door', 0x42454b, { repeat: 2 }), 0.6, 0.4)); },
  get dirt() { return this._di || (this._di = matT(noiseTexture('dirt', 0x4e4436, [0x3e3628, 0x5e5244, 0x2f2a1f], { repeat: 4, density: 1800, alpha: 0.25 }), 1.0)); },
  get planksOld() { return this._po || (this._po = matT(plankTexture('oldplanks', 0x6e5a40, 0x463a26, { planks: 6, repeat: 2 }), 1.0)); },
  get facade() { return this._fa || (this._fa = new THREE.MeshStandardMaterial({ map: facadeTexture('tower', 0x5c554c), roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.0, emissiveMap: facadeTexture('tower', 0x5c554c, { emissiveOnly: true }) })); },
};

