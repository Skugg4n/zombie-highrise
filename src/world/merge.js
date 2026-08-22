// Static geometry merger: bakes every non-dynamic mesh in a group into one
// mesh per material (Quest 2 is draw-call bound; a level built from many
// small boxes must not cost a draw call each). Meshes marked
// userData.dynamic (elevator doors, lights' housings that move) are left
// alone, as are Points/Sprites/lights.
import * as THREE from 'three';

export function mergeStaticMeshes(group) {
  const byMaterial = new Map();   // material -> [{geometry, matrix}]
  const toRemove = [];

  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    if (!obj.isMesh || obj.userData.dynamic) return;
    // Only merge plain single-material meshes.
    if (Array.isArray(obj.material)) return;
    let list = byMaterial.get(obj.material);
    if (!list) byMaterial.set(obj.material, list = []);
    list.push({ geometry: obj.geometry, matrix: obj.matrixWorld.clone() });
    toRemove.push(obj);
  });

  // Nothing to gain below a handful of meshes.
  if (toRemove.length < 6) return;

  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  for (const [material, list] of byMaterial) {
    if (list.length === 0) continue;
    const merged = mergeGeometries(list, inverse);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.userData.merged = true;
    group.add(mesh);
  }
  for (const obj of toRemove) {
    obj.parent.remove(obj);
    // Source geometries may be shared between meshes; dispose only after
    // all references are gone. Box/plane geometries here are per-mesh.
    obj.geometry.dispose();
  }
}

// Bakes each geometry through its matrix and concatenates position /
// normal / uv into one non-indexed BufferGeometry.
function mergeGeometries(list, groupInverse) {
  let vertCount = 0;
  const prepared = [];
  for (const { geometry, matrix } of list) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const local = new THREE.Matrix4().multiplyMatrices(groupInverse, matrix);
    geo.applyMatrix4(local);
    if (!geo.attributes.position) continue;
    prepared.push(geo);
    vertCount += geo.attributes.position.count;
  }
  if (!vertCount) return null;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  let offset = 0;
  for (const geo of prepared) {
    const n = geo.attributes.position.count;
    positions.set(geo.attributes.position.array, offset * 3);
    if (geo.attributes.normal) normals.set(geo.attributes.normal.array, offset * 3);
    if (geo.attributes.uv) uvs.set(geo.attributes.uv.array, offset * 2);
    offset += n;
    geo.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return merged;
}
