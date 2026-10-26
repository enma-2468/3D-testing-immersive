import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';

// Performance helpers. None of these change what ends up on screen:
//  - mergeStatic: hundreds of small architectural boxes -> one mesh per material
//  - BVH raycasting: hover/click/walk picking stays ~O(log n) on merged meshes
//  - LODs: distant copies of very dense scanned models use a simplified mesh

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const KEEP_ATTRS = ['position', 'normal', 'uv'];

function hasInteractiveBetween(mesh, container) {
  for (let o = mesh.parent; o && o !== container; o = o.parent) {
    if (o.userData.interactive) return true;
  }
  return false;
}

// Split a multi-material mesh into one geometry per material group
function splitByGroups(geometry, materials) {
  const out = [];
  const src = geometry.index ? geometry : null;
  for (const g of geometry.groups) {
    const geo = new THREE.BufferGeometry();
    for (const name of KEEP_ATTRS) geo.setAttribute(name, geometry.attributes[name]);
    if (src) geo.setIndex(Array.from(src.index.array.slice(g.start, g.start + g.count)));
    else geo.setDrawRange(g.start, g.count);
    out.push({ geometry: geo, material: materials[g.materialIndex] });
  }
  return out;
}

function prepare(geometry, matrix) {
  let geo = geometry.clone();
  for (const name of Object.keys(geo.attributes)) if (!KEEP_ATTRS.includes(name)) geo.deleteAttribute(name);
  if (!geo.attributes.uv) return null;
  if (geo.index) geo = geo.toNonIndexed(); // every input non-indexed so they can merge
  geo.applyMatrix4(matrix);
  geo.clearGroups();
  return geo;
}

/**
 * Merge every static mesh under `container` (relative to the container's
 * frame) into one mesh per material + shadow/AO flags. Meshes under an
 * interactive object belong to that object and are merged inside it instead.
 */
export function mergeStatic(container) {
  container.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];

  container.traverse((o) => {
    if (o === container || !o.isMesh || o.isInstancedMesh || o.userData.keep || o.userData.merged) return;
    if (hasInteractiveBetween(o, container)) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const parts = (Array.isArray(o.material)
      ? splitByGroups(o.geometry, o.material)
      : [{ geometry: o.geometry, material: o.material }])
      .map((p) => ({ ...p, geo: prepare(p.geometry, local) }));
    if (parts.some((p) => !p.geo)) return; // can't merge (e.g. no UVs): leave it alone
    for (const { geo, material } of parts) {
      const key = `${material.uuid}|${o.castShadow}|${o.receiveShadow}|${!!o.userData.noAO}`;
      if (!buckets.has(key)) buckets.set(key, { material, cast: o.castShadow, receive: o.receiveShadow, noAO: o.userData.noAO, geos: [] });
      buckets.get(key).geos.push(geo);
    }
    victims.push(o);
  });

  for (const v of victims) v.parent.remove(v);
  let count = 0;
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    merged.computeBoundingSphere();
    merged.computeBoundsTree();
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    if (b.noAO) mesh.userData.noAO = true;
    mesh.userData.merged = true;
    container.add(mesh);
    count++;
  }
  return { removed: victims.length, created: count };
}

/** Merge the world: each level/site container, plus the inside of every interactive object. */
export function optimiseWorld(containers) {
  let removed = 0, created = 0;
  const interactive = [];
  for (const c of containers) c.traverse((o) => { if (o.userData.interactive) interactive.push(o); });
  for (const obj of interactive) {
    const r = mergeStatic(obj);
    removed += r.removed; created += r.created;
  }
  for (const c of containers) {
    const r = mergeStatic(c);
    removed += r.removed; created += r.created;
  }
  return { removed, created };
}

// ---------------------------------------------------------------------------
// LOD generation for dense scanned models
// ---------------------------------------------------------------------------
const simplified = new Map(); // geometry uuid -> simplified geometry (or the original)

function simplifyGeometry(geometry, ratio) {
  if (simplified.has(geometry.uuid)) return simplified.get(geometry.uuid);
  let result = geometry;
  const pos = geometry.attributes.position;
  const tris = (geometry.index ? geometry.index.count : pos.count) / 3;
  if (geometry.index && tris > 4000 && !pos.isInterleavedBufferAttribute) {
    const indices = new Uint32Array(geometry.index.array);
    const positions = pos.array instanceof Float32Array ? pos.array : new Float32Array(pos.array);
    const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
    // borders locked so alpha-cut leaves and fabric seams keep their silhouette
    const [out] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.01, ['LockBorder']);
    if (out.length < indices.length * 0.8) {
      result = geometry.clone();
      result.setIndex(new THREE.BufferAttribute(out, 1));
    }
  }
  simplified.set(geometry.uuid, result);
  return result;
}

export const simplifierReady = MeshoptSimplifier.ready;

/**
 * Wrap a model root in a THREE.LOD: full detail up close, simplified beyond
 * `distance` metres. Returns the root unchanged if nothing was worth simplifying.
 */
export function withLOD(root, distance, ratio = 0.25) {
  let saved = 0;
  const low = root.clone(true);
  low.traverse((o) => {
    if (!o.isMesh) return;
    const g = simplifyGeometry(o.geometry, ratio);
    if (g !== o.geometry) {
      saved += (o.geometry.index.count - g.index.count) / 3;
      o.geometry = g;
    }
  });
  if (saved < 2000) return root;
  const lod = new THREE.LOD();
  lod.addLevel(root, 0);
  lod.addLevel(low, distance);
  return lod;
}

export function computeModelBVH(root) {
  root.traverse((o) => {
    if (o.isMesh && !o.geometry.boundsTree) o.geometry.computeBoundsTree();
  });
}
