// Shared registry used by world builders to mark things as clickable and to
// register per-frame animations, without importing the heavier systems.

const animators = new Set();

// Rendering is on demand: a frame is drawn only when something changed.
// The sun's shadow map is re-rendered only when something that casts shadows moves.
export const frame = { dirty: true, shadows: true };
export function invalidate() {
  frame.dirty = true;
}
export function requestShadowUpdate() {
  frame.shadows = true;
  frame.dirty = true;
}

/**
 * @param {THREE.Object3D} object
 * @param {{ label: string | (() => string), onClick: (hit?: object) => void }} info
 */
export function makeInteractive(object, info) {
  object.userData.interactive = info;
  return object;
}

export function findInteractive(object) {
  let o = object;
  while (o) {
    if (o.userData.interactive) return o;
    o = o.parent;
  }
  return null;
}

/** fn(dt, t) is called every frame until it returns false. */
export function animate(fn) {
  animators.add(fn);
}

export function runAnimators(dt, t) {
  for (const fn of animators) {
    if (fn(dt, t) === false) animators.delete(fn);
  }
}

// Critically damped approach used by every animated part
export function approach(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}
