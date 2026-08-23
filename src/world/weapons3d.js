// Weapon and pickup meshes: cheap primitives, scrappy-improvised look
// (taped grips, mismatched parts). Used as flat-mode viewmodels, VR hand
// models and world pickups.
import * as THREE from 'three';

const metal = () => new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.55, metalness: 0.4 });
const wood = () => new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.9 });
const tape = () => new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1.0 });

// Same as part(), but tags the mesh so the recoil animation can find it.
function namedPart(g, geo, material, x, y, z, rx, name) {
  const m = part(g, geo, material, x, y, z, rx || 0);
  m.name = name;
  return m;
}

function part(g, geo, material, x, y, z, rx = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  g.add(m);
  return m;
}

export function makeWeaponMesh(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'shotgun': {
      part(g, new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8), metal(), 0, 0.02, -0.22, Math.PI / 2);
      namedPart(g, new THREE.CylinderGeometry(0.026, 0.026, 0.3, 8), tape(), 0, -0.02, -0.16, Math.PI / 2, 'slide');
      part(g, new THREE.BoxGeometry(0.05, 0.09, 0.24), wood(), 0, -0.02, 0.1);
      part(g, new THREE.BoxGeometry(0.04, 0.12, 0.06), wood(), 0, -0.09, 0.16, 0.3);
      break;
    }
    case 'smg': {
      namedPart(g, new THREE.BoxGeometry(0.05, 0.08, 0.3), metal(), 0, 0, -0.08, 0, 'slide');
      part(g, new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), metal(), 0, 0.01, -0.3, Math.PI / 2);
      part(g, new THREE.BoxGeometry(0.035, 0.14, 0.05), metal(), 0, -0.1, -0.02, 0.15);
      part(g, new THREE.BoxGeometry(0.032, 0.09, 0.045), tape(), 0, -0.06, 0.09, 0.25);
      break;
    }
    case 'ak': {
      namedPart(g, new THREE.BoxGeometry(0.05, 0.07, 0.42), metal(), 0, 0, -0.1, 0, 'slide');
      part(g, new THREE.CylinderGeometry(0.014, 0.014, 0.22, 8), metal(), 0, 0.015, -0.4, Math.PI / 2);
      part(g, new THREE.BoxGeometry(0.045, 0.06, 0.16), wood(), 0, -0.005, 0.2);       // stock
      part(g, new THREE.BoxGeometry(0.045, 0.05, 0.14), wood(), 0, -0.01, -0.32);      // foregrip
      const mag = part(g, new THREE.BoxGeometry(0.035, 0.16, 0.07), metal(), 0, -0.11, -0.06);
      mag.rotation.x = 0.5;                                                            // curved mag hint
      break;
    }
    case 'akimbo': {
      for (const dx of [-0.09, 0.09]) {
        part(g, new THREE.BoxGeometry(0.035, 0.045, 0.16), metal(), dx, 0.015, -0.05);
        part(g, new THREE.BoxGeometry(0.032, 0.09, 0.045), wood(), dx, -0.045, 0.02, 0.25);
      }
      break;
    }
    case 'machete': {
      part(g, new THREE.BoxGeometry(0.012, 0.07, 0.42), metal(), 0, 0.02, -0.24);
      part(g, new THREE.BoxGeometry(0.03, 0.045, 0.13), tape(), 0, -0.02, 0.05, 0.2);
      break;
    }
    case 'grenade': {
      part(g, new THREE.SphereGeometry(0.05, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x3f4a38, roughness: 0.7 }), 0, 0, 0);
      part(g, new THREE.BoxGeometry(0.02, 0.03, 0.02), metal(), 0, 0.06, 0);
      break;
    }
    default: {  // pistol: slide + barrel + front sight + trigger guard + taped grip
      // The slide is tagged so recoil can cycle it. Ola: "the pistol has
      // no visible recoil in VR, so the shot feels dead."
      const slide = part(g, new THREE.BoxGeometry(0.034, 0.038, 0.15), metal(), 0, 0.022, -0.05);
      slide.name = 'slide';
      part(g, new THREE.BoxGeometry(0.03, 0.02, 0.13), metal(), 0, 0.0, -0.055);      // frame
      part(g, new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6), metal(), 0, 0.022, -0.135, Math.PI / 2);
      part(g, new THREE.BoxGeometry(0.006, 0.012, 0.008), metal(), 0, 0.047, -0.115); // front sight
      part(g, new THREE.BoxGeometry(0.012, 0.008, 0.006), metal(), 0, 0.045, 0.01);   // rear sight
      const guard = part(g, new THREE.BoxGeometry(0.006, 0.03, 0.045), metal(), 0, -0.028, -0.015);
      guard.rotation.x = 0.15;
      part(g, new THREE.BoxGeometry(0.034, 0.085, 0.042), tape(), 0, -0.05, 0.022, 0.22); // taped grip
      break;
    }
  }
  return g;
}

// The off hand in VR. It used to be a bare glove, and Ola read that as
// "a mechanical lump that can shoot". It is a FLASHLIGHT now: something
// with an obvious purpose that you aim independently of the gun, which is
// the whole point of having two hands in VR.
//
// The caller decides whether to light it. On a daylight holdout level a
// lit torch is absurd, so the lamp stays off and the hand simply holds
// the tool.
export function makeFlashlightMesh() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x2f343a, roughness: 0.5, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 1.0 });
  part(g, new THREE.CylinderGeometry(0.023, 0.026, 0.15, 10), shell, 0, 0, -0.05, Math.PI / 2);
  part(g, new THREE.CylinderGeometry(0.019, 0.019, 0.06, 10), grip, 0, 0, 0.035, Math.PI / 2);
  part(g, new THREE.CylinderGeometry(0.032, 0.026, 0.035, 10), shell, 0, 0, -0.13, Math.PI / 2);
  // The lens: emissive so you can see the tool is on without looking at
  // what it is pointing at.
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.028, 12),
    new THREE.MeshStandardMaterial({ color: 0x0d0f11, emissive: 0xffe9c0, emissiveIntensity: 0 }));
  lens.position.set(0, 0, -0.147);
  lens.rotation.y = Math.PI;
  g.add(lens);
  g.userData.lens = lens;
  return g;
}

// An under-barrel light for when both hands are full (dual pistols).
export function makeUnderBarrelLight() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5, metalness: 0.4 });
  part(g, new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8), shell, 0, -0.028, -0.06, Math.PI / 2);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.013, 10),
    new THREE.MeshStandardMaterial({ color: 0x0d0f11, emissive: 0xffe9c0, emissiveIntensity: 0 }));
  lens.position.set(0, -0.028, -0.096);
  lens.rotation.y = Math.PI;
  g.add(lens);
  g.userData.lens = lens;
  return g;
}

// World pickups: readable at a glance, bob + spin driven by the caller.
export function makeItemMesh(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'pack': {
      const box = part(g, new THREE.BoxGeometry(0.34, 0.22, 0.26),
        new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 }), 0, 0.11, 0);
      part(g, new THREE.BoxGeometry(0.26, 0.05, 0.07),
        new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 }), 0, 0.24, 0);
      part(g, new THREE.BoxGeometry(0.07, 0.05, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 }), 0, 0.24, 0);
      box.name = 'pack';
      break;
    }
    case 'grenade': {
      const m = makeWeaponMesh('grenade');
      m.scale.setScalar(1.6);
      m.position.y = 0.12;
      g.add(m);
      break;
    }
    case 'ammo_shotgun': {
      part(g, new THREE.BoxGeometry(0.3, 0.16, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x7d3b2a, roughness: 0.9 }), 0, 0.08, 0);
      part(g, new THREE.BoxGeometry(0.31, 0.04, 0.21),
        new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.9 }), 0, 0.14, 0);
      break;
    }
    case 'ammo_smg': {
      part(g, new THREE.BoxGeometry(0.3, 0.16, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x3d5a3a, roughness: 0.9 }), 0, 0.08, 0);
      part(g, new THREE.BoxGeometry(0.31, 0.04, 0.21),
        new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.9 }), 0, 0.14, 0);
      break;
    }
    default: break;
  }
  return g;
}
