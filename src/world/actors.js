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

  // Legs pivot at the hip, arms at the shoulder (geometry translated so
  // rotations read as joints, not center spins).
  const legGeo = new THREE.BoxGeometry(0.16 * look.scaleX, 0.75, 0.16);
  legGeo.translate(0, -0.375, 0);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.11 * look.scaleX, 0.75, 0);
  const legR = legL.clone(); legR.position.x = 0.11 * look.scaleX;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44 * look.scaleX, 0.6 * look.scaleY, 0.24 * look.scaleX), shirt);
  torso.position.y = 1.05;
  torso.rotation.x = look.lean * 0.5;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skin);
  head.position.y = type === 'brute' ? 1.42 : 1.52 * look.scaleY;
  head.position.z = look.lean * 0.3;
  head.rotation.x = 0.25;

  const armGeo = new THREE.BoxGeometry(0.11, 0.11, look.armLen);
  armGeo.translate(0, 0, look.armLen / 2);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.28 * look.scaleX, 1.22, 0.05);
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
// A PLAYER, as your teammates see you.
//
// Ola, co-op VR playtest: "players currently render as a gas bottle with
// no arms or legs. In co-op VR, seeing your teammates as people is most of
// the social presence, so this matters more here than on flat."
//
// It was a capsule with a box head and two floating hand blocks. Now it is
// a person: torso, head, two upper arms and two forearms that reach for
// wherever the hands actually are, and legs that stride when the body
// moves. In VR the head and both hands come straight from the headset and
// controllers, and the ARMS ARE INFERRED from them by two-bone IK, which
// is what makes a tracked player read as a body rather than as three
// objects floating in formation.
export function makeAvatarMesh(colorHex) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8d6a4f, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.52, 4, 8), bodyMat);
  body.position.y = 1.06;
  // A collar and a strap so the torso has a front, which is what tells you
  // at a glance which way a teammate is facing.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.09, 10), darkMat);
  collar.position.y = 1.38;
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, 0.03), darkMat);
  strap.position.set(0, 1.14, 0.18);
  strap.rotation.z = 0.35;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.25, 0.27), bodyMat);
  head.position.y = 1.55;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), darkMat);
  visor.position.set(0, 0.02, 0.15);
  head.add(visor);

  // Arms as two bones each. Each segment is modelled along -Z from its
  // own origin so it can simply look at the next joint.
  const seg = (len, r, mat) => {
    const m = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - r * 2, 3, 6), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = -len / 2;
    m.add(mesh);
    return m;
  };
  const arms = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -0.22 : 0.22;
    const upper = seg(0.26, 0.055, bodyMat);
    upper.position.set(sx, 1.32, 0);
    const fore = seg(0.26, 0.048, bodyMat);
    upper.add(fore);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.13), skinMat);
    arms[side] = { upper, fore, hand };
    g.add(upper, hand);
  }

  // Legs: two bones each, driven by a stride cycle rather than IK. Nobody
  // tracks their feet, and a plausible walk beats a wrong one.
  const legs = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -0.1 : 0.1;
    const thigh = seg(0.4, 0.07, darkMat);
    thigh.position.set(sx, 0.82, 0);
    thigh.rotation.x = -Math.PI / 2;     // hang downward at rest: a segment
                                         // runs along -Z, so -PI/2 about X
                                         // points it at the floor, not the sky
    const shin = seg(0.42, 0.06, darkMat);
    shin.position.z = -0.4;
    thigh.add(shin);
    legs[side] = { thigh, shin };
    g.add(thigh);
  }

  const shadow = makeBlobShadow(0.4);
  shadow.position.y = 0.02;

  g.add(body, collar, strap, head, shadow);
  g.userData.parts = {
    body, collar, strap, head, shadow, arms, legs,
    handL: arms.L.hand, handR: arms.R.hand,
    lastPos: new THREE.Vector3(), strideT: 0,
  };
  return g;
}

// A floating name tag. In co-op the first question is always "who is
// that", and a colour alone stops answering it once you have four
// players and a horde.
export function makeNameTag(name, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(10,12,16,0.72)';
  x.beginPath();
  x.roundRect(2, 2, 252, 60, 14);
  x.fill();
  x.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
  x.lineWidth = 4;
  x.stroke();
  x.fillStyle = '#e8e4da';
  x.font = 'bold 34px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText((name || 'PLAYER').slice(0, 12).toUpperCase(), 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.11),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.y = 1.92;
  return m;
}

export const AVATAR_COLORS = [0xe0a33c, 0x7fb069, 0x5c9ead, 0xb669b6, 0xd1653e, 0x8a8f98];
