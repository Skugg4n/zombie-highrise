// Actor visuals: the zombie and remote player avatars, built from cheap
// primitives with readable silhouettes (art bar comes later; Phase 0 needs
// clarity, correct pivots and blob shadows).
import * as THREE from 'three';

const blobTexCache = { tex: null };

function blobTexture() {
  if (blobTexCache.tex) return blobTexCache.tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  blobTexCache.tex = tex;
  return tex;
}

export function makeBlobShadow(radius = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

// Zombie: pale gray body, one clear accent (rust-red torn shirt) readable
// at range. Group origin at the feet.
export function makeZombieMesh() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xb8bdb4, roughness: 0.95 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x8c3b2e, roughness: 0.95 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.95 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.16), pants);
  legL.position.set(-0.11, 0.375, 0);
  const legR = legL.clone(); legR.position.x = 0.11;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.24), shirt);
  torso.position.y = 1.05;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skin);
  head.position.y = 1.52;
  head.rotation.x = 0.25; // lolling head

  // Arms stretched forward, the classic silhouette
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.55), skin);
  armL.position.set(-0.28, 1.22, 0.28);
  const armR = armL.clone(); armR.position.x = 0.28;

  const shadow = makeBlobShadow(0.45);
  shadow.position.y = 0.02;

  g.add(legL, legR, torso, head, armL, armR, shadow);
  g.userData.parts = { legL, legR, armL, armR, torso, head };
  return g;
}

// Remote player avatar. Flat players: capsule body + visor head that pitches.
// VR players: floating head + two hands driven by tracked poses.
export function makeAvatarMesh(colorHex) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.75, 4, 8), bodyMat);
  body.position.y = 0.85;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.28), bodyMat);
  head.position.y = 1.55;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), darkMat);
  visor.position.set(0, 0.02, 0.15);
  head.add(visor);

  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.16), darkMat);
  const handR = handL.clone();
  handL.visible = handR.visible = false;

  const shadow = makeBlobShadow(0.4);
  shadow.position.y = 0.02;

  g.add(body, head, handL, handR, shadow);
  g.userData.parts = { body, head, handL, handR, shadow };
  return g;
}

export const AVATAR_COLORS = [0xe0a33c, 0x7fb069, 0x5c9ead, 0xb669b6, 0xd1653e, 0x8a8f98];
