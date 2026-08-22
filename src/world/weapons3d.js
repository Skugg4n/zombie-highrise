// Weapon and pickup meshes: cheap primitives, scrappy-improvised look
// (taped grips, mismatched parts). Used as flat-mode viewmodels, VR hand
// models and world pickups.
import * as THREE from 'three';

const metal = () => new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.55, metalness: 0.4 });
const wood = () => new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.9 });
const tape = () => new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1.0 });

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
      part(g, new THREE.CylinderGeometry(0.026, 0.026, 0.3, 8), tape(), 0, -0.02, -0.16, Math.PI / 2);
      part(g, new THREE.BoxGeometry(0.05, 0.09, 0.24), wood(), 0, -0.02, 0.1);
      part(g, new THREE.BoxGeometry(0.04, 0.12, 0.06), wood(), 0, -0.09, 0.16, 0.3);
      break;
    }
    case 'smg': {
      part(g, new THREE.BoxGeometry(0.05, 0.08, 0.3), metal(), 0, 0, -0.08);
      part(g, new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), metal(), 0, 0.01, -0.3, Math.PI / 2);
      part(g, new THREE.BoxGeometry(0.035, 0.14, 0.05), metal(), 0, -0.1, -0.02, 0.15);
      part(g, new THREE.BoxGeometry(0.032, 0.09, 0.045), tape(), 0, -0.06, 0.09, 0.25);
      break;
    }
    case 'ak': {
      part(g, new THREE.BoxGeometry(0.05, 0.07, 0.42), metal(), 0, 0, -0.1);
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
    default: {  // pistol
      part(g, new THREE.BoxGeometry(0.035, 0.045, 0.16), metal(), 0, 0.015, -0.05);
      part(g, new THREE.BoxGeometry(0.032, 0.09, 0.045), wood(), 0, -0.045, 0.02, 0.25);
      break;
    }
  }
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
