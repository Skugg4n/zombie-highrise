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

// Zombies: pale gray bodies with ONE clear accent color per type so the
// silhouette + color identify the enemy in a tenth of a second at range
// (art direction rule). Group origin at the feet.
//   walker: medium build, rust-red torn shirt
//   runner: lean and tall, hunched sprint pose, yellow sash
//   brute:  massive shoulders, dark red, head sunk into the torso
const ZOMBIE_LOOKS = {
  walker: { accent: 0x8c3b2e, scaleX: 1.0, scaleY: 1.0, lean: 0.10, armLen: 0.55 },
  runner: { accent: 0xd8a020, scaleX: 0.78, scaleY: 1.08, lean: 0.55, armLen: 0.45 },
  brute: { accent: 0x6e1f18, scaleX: 1.7, scaleY: 1.05, lean: 0.18, armLen: 0.65 },
};

// Skin and pants materials are SHARED across every zombie (Quest 2 is
// draw-call/material bound); only the accent shirt is unique per zombie
// so the hit flash can pulse one zombie without lighting up the horde.
const sharedSkin = new THREE.MeshStandardMaterial({ color: 0xb8bdb4, roughness: 0.95 });
const sharedPants = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.95 });
// Materials that must NEVER be disposed when a single actor is removed.
export const SHARED_MATERIALS = new Set([sharedSkin, sharedPants]);

export function makeZombieMesh(type = 'walker') {
  const look = ZOMBIE_LOOKS[type] || ZOMBIE_LOOKS.walker;
  const g = new THREE.Group();
  const skin = sharedSkin;
  const shirt = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.95 });
  const pants = sharedPants;

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16 * look.scaleX, 0.75, 0.16), pants);
  legL.position.set(-0.11 * look.scaleX, 0.375, 0);
  const legR = legL.clone(); legR.position.x = 0.11 * look.scaleX;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44 * look.scaleX, 0.6 * look.scaleY, 0.24 * look.scaleX), shirt);
  torso.position.y = 1.05;
  torso.rotation.x = look.lean * 0.5;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skin);
  head.position.y = type === 'brute' ? 1.42 : 1.52 * look.scaleY;
  head.position.z = look.lean * 0.3;
  head.rotation.x = 0.25;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, look.armLen), skin);
  armL.position.set(-0.28 * look.scaleX, 1.22, 0.28);
  const armR = armL.clone(); armR.position.x = 0.28 * look.scaleX;

  const shadow = makeBlobShadow(type === 'brute' ? 0.65 : 0.45);
  shadow.position.y = 0.02;

  g.add(legL, legR, torso, head, armL, armR, shadow);
  g.userData.parts = { legL, legR, armL, armR, torso, head };
  g.userData.type = type;
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
