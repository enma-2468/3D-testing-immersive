import * as THREE from 'three';
import { assetUrl, gltfLoader } from './loaders.js';
import { addColliderFromObject } from '../systems/physics.js';
import { computeModelBVH, simplifierReady, withLOD } from '../systems/optimize.js';
import { invalidate } from '../systems/interaction-registry.js';
import { registerInterior } from './materials.js';

// Scanned Poly Haven models (CC0). Each model is fetched once and cloned;
// clones share geometry and materials. Dense scans get a simplified LOD that
// only kicks in at a distance where the difference can't be seen.

const cache = new Map();

// metres from the camera beyond which the simplified mesh is used
const LOD_DISTANCE = {
  potted_plant_02: 6,
  potted_plant_04: 4,
  street_lamp_01: 14,
};
const DEFAULT_LOD_DISTANCE = 7;

function load(id) {
  if (!cache.has(id)) {
    cache.set(id, Promise.all([gltfLoader.loadAsync(assetUrl(`models/${id}/${id}.gltf`)), simplifierReady]).then(([gltf]) => {
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (mat.alphaTest > 0 || mat.transparent) o.userData.noAO = true;
          if (mat.map) mat.map.anisotropy = 8;
        }
      });
      computeModelBVH(gltf.scene);
      return gltf.scene;
    }));
  }
  return cache.get(id);
}

/**
 * Place a model. Returns a group right away; the model streams into it.
 * @param {string} id            Poly Haven asset id
 * @param {object} o
 * @param {THREE.Object3D} o.parent
 * @param {number[]} o.at         [x, y, z]
 * @param {number} [o.rotY]
 * @param {number} [o.scale]
 * @param {string} [o.only]       keep only nodes whose name contains this
 * @param {boolean} [o.center]    re-centre the kept nodes on the origin (x/z)
 * @param {string|false} [o.collider] physics tag, or false for no collider
 * @param {number} [o.envMapIntensity]
 * @param {(root: THREE.Object3D) => void} [o.onLoad]
 */
export function placeModel(id, o) {
  const holder = new THREE.Group();
  holder.name = id;
  holder.position.fromArray(o.at);
  holder.rotation.y = o.rotY || 0;
  holder.scale.setScalar(o.scale || 1);
  o.parent.add(holder);

  load(id).then((scene) => {
    let root = scene.clone(true);
    if (o.only) {
      for (const child of [...root.children]) {
        if (!child.name.includes(o.only)) root.remove(child);
      }
      if (o.center) {
        for (const child of root.children) { child.position.x = 0; child.position.z = 0; }
      }
    }
    if (o.envMapIntensity !== undefined) {
      root.traverse((n) => {
        if (!n.isMesh) return;
        n.material = n.material.clone();
        n.material.envMapIntensity = o.envMapIntensity;
        registerInterior(n.material); // furniture placed indoors uses the room ambient
      });
    }
    root = withLOD(root, LOD_DISTANCE[id] ?? DEFAULT_LOD_DISTANCE);
    holder.add(root);
    if (o.collider) addColliderFromObject(holder, o.collider, 0.05);
    o.onLoad?.(root);
    invalidate();
  }).catch((err) => console.error(`Model ${id} failed to load`, err));

  return holder;
}
