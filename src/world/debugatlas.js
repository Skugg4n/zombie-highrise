// Texture correctness check (?photomode=9). A generated debug atlas with
// readable text and direction arrows is applied to every mesh material in
// the scene. Any mirrored or upside-down text in a screenshot is an
// instant fail (see LESSONS.md: mixed flipY pipelines).
//
// Pipeline rule: this project generates textures via CanvasTexture, which
// uses the standard Three.js pipeline (flipY = true). If glTF assets are
// ever added, their textures stay in the glTF pipeline (flipY = false) and
// are NEVER mixed with canvas textures on the same material.
import * as THREE from 'three';

export function makeDebugAtlasTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  const cells = 4;
  const cs = S / cells;
  const colors = ['#3a6ea5', '#a53a3a', '#3aa56e', '#a5883a'];
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const x = col * cs, y = row * cs;
      ctx.fillStyle = colors[(row + col) % colors.length];
      ctx.fillRect(x, y, cs, cs);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);

      // Cell label, e.g. "B3": readable text exposes any flip instantly.
      // Canvas rows are numbered top to bottom; UV v=1 is the top row of
      // the drawn image under flipY=true, so labels read naturally.
      const label = String.fromCharCode(65 + row) + (col + 1);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${cs * 0.32}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + cs / 2, y + cs * 0.4);

      // Up arrow + the word UP
      ctx.font = `bold ${cs * 0.18}px sans-serif`;
      ctx.fillText('↑ UP', x + cs / 2, y + cs * 0.75);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Replace every opaque mesh material in the scene with the debug atlas
// material. Transparent helpers (blob shadows) keep their material: they
// carry no meaningful UV mapping and would render as opaque squares.
export function applyDebugAtlas(scene) {
  const tex = makeDebugAtlasTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  scene.traverse((obj) => {
    if (obj.isMesh && !obj.material.transparent) obj.material = mat;
  });
}
