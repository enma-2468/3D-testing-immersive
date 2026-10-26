import * as THREE from 'three';

// Very small "physics" for the walkthrough:
//  - colliders: axis-aligned boxes the player can't walk through
//  - surfaces:  horizontal rectangles the player can stand on (floors, treads)
// Everything in the house is axis-aligned, so this stays cheap and exact.

const staticColliders = [];
const dynamicColliders = []; // { object, box } recomputed every frame (doors, gate)
const surfaces = [];

const tmpBox = new THREE.Box3();

export function addCollider(x0, x1, y0, y1, z0, z1, tag) {
  staticColliders.push({ x0, x1, y0, y1, z0, z1, tag, enabled: true });
}

export function addColliderFromObject(object, tag, shrink = 0) {
  object.updateWorldMatrix(true, true);
  tmpBox.setFromObject(object);
  if (tmpBox.isEmpty()) return;
  const { min, max } = tmpBox;
  addCollider(min.x + shrink, max.x - shrink, min.y, max.y, min.z + shrink, max.z - shrink, tag);
}

export function addDynamicCollider(object) {
  dynamicColliders.push({ object, box: new THREE.Box3() });
}

export function addSurface(x0, x1, z0, z1, y, tag) {
  surfaces.push({ x0, x1, z0, z1, y, tag, enabled: true });
}

// Hide/show colliders and surfaces of a level (used by the cutaway views)
export function setTagEnabled(tag, enabled) {
  for (const c of staticColliders) if (c.tag === tag) c.enabled = enabled;
  for (const s of surfaces) if (s.tag === tag) s.enabled = enabled;
}

export function updateDynamic() {
  for (const d of dynamicColliders) {
    d.object.updateWorldMatrix(true, false);
    d.box.setFromObject(d.object);
  }
}

// Highest surface under (x, z) that is no higher than maxY. Bare ground is 0.
export function groundHeight(x, z, maxY) {
  let best = 0;
  for (const s of surfaces) {
    if (!s.enabled || x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    if (s.y <= maxY && s.y > best) best = s.y;
  }
  return best;
}

function pushOut(p, radius, x0, x1, z0, z1) {
  const cx = Math.max(x0, Math.min(p.x, x1));
  const cz = Math.max(z0, Math.min(p.z, z1));
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * radius;
    p.z = cz + (dz / d) * radius;
  } else {
    // centre is inside the box: leave by the nearest side
    const opts = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z];
    const m = Math.min(...opts);
    if (m === opts[0]) p.x = x0 - radius;
    else if (m === opts[1]) p.x = x1 + radius;
    else if (m === opts[2]) p.z = z0 - radius;
    else p.z = z1 + radius;
  }
}

// Resolve a vertical capsule (feet at p.y, given height) against all colliders.
export function collide(p, radius, height, stepHeight) {
  const yLow = p.y + stepHeight;
  const yHigh = p.y + height;
  for (let iter = 0; iter < 2; iter++) {
    for (const c of staticColliders) {
      if (!c.enabled || c.y1 <= yLow || c.y0 >= yHigh) continue;
      pushOut(p, radius, c.x0, c.x1, c.z0, c.z1);
    }
    for (const { box, object } of dynamicColliders) {
      if (!object.visible || box.max.y <= yLow || box.min.y >= yHigh) continue;
      pushOut(p, radius, box.min.x, box.max.x, box.min.z, box.max.z);
    }
  }
}
