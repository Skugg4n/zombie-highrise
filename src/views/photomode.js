// Photo mode (?photomode=N): deterministic boot with a fixed camera preset
// so the critic loop compares like for like across iterations.
// 1 ground-level exterior day    5 distant horde (Phase 1+, placeholder angle)
// 2 basement corridor (Phase 1+) 6 balcony vista (Phase 1+, high angle)
// 3 elevator interior (Phase 1+) 7 trench at night (Phase 1+)
// 4 tactical view                8 HUD in action
// 9 debug texture atlas check
import * as THREE from 'three';
import { applyDebugAtlas } from '../world/debugatlas.js';

const PRESETS = {
  1: { pos: [10, 1.7, 12], look: [0, 1.2, 0] },        // exterior day, base in frame
  2: { pos: [4, 1.5, 4], look: [-4, 0.8, -4] },        // placeholder until basement exists
  3: { pos: [2, 1.6, 2], look: [0, 1.2, 0] },          // placeholder until elevator exists
  4: { pos: [0, 42, 0.01], look: [0, 0, 0] },          // tactical top-down
  5: { pos: [-6, 1.7, -6], look: [-30, 1.0, 20] },     // looking out toward the spawn approach
  6: { pos: [14, 9, 14], look: [0, 0.5, 0] },          // high vista placeholder
  7: { pos: [-7, 1.4, 6], look: [-30, 0.8, 20] },      // will become trench at night
  8: { pos: [1, 1.7, 5], look: [-8, 1.0, -6] },        // HUD in action (HUD forced on)
  9: { pos: [8, 3.5, 10], look: [0, 0.8, 0] },         // atlas check: floor, walls, crates in frame
};

// Applies a photomode preset. Returns true if the mode wants the HUD shown.
export function applyPhotomode(n, { camera, scene }) {
  const p = PRESETS[n] || PRESETS[1];
  camera.position.set(...p.pos);
  camera.lookAt(new THREE.Vector3(...p.look));
  if (n === 9) applyDebugAtlas(scene);
  return n === 8;
}
