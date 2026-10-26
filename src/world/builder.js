import * as THREE from 'three';
import { addCollider, addDynamicCollider, addSurface } from '../systems/physics.js';
import { animate, approach, makeInteractive, requestShadowUpdate } from '../systems/interaction-registry.js';

// Geometry helpers for architecture. Everything is specified by extents
// (x0..x1, y0..y1, z0..z1) in the parent's space, and every box gets
// world-space UVs so textures keep real-world scale and run continuously
// across neighbouring pieces (e.g. the parts of a wall around a window).

function applyBoxUV(geo, cx, cy, cz, tile, rotate) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const y = pos.getY(i) + cy;
    const z = pos.getZ(i) + cz;
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    let u, v;
    if (ax > 0.5) { u = z; v = y; }
    else if (ay > 0.5) { u = x; v = z; }
    else { u = x; v = y; }
    if (rotate) [u, v] = [v, u];
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

/**
 * Axis-aligned box from extents.
 * opts: solid (physics tag) · cast · receive · rotateUV · name · noAO
 */
export function box(parent, mat, x0, x1, y0, y1, z0, z1, opts = {}) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  if (w <= 1e-4 || h <= 1e-4 || d <= 1e-4) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const geo = new THREE.BoxGeometry(w, h, d);
  // mat may be an array in BoxGeometry face order: +x, -x, +y (top), -y (bottom), +z, -z
  const tile = (Array.isArray(mat) ? mat[0] : mat).userData?.tile || 1;
  applyBoxUV(geo, cx, cy, cz, tile, opts.rotateUV);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  if (opts.name) mesh.name = opts.name;
  if (opts.noAO) mesh.userData.noAO = true;
  parent.add(mesh);
  if (opts.solid) addCollider(x0, x1, y0, y1, z0, z1, opts.solid);
  return mesh;
}

/**
 * A wall with rectangular openings.
 * axis 'x': runs along X between a0..a1, thickness spans c0..c1 on Z.
 * axis 'z': runs along Z between a0..a1, thickness spans c0..c1 on X.
 * openings: [{ a0, a1, y0, y1 }]
 */
export function wall(parent, mat, axis, a0, a1, c0, c1, y0, y1, openings = [], opts = {}) {
  const piece = (p0, p1, q0, q1) => (axis === 'x'
    ? box(parent, mat, p0, p1, q0, q1, c0, c1, opts)
    : box(parent, mat, c0, c1, q0, q1, p0, p1, opts));
  const ops = [...openings].sort((a, b) => a.a0 - b.a0);
  let cursor = a0;
  for (const op of ops) {
    piece(cursor, op.a0, y0, y1);
    piece(op.a0, op.a1, y0, op.y0);
    piece(op.a0, op.a1, op.y1, y1);
    cursor = op.a1;
  }
  piece(cursor, a1, y0, y1);
}

/** A horizontal slab with rectangular holes, split into a grid of boxes. */
export function slab(parent, mat, x0, x1, z0, z1, y0, y1, holes = [], opts = {}) {
  const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h.x0, h.x1])])].filter((v) => v >= x0 && v <= x1).sort((a, b) => a - b);
  const zs = [...new Set([z0, z1, ...holes.flatMap((h) => [h.z0, h.z1])])].filter((v) => v >= z0 && v <= z1).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
      box(parent, mat, xs[i], xs[i + 1], y0, y1, zs[j], zs[j + 1], opts);
      if (opts.walk) addSurface(xs[i], xs[i + 1], zs[j], zs[j + 1], opts.walkY ?? y1, opts.walk);
    }
  }
}

/** A flat finish layer (floor tiles, decking...) that is also walkable. */
export function floor(parent, mat, x0, x1, z0, z1, y, walkTag, thickness = 0.012) {
  const m = box(parent, mat, x0, x1, y - thickness, y, z0, z1, { cast: false });
  if (walkTag) addSurface(x0, x1, z0, z1, y, walkTag);
  return m;
}

// Helper so window/door code can be written once for both wall directions.
function along(axis, a0, a1, y0, y1, c0, c1) {
  return axis === 'x' ? [a0, a1, y0, y1, c0, c1] : [c0, c1, y0, y1, a0, a1];
}

/**
 * Aluminium window with glass, mullions and an outside sill.
 * outward: +1 if the outside of the wall is on the +c side.
 */
export function windowUnit(parent, m, axis, { a0, a1, y0, y1, c0, c1, panes = 2, outward = 1, sill = true }) {
  const f = 0.05;               // frame profile
  const depth = 0.07;
  const mid = outward > 0 ? c1 - 0.06 : c0 + 0.06; // frames sit near the outer face
  const fc0 = mid - depth / 2, fc1 = mid + depth / 2;
  const B = (p0, p1, q0, q1, k0, k1, mat, o) => box(parent, mat, ...along(axis, p0, p1, q0, q1, k0, k1), o);

  B(a0, a1, y0, y0 + f, fc0, fc1, m.aluminium);
  B(a0, a1, y1 - f, y1, fc0, fc1, m.aluminium);
  B(a0, a0 + f, y0, y1, fc0, fc1, m.aluminium);
  B(a1 - f, a1, y0, y1, fc0, fc1, m.aluminium);
  const step = (a1 - a0) / panes;
  for (let i = 1; i < panes; i++) {
    const a = a0 + step * i;
    B(a - f / 2, a + f / 2, y0, y1, fc0, fc1, m.aluminium);
  }
  B(a0 + f, a1 - f, y0 + f, y1 - f, mid - 0.006, mid + 0.006, m.glass, { cast: false, receive: false, noAO: true });
  if (sill) {
    const s0 = outward > 0 ? c1 - 0.02 : c0 - 0.08;
    const s1 = outward > 0 ? c1 + 0.08 : c0 + 0.02;
    B(a0 - 0.05, a1 + 0.05, y0 - 0.04, y0, s0, s1, m.granite);
  }
}

/**
 * Hinged door with frame, leaf and lever handle. Click to open/close.
 * hinge:   'a0' | 'a1' (which jamb carries the hinges)
 * opensTo: +1 / -1, the side of the wall (along the thickness axis) the leaf swings into
 */
export function doorUnit(parent, m, axis, { a0, a1, y0, y1, c0, c1, hinge = 'a0', opensTo = 1, leafMat, label = 'Door', open = false }) {
  const t = 0.04;
  const mid = (c0 + c1) / 2;
  const B = (p0, p1, q0, q1, k0, k1, mat, o) => box(parent, mat, ...along(axis, p0, p1, q0, q1, k0, k1), o);

  // architrave on both faces
  const arch = 0.07;
  for (const [k0, k1] of [[c0 - 0.015, c0], [c1, c1 + 0.015]]) {
    B(a0 - arch, a0, y0, y1 + arch, k0, k1, m.woodInterior);
    B(a1, a1 + arch, y0, y1 + arch, k0, k1, m.woodInterior);
    B(a0 - arch, a1 + arch, y1, y1 + arch, k0, k1, m.woodInterior);
  }

  const width = a1 - a0 - 0.01;
  const pivot = new THREE.Group();
  const hingeA = hinge === 'a0' ? a0 + 0.005 : a1 - 0.005;
  if (axis === 'x') pivot.position.set(hingeA, 0, mid);
  else pivot.position.set(mid, 0, hingeA);
  parent.add(pivot);

  // leaf in pivot space: runs from 0 to dir*width along the wall axis
  const dir = hinge === 'a0' ? 1 : -1;
  const l0 = Math.min(0, dir * width), l1 = Math.max(0, dir * width);
  const leaf = axis === 'x'
    ? box(pivot, leafMat || m.woodInterior, l0, l1, y0 + 0.01, y1 - 0.005, -t / 2, t / 2, { rotateUV: false })
    : box(pivot, leafMat || m.woodInterior, -t / 2, t / 2, y0 + 0.01, y1 - 0.005, l0, l1);

  // lever handles on both faces, pointing back towards the hinge
  const hA = dir * (width - 0.07);
  const p0 = Math.min(hA, hA - dir * 0.13), p1 = Math.max(hA, hA - dir * 0.13);
  const hy = y0 + 1.0;
  for (const s of [-1, 1]) {
    const k0 = Math.min(s * t / 2, s * (t / 2 + 0.05)), k1 = Math.max(s * t / 2, s * (t / 2 + 0.05));
    const lever = axis === 'x'
      ? box(pivot, m.steelInterior || m.steel, p0, p1, hy - 0.012, hy + 0.012, k0, k1)
      : box(pivot, m.steelInterior || m.steel, k0, k1, hy - 0.012, hy + 0.012, p0, p1);
    lever.castShadow = false;
  }

  // rotation.y > 0 turns +x towards -z and +z towards +x
  const swing = axis === 'x' ? -dir * opensTo : dir * opensTo;
  const state = { open, angle: open ? swing * 1.5 : 0 };
  pivot.rotation.y = state.angle;
  addDynamicCollider(pivot);
  makeInteractive(pivot, {
    label: () => `${state.open ? 'Close' : 'Open'} ${label.toLowerCase()}`,
    onClick: () => { state.open = !state.open; },
  });
  animate((dt) => {
    const target = state.open ? swing * 1.5 : 0;
    const next = approach(state.angle, target, 5, dt);
    if (Math.abs(next - state.angle) > 1e-5) requestShadowUpdate();
    state.angle = next;
    pivot.rotation.y = state.angle;
  });
  return { pivot, leaf, state };
}

const UP = new THREE.Vector3(0, 1, 0);

/** Round bar between two points (handrails, pipes). */
export function rod(parent, mat, a, b, r, segments = 12) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segments), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Sliding element (gate, glass door): moves `object` between closed and open offsets. */
export function slider(object, { axis = 'x', distance, label, rate = 2.5, open = false }) {
  const base = object.position[axis];
  const state = { open, t: open ? 1 : 0 };
  addDynamicCollider(object);
  makeInteractive(object, {
    label: () => `${state.open ? 'Close' : 'Open'} ${label.toLowerCase()}`,
    onClick: () => { state.open = !state.open; },
  });
  animate((dt) => {
    const next = approach(state.t, state.open ? 1 : 0, rate, dt);
    if (Math.abs(next - state.t) > 1e-5) requestShadowUpdate();
    state.t = next;
    object.position[axis] = base + distance * state.t;
  });
  return state;
}
