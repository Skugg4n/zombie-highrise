// Photo mode (?photomode=N): deterministic boot (fixed seed, fixed poses,
// fixed camera) so the critic loop compares like for like.
// 1 ground-level exterior day     6 balcony vista (upper floor level)
// 2 basement corridor flashlight  7 trench at night (trench level)
// 3 elevator interior             8 HUD in action
// 4 tactical view                 9 debug texture atlas check
// Modes 2, 6 and 7 boot their own level type (see PHOTO_LEVEL in main.js).
import * as THREE from 'three';
import { applyDebugAtlas } from '../world/debugatlas.js';

const STATIC_PRESETS = {
  1: { pos: [10, 1.7, 12], look: [0, 1.2, 0] },
  4: { pos: [0, 42, 0.01], look: [0, 0, 0] },
  5: { pos: [-4, 1.6, -5], look: [-20, 1.0, 18] },   // looking out at the approach
  7: { pos: [3, 1.4, -4], look: [-8, 0.6, -4] },   // down a trench lane, flare-lit
  8: { pos: [1, 1.7, 5], look: [-8, 1.0, -6] },
  9: { pos: [8, 3.5, 10], look: [0, 0.8, 0] },
};

// Applies a photomode preset. Returns true if the mode wants the HUD shown.
export function applyPhotomode(n, { camera, scene, level }) {
  if (n === 2) {
    // Basement: from the room centre toward a doorway, flashlight-lit.
    const entry = level.entries[0] || new THREE.Vector3(0, 0, 8);
    camera.position.set(entry.x * -0.35, 1.5, entry.z * -0.35);
    camera.lookAt(entry.x, 1.0, entry.z);
  } else if (n === 3) {
    // Inside the elevator cab, looking out through the doors.
    const e = level.elevator.group;
    e.updateMatrixWorld(true);
    camera.position.copy(e.localToWorld(new THREE.Vector3(0, 1.6, -0.4)));
    camera.lookAt(e.localToWorld(new THREE.Vector3(0, 1.1, 4)));
  } else if (n === 6) {
    // Upper floor: from the room, out through the windows and down.
    camera.position.set(0, 1.7, 2);
    camera.lookAt(4, -5, 30);
  } else {
    const p = STATIC_PRESETS[n] || STATIC_PRESETS[1];
    camera.position.set(...p.pos);
    camera.lookAt(new THREE.Vector3(...p.look));
  }
  if (n === 9) applyDebugAtlas(scene);
  return n === 8;
}

// Deterministic zombie dressing per mode: [type, x, z, faceX, faceZ, animT]
export const PHOTO_ZOMBIES = {
  1: [['walker', -10, 8, 0, 0, 1.2], ['walker', -13, 11, 0, 0, 2.6]],
  2: [],   // placed dynamically in main.js: in front of the mode-2 camera
  3: [],
  4: [['walker', -6, 6, 0, 0, 1.0], ['runner', 5, -7, 0, 0, 2.0]],
  5: [['walker', -14, 12, 0, 0, 0.5], ['walker', -17, 15, 0, 0, 1.7],
      ['runner', -12, 16, 0, 0, 2.4], ['walker', -20, 10, 0, 0, 3.1],
      ['brute', -16, 19, 0, 0, 0.2], ['walker', -22, 14, 0, 0, 1.1]],
  6: [['runner', 2.5, 4.5, 0, 2, 1.4]],
  7: [['walker', -2, -4, 3, -4, 0.9]],
  8: [['walker', -6, -4, 1, 5, 1.5], ['runner', -8, -7, 1, 5, 0.4]],
  9: [['walker', 2, 2, 8, 10, 1.0]],
};
