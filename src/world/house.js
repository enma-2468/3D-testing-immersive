import * as THREE from 'three';
import { B, DOOR_H, IN, LVL, PART, ROOMS, SLAB, STAIR } from '../config.js';
import { box, doorUnit, floor, rod, slab, slider, wall, windowUnit } from './builder.js';
import { addCollider, addSurface } from '../systems/physics.js';
import { makeInteractive } from '../systems/interaction-registry.js';

const G = LVL.ground;
const F = LVL.first;
const R = LVL.roof;
const G_TOP = F - SLAB;      // underside of the first floor slab
const F_TOP = R - SLAB;      // underside of the roof slab
const FRONT = 6.0;           // front face of the white balcony frame
const MARBLE_Z = B.z1 + 0.25; // front face of the marble block
const MUMTY_TOP = R + 2.6;   // stair cabin on the roof

const STAIR_HOLE = { x0: IN.x0, x1: STAIR.x1, z0: STAIR.zFoot, z1: STAIR.zFront };

function partition(g, m, axis, a0, a1, c, y0, y1, openings, tag) {
  wall(g, m.plasterInterior, axis, a0, a1, c - PART / 2, c + PART / 2, y0, y1, openings, { solid: tag });
}

// Material per box face (+x, -x, +y, -y, +z, -z): the face that looks into
// the house gets interior paint, every other face the exterior finish.
function extWall(m, inward) {
  const faces = { '+x': 0, '-x': 1, '+z': 4, '-z': 5 };
  const mats = Array(6).fill(m.plaster);
  mats[faces[inward]] = m.plasterInterior;
  return mats;
}

function threshold(g, m, x0, x1, z0, z1, y) {
  box(g, m.granite, x0, x1, y - 0.014, y + 0.004, z0, z1, { cast: false });
}

export function buildHouse(m) {
  const root = new THREE.Group();
  root.name = 'house';
  const levels = { ground: new THREE.Group(), first: new THREE.Group(), roof: new THREE.Group() };
  for (const [name, g] of Object.entries(levels)) {
    g.name = name;
    root.add(g);
  }
  // Structural slabs: white plaster everywhere except a granite top (seen at door thresholds)
  m.slab = [m.ceiling, m.ceiling, m.granite, m.ceiling, m.ceiling, m.ceiling];

  buildGroundFloor(m, levels.ground);
  buildFirstFloor(m, levels.first);
  buildRoof(m, levels.roof);
  buildStairs(m, levels);
  const lights = {
    facade: buildFacadeLights(m, levels),
    rooms: buildRoomLights(m, levels),
  };
  return { root, levels, lights };
}

// -----------------------------------------------------------------------------
// Ground floor
// -----------------------------------------------------------------------------
function buildGroundFloor(m, g) {
  const tag = 'ground';

  // Plinth (raised 450 mm above the yard) and finishes
  box(g, m.granite, B.x0, B.x1, 0, G - 0.014, B.z0, B.z1);
  addSurface(B.x0, B.x1, B.z0, B.z1, G, tag);
  floor(g, m.floorMarble, -0.54, IN.x1, -3.84, IN.z1, G);
  floor(g, m.floorMarble, -1.69, -0.54, -3.84, 0.54, G);
  floor(g, m.floorMarble, IN.x0, STAIR.x1, -3.84, 0.54, G);
  floor(g, m.laminate, IN.x0, -0.66, 0.66, IN.z1, G);
  floor(g, m.floorMarble, 0.26, IN.x1, IN.z0, -3.96, G);
  floor(g, m.laminate, -2.69, 0.14, IN.z0, -3.96, G);
  floor(g, m.laminate, IN.x0, -2.69, -5.84, -3.96, G);
  floor(g, m.floorMarble, IN.x0, -2.81, IN.z0, -5.96, G);

  const y0 = G - 0.014;
  // --- external walls ---------------------------------------------------------
  const frontOps = [
    { a0: -3.4, a1: -1.6, y0: G + 0.75, y1: G + 2.25 }, // bedroom 1
    { a0: -0.4, a1: 1.9, y0: G + 0.45, y1: G + 2.25 },  // living
    { a0: 2.75, a1: 3.75, y0: G, y1: G + 2.4 },          // main door
  ];
  wall(g, extWall(m, '-z'), 'x', B.x0, B.x1, IN.z1, B.z1, y0, G_TOP, frontOps, { solid: tag });
  windowUnit(g, m, 'x', { ...frontOps[0], c0: IN.z1, c1: B.z1, panes: 3, outward: 1 });
  windowUnit(g, m, 'x', { ...frontOps[1], c0: IN.z1, c1: B.z1, panes: 3, outward: 1 });

  const rearOps = [
    { a0: -2.4, a1: -0.9, y0: G + 0.75, y1: G + 2.25 },
    { a0: -3.9, a1: -3.3, y0: G + 1.8, y1: G + 2.3 },
    { a0: 1.6, a1: 3.4, y0: G + 1.1, y1: G + 2.25 },
  ];
  wall(g, extWall(m, '+z'), 'x', B.x0, B.x1, B.z0, IN.z0, y0, G_TOP, rearOps, { solid: tag });
  rearOps.forEach((o, i) => windowUnit(g, m, 'x', { ...o, c0: B.z0, c1: IN.z0, panes: i === 1 ? 1 : 2, outward: -1 }));

  const leftOps = [
    { a0: -5.5, a1: -4.4, y0: G + 0.75, y1: G + 2.25 },
  ];
  wall(g, extWall(m, '+x'), 'z', B.z0, B.z1, B.x0, IN.x0, y0, G_TOP, leftOps, { solid: tag });
  leftOps.forEach((o) => windowUnit(g, m, 'z', { ...o, c0: B.x0, c1: IN.x0, outward: -1 }));

  const rightOps = [
    { a0: 1.7, a1: 3.4, y0: G + 0.75, y1: G + 2.25 },
    { a0: -2.5, a1: -0.9, y0: G + 0.75, y1: G + 2.25 },
  ];
  wall(g, extWall(m, '-x'), 'z', B.z0, B.z1, IN.x1, B.x1, y0, G_TOP, rightOps, { solid: tag });
  rightOps.forEach((o) => windowUnit(g, m, 'z', { ...o, c0: IN.x1, c1: B.x1, outward: 1 }));

  // --- main entrance ------------------------------------------------------------
  threshold(g, m, 2.75, 3.75, IN.z1, B.z1, G);
  doorUnit(g, m, 'x', { a0: 2.75, a1: 3.75, y0: G, y1: G + 2.4, c0: IN.z1, c1: B.z1, hinge: 'a1', opensTo: -1, leafMat: m.wood, label: 'Main door' });

  // --- front cladding -------------------------------------------------------------
  wall(g, m.stone, 'x', B.x0, -0.6, B.z1, B.z1 + 0.03, G - 0.014, G_TOP, [frontOps[0]]);
  box(g, m.aluminium, 1.96, 2.68, G, G_TOP, B.z1, B.z1 + 0.012);
  for (let x = 1.99; x < 2.66; x += 0.075) box(g, m.wood, x, x + 0.045, G, G_TOP, B.z1 + 0.012, B.z1 + 0.07);

  // --- partitions -----------------------------------------------------------------
  const dh = G + DOOR_H;
  partition(g, m, 'x', IN.x0, -0.54, 0.6, G, G_TOP, [], tag);
  partition(g, m, 'z', 0.66, IN.z1, -0.6, G, G_TOP, [{ a0: 0.85, a1: 1.75, y0: G, y1: dh }], tag);
  partition(g, m, 'z', -3.84, 0.54, STAIR.wall, G, G_TOP, [{ a0: -3.72, a1: -2.86, y0: G, y1: dh }], tag);
  partition(g, m, 'x', IN.x0, IN.x1, -3.9, G, G_TOP, [
    { a0: -1.45, a1: -0.6, y0: G, y1: dh },
    { a0: 1.0, a1: 2.6, y0: G, y1: G + 2.4 },
  ], tag);
  partition(g, m, 'z', IN.z0, -3.96, 0.2, G, G_TOP, [], tag);
  partition(g, m, 'z', IN.z0, -5.96, -2.75, G, G_TOP, [], tag);
  partition(g, m, 'x', IN.x0, -2.69, -5.9, G, G_TOP, [{ a0: -3.65, a1: -2.95, y0: G, y1: dh }], tag);
  box(g, m.tilesWall, IN.x0, -2.81, G, G + 2.1, IN.z0, IN.z0 + 0.01, { cast: false }); // toilet dado

  doorUnit(g, m, 'z', { a0: 0.85, a1: 1.75, y0: G, y1: dh, c0: -0.66, c1: -0.54, hinge: 'a0', opensTo: -1, label: 'Bedroom door' });
  doorUnit(g, m, 'x', { a0: -1.45, a1: -0.6, y0: G, y1: dh, c0: -3.96, c1: -3.84, hinge: 'a1', opensTo: -1, label: 'Bedroom door' });
  doorUnit(g, m, 'x', { a0: -3.65, a1: -2.95, y0: G, y1: dh, c0: -5.96, c1: -5.84, hinge: 'a0', opensTo: 1, label: 'Toilet door', leafMat: m.lacquer });

  // --- porch, steps, planter, stone pillar ------------------------------------------
  box(g, m.granite, -1.2, 3.95, 0, G, B.z1, 5.4);
  addSurface(-1.2, 3.95, B.z1, 5.4, G, tag);
  box(g, m.granite, 2.4, 3.95, 0, 0.3, 5.4, 5.7);
  addSurface(2.4, 3.95, 5.4, 5.7, 0.3, tag);
  box(g, m.granite, 2.4, 3.95, 0, 0.15, 5.7, 6.0);
  addSurface(2.4, 3.95, 5.7, 6.0, 0.15, tag);
  // planter in front of the living window
  box(g, m.granite, -1.2, 2.4, 0, G, 5.4, 5.48, { solid: tag });
  box(g, m.granite, -1.2, 2.4, 0, G, 5.92, 6.0, { solid: tag });
  box(g, m.granite, -1.2, -1.12, 0, G, 5.48, 5.92, { solid: tag });
  box(g, m.granite, 2.32, 2.4, 0, G, 5.48, 5.92, { solid: tag });
  box(g, m.soil, -1.12, 2.32, 0, G - 0.06, 5.48, 5.92, { cast: false });
  // stone-clad pillar under the frame
  box(g, m.stone, 3.95, B.x1, 0, 3.45, B.z1, FRONT, { solid: tag });
}

// -----------------------------------------------------------------------------
// First floor
// -----------------------------------------------------------------------------
function buildFirstFloor(m, g) {
  const tag = 'first';

  slab(g, m.slab, B.x0, B.x1, B.z0, B.z1, G_TOP, F - 0.014, [STAIR_HOLE], { walk: tag, walkY: F });
  floor(g, m.floorMarble, -1.14, IN.x1, -3.84, IN.z1, F);
  floor(g, m.floorMarble, -1.69, -1.14, -3.84, 0.54, F);
  floor(g, m.floorMarble, IN.x0, STAIR.x1, -3.84, STAIR.zFoot, F);
  floor(g, m.laminate, IN.x0, -1.26, 0.66, IN.z1, F);
  floor(g, m.laminate, -2.69, 0.14, IN.z0, -3.96, F);
  floor(g, m.laminate, IN.x0, -2.69, -5.84, -3.96, F);
  floor(g, m.laminate, 0.26, IN.x1, IN.z0, -3.96, F);
  floor(g, m.floorMarble, IN.x0, -2.81, IN.z0, -5.96, F);

  const y0 = F - 0.014;
  // --- external walls -----------------------------------------------------------
  const frontOps = [
    { a0: -3.3, a1: -2.1, y0: F + 0.6, y1: F + 2.6 }, // bedroom 3 (tall window through the marble)
    { a0: -0.1, a1: 3.0, y0: F, y1: F + 2.5 },        // sliding doors to the balcony
  ];
  wall(g, extWall(m, '-z'), 'x', B.x0, B.x1, IN.z1, B.z1, y0, F_TOP, frontOps, { solid: tag });
  windowUnit(g, m, 'x', { ...frontOps[0], c0: IN.z1, c1: B.z1, panes: 1, outward: 1, sill: false });

  const rearOps = [
    { a0: -2.4, a1: -0.9, y0: F + 0.75, y1: F + 2.25 },
    { a0: -3.9, a1: -3.3, y0: F + 1.8, y1: F + 2.3 },
    { a0: 1.4, a1: 3.0, y0: F + 0.75, y1: F + 2.25 },
  ];
  wall(g, extWall(m, '+z'), 'x', B.x0, B.x1, B.z0, IN.z0, y0, F_TOP, rearOps, { solid: tag });
  rearOps.forEach((o, i) => windowUnit(g, m, 'x', { ...o, c0: B.z0, c1: IN.z0, panes: i === 1 ? 1 : 2, outward: -1 }));

  const leftOps = [
    { a0: -5.5, a1: -4.4, y0: F + 0.75, y1: F + 2.25 },
  ];
  wall(g, extWall(m, '+x'), 'z', B.z0, B.z1, B.x0, IN.x0, y0, F_TOP, leftOps, { solid: tag });
  leftOps.forEach((o) => windowUnit(g, m, 'z', { ...o, c0: B.x0, c1: IN.x0, panes: 1, outward: -1 }));

  const rightOps = [
    { a0: 1.7, a1: 3.4, y0: F + 0.75, y1: F + 2.25 },
    { a0: -2.5, a1: -0.9, y0: F + 0.75, y1: F + 2.25 },
    { a0: -6.4, a1: -5.1, y0: F + 0.75, y1: F + 2.25 },
  ];
  wall(g, extWall(m, '-x'), 'z', B.z0, B.z1, IN.x1, B.x1, y0, F_TOP, rightOps, { solid: tag });
  rightOps.forEach((o) => windowUnit(g, m, 'z', { ...o, c0: IN.x1, c1: B.x1, outward: 1 }));

  // --- marble block, slats, stone -------------------------------------------------
  wall(g, m.marbleFacade, 'x', B.x0, -1.2, B.z1, MARBLE_Z, G_TOP, F_TOP, [frontOps[0]], { solid: tag });
  box(g, m.marbleFacade, B.x0 - 0.03, B.x0, G_TOP, F_TOP, 2.6, MARBLE_Z);
  box(g, m.aluminium, -1.2, -0.1, F, F_TOP, B.z1, B.z1 + 0.012);
  for (let x = -1.17; x < -0.14; x += 0.075) box(g, m.wood, x, x + 0.045, F, F_TOP, B.z1 + 0.012, B.z1 + 0.07);
  box(g, m.stone, 3.0, 3.95, F, F_TOP, B.z1, B.z1 + 0.03);

  // --- sliding glass doors ----------------------------------------------------------
  threshold(g, m, -0.1, 3.0, IN.z1, B.z1, F);
  const panel = (a0, a1, c) => {
    const p = new THREE.Group();
    const f = 0.06;
    const h = F + 2.5;
    box(p, m.aluminium, a0, a1, F, F + f, c - 0.025, c + 0.025);
    box(p, m.aluminium, a0, a1, h - f, h, c - 0.025, c + 0.025);
    box(p, m.aluminium, a0, a0 + f, F, h, c - 0.025, c + 0.025);
    box(p, m.aluminium, a1 - f, a1, F, h, c - 0.025, c + 0.025);
    box(p, m.glass, a0 + f, a1 - f, F + f, h - f, c - 0.005, c + 0.005, { cast: false, receive: false, noAO: true });
    box(p, m.steel, a1 - 0.14, a1 - 0.12, F + 0.8, F + 1.6, c + 0.025, c + 0.045); // pull bar
    g.add(p);
    return p;
  };
  const fixedPanel = panel(-0.1, 1.5, IN.z1 + 0.08);
  addCollider(-0.1, 1.5, F, F + 2.5, IN.z1 + 0.05, IN.z1 + 0.11, tag);
  void fixedPanel;
  const moving = panel(1.4, 3.0, B.z1 - 0.06);
  slider(moving, { axis: 'x', distance: -1.45, label: 'Sliding door', rate: 3 });

  // --- partitions ---------------------------------------------------------------------
  const dh = F + DOOR_H;
  partition(g, m, 'x', IN.x0, -1.14, 0.6, F, F_TOP, [], tag);
  partition(g, m, 'z', 0.66, IN.z1, -1.2, F, F_TOP, [{ a0: 0.85, a1: 1.75, y0: F, y1: dh }], tag);
  partition(g, m, 'z', -3.84, 0.54, STAIR.wall, F, F_TOP, [{ a0: -3.72, a1: -2.86, y0: F, y1: dh }], tag);
  partition(g, m, 'x', IN.x0, IN.x1, -3.9, F, F_TOP, [
    { a0: -1.45, a1: -0.6, y0: F, y1: dh },
    { a0: 0.9, a1: 1.75, y0: F, y1: dh },
  ], tag);
  partition(g, m, 'z', IN.z0, -3.96, 0.2, F, F_TOP, [], tag);
  partition(g, m, 'z', IN.z0, -5.96, -2.75, F, F_TOP, [], tag);
  partition(g, m, 'x', IN.x0, -2.69, -5.9, F, F_TOP, [{ a0: -3.65, a1: -2.95, y0: F, y1: dh }], tag);
  box(g, m.tilesWall, IN.x0, -2.81, F, F + 2.1, IN.z0, IN.z0 + 0.01, { cast: false });

  doorUnit(g, m, 'z', { a0: 0.85, a1: 1.75, y0: F, y1: dh, c0: -1.26, c1: -1.14, hinge: 'a0', opensTo: -1, label: 'Bedroom door' });
  doorUnit(g, m, 'x', { a0: -1.45, a1: -0.6, y0: F, y1: dh, c0: -3.96, c1: -3.84, hinge: 'a1', opensTo: -1, label: 'Bedroom door' });
  doorUnit(g, m, 'x', { a0: 0.9, a1: 1.75, y0: F, y1: dh, c0: -3.96, c1: -3.84, hinge: 'a0', opensTo: -1, label: 'Bedroom door' });
  doorUnit(g, m, 'x', { a0: -3.65, a1: -2.95, y0: F, y1: dh, c0: -5.96, c1: -5.84, hinge: 'a0', opensTo: 1, label: 'Toilet door', leafMat: m.lacquer });

  // --- balcony & white frame ---------------------------------------------------------------
  box(g, m.plaster, -1.2, 3.95, 3.45, F - 0.014, B.z1, FRONT);
  floor(g, m.paving, -1.2, 3.95, B.z1, FRONT - 0.04, F, tag);
  box(g, m.wood, -1.2, 3.95, 3.43, 3.45, B.z1, FRONT - 0.02, { cast: false }); // porch soffit
  box(g, m.plaster, 3.95, B.x1, 3.45, 6.75, B.z1, FRONT, { solid: tag });     // right leg of the frame

  // frameless glass balustrade with a steel cap
  const railTop = F + 1.05;
  box(g, m.glassRailing, -1.15, 3.95, F, railTop, FRONT - 0.12, FRONT - 0.1, { cast: false, noAO: true, solid: tag });
  box(g, m.glassRailing, -1.2, -1.18, F, railTop, MARBLE_Z, FRONT - 0.1, { cast: false, noAO: true, solid: tag });
  box(g, m.steel, -1.2, 3.95, railTop, railTop + 0.03, FRONT - 0.13, FRONT - 0.09);
  box(g, m.steel, -1.21, -1.17, railTop, railTop + 0.03, MARBLE_Z, FRONT - 0.09);
}

// -----------------------------------------------------------------------------
// Roof: slab, parapets, frame top, marble fin, stair cabin, pergola, tank
// -----------------------------------------------------------------------------
function buildRoof(m, g) {
  const tag = 'roof';

  slab(g, m.slab, B.x0, B.x1, B.z0, B.z1, F_TOP, R - 0.014, [STAIR_HOLE]);
  slab(g, m.paving, B.x0, B.x1, B.z0, B.z1, R - 0.014, R, [STAIR_HOLE], { walk: tag, cast: false });

  // frame top over the balcony, with a teak soffit
  box(g, m.plaster, -1.2, B.x1, 6.75, R - 0.014, B.z1, FRONT);
  floor(g, m.paving, -1.2, B.x1, B.z1, FRONT, R, tag);
  box(g, m.wood, -1.2, 3.95, 6.73, 6.75, B.z1, FRONT - 0.02, { cast: false });

  // marble fin continues above the roof
  wall(g, m.marbleFacade, 'x', B.x0, -1.2, B.z1, MARBLE_Z, F_TOP, R + 1.2, [], { solid: tag });
  box(g, m.marbleFacade, B.x0 - 0.03, B.x0, F_TOP, R + 1.2, 2.6, MARBLE_Z);
  box(g, m.granite, B.x0 - 0.04, -1.18, R + 1.2, R + 1.24, B.z1 - 0.02, MARBLE_Z + 0.02);

  // parapets with granite coping
  const pH = R + 1.0;
  const parapet = (x0, x1, z0, z1) => {
    box(g, m.plaster, x0, x1, R - 0.014, pH, z0, z1, { solid: tag });
    box(g, m.granite, x0 - 0.02, x1 + 0.02, pH, pH + 0.04, z0 - 0.02, z1 + 0.02);
  };
  parapet(B.x0, B.x0 + 0.15, B.z0, -4.0);
  parapet(B.x0, B.x0 + 0.15, 0.7, B.z1);
  parapet(B.x0, B.x1, B.z0, B.z0 + 0.15);
  parapet(B.x1 - 0.15, B.x1, B.z0, FRONT);

  const railTop = R + 1.05;
  box(g, m.glassRailing, -1.15, B.x1 - 0.15, R, railTop, FRONT - 0.12, FRONT - 0.1, { cast: false, noAO: true, solid: tag });
  box(g, m.glassRailing, -1.2, -1.18, R, railTop, MARBLE_Z, FRONT - 0.1, { cast: false, noAO: true, solid: tag });
  box(g, m.steel, -1.2, B.x1 - 0.15, railTop, railTop + 0.03, FRONT - 0.13, FRONT - 0.09);

  // stair cabin ("mumty")
  const zB = -4.0, zF = 0.7;
  wall(g, m.plaster, 'z', zB, zF, B.x0, IN.x0, R - 0.014, MUMTY_TOP, [], { solid: tag });
  wall(g, m.plaster, 'x', B.x0, -1.69, zB, -3.84, R - 0.014, MUMTY_TOP, [], { solid: tag });
  const winOp = { a0: -3.5, a1: -2.5, y0: R + 1.3, y1: R + 2.1 };
  wall(g, m.plaster, 'x', B.x0, -1.69, 0.54, zF, R - 0.014, MUMTY_TOP, [winOp], { solid: tag });
  windowUnit(g, m, 'x', { ...winOp, c0: 0.54, c1: zF, panes: 2, outward: 1 });
  const doorOp = { a0: -3.72, a1: -2.86, y0: R, y1: R + DOOR_H };
  wall(g, m.plaster, 'z', zB, zF, -1.81, -1.69, R - 0.014, MUMTY_TOP, [doorOp], { solid: tag });
  threshold(g, m, -1.81, -1.69, -3.72, -2.86, R);
  doorUnit(g, m, 'z', { ...doorOp, c0: -1.81, c1: -1.69, hinge: 'a0', opensTo: 1, label: 'Terrace door', leafMat: m.wood });
  box(g, m.slab, B.x0 - 0.08, -1.55, MUMTY_TOP, MUMTY_TOP + 0.15, zB - 0.15, zF + 0.15);
  box(g, m.granite, B.x0 - 0.1, -1.53, MUMTY_TOP + 0.15, MUMTY_TOP + 0.19, zB - 0.17, zF + 0.17);

  // overhead water tank (a very Indian rooftop detail)
  const tank = new THREE.Group();
  tank.position.set(-3.0, MUMTY_TOP + 0.19, -1.7);
  g.add(tank);
  const tankMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 1.15, 40), tankMat);
  body.position.y = 0.6;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 24), tankMat);
  lid.position.y = 1.23;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.58, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
  cap.scale.y = 0.18;
  cap.position.y = 1.17;
  for (const mesh of [body, lid, cap]) { mesh.castShadow = mesh.receiveShadow = true; tank.add(mesh); }
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.605 - i * 0.01, 0.018, 8, 48), tankMat);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = 0.2 + i * 0.28;
    tank.add(rib);
  }
  box(g, m.granite, -3.75, -2.25, MUMTY_TOP + 0.19, MUMTY_TOP + 0.24, -2.45, -0.95);
  rod(g, m.steel, new THREE.Vector3(-2.5, MUMTY_TOP + 0.4, -1.7), new THREE.Vector3(-1.5, MUMTY_TOP + 0.4, -1.7), 0.02);
  rod(g, m.steel, new THREE.Vector3(-1.5, MUMTY_TOP + 0.4, -1.7), new THREE.Vector3(-1.5, R, -1.7), 0.02);

  // pergola: dark aluminium frame with timber-look louvres
  const top = R + 2.4;
  const cols = [[-0.62, 0.9], [-0.62, 4.45], [-4.12, 0.9], [-4.12, 4.45]];
  for (const [x, z] of cols) box(g, m.aluminium, x - 0.05, x + 0.05, R, top, z - 0.05, z + 0.05, { solid: tag });
  for (const z of [0.9, 4.45]) box(g, m.aluminium, -4.25, -0.5, top - 0.22, top, z - 0.05, z + 0.05);
  box(g, m.aluminium, -4.22, -4.02, top - 0.22, top, 0.85, 4.5);
  box(g, m.aluminium, -0.72, -0.52, top - 0.22, top, 0.85, 4.5);
  for (let x = -4.0; x <= -0.7; x += 0.19) box(g, m.wood, x - 0.025, x + 0.025, top - 0.2, top + 0.02, 0.8, 4.55);
}

// -----------------------------------------------------------------------------
// Staircase: two dog-leg flights per storey, white marble treads
// -----------------------------------------------------------------------------
function buildStairs(m, levels) {
  const { xMid, x1, zFoot, zLanding, zFront, risers } = STAIR;
  const x0 = IN.x0;
  const go = STAIR.going;
  const rise = STAIR.rise;
  const half = rise * risers;
  const spineT = 0.06;
  const handrail = m.steel;

  const storeys = [
    { base: G, g: levels.ground, tag: 'ground' },
    { base: F, g: levels.first, tag: 'first' },
  ];
  for (const { base, g, tag } of storeys) {
    // flight A: right half, climbing towards the front
    for (let k = 1; k < risers; k++) {
      const z0 = zFoot + (k - 1) * go;
      const h = base + k * rise;
      box(g, m.floorMarble, xMid + spineT, x1, h - rise - 0.12, h, z0 - 0.02, z0 + go);
      addSurface(xMid + spineT, x1, z0, z0 + go, h, tag);
    }
    // landing
    const lh = base + half;
    box(g, m.floorMarble, x0, x1, lh - 0.16, lh, zLanding, zFront);
    addSurface(x0, x1, zLanding, zFront, lh, tag);
    // flight B: left half, climbing towards the back
    for (let k = 1; k < risers; k++) {
      const z1 = zLanding - (k - 1) * go;
      const h = lh + k * rise;
      box(g, m.floorMarble, x0, xMid - spineT, h - rise - 0.12, h, z1 - go, z1 + 0.02);
      addSurface(x0, xMid - spineT, z1 - go, z1, h, tag);
    }
    // spine wall between the flights + handrails on both sides
    box(g, m.plasterInterior, xMid - spineT, xMid + spineT, base, base + 2 * half, zFoot, zLanding, { solid: tag });
    const railA = xMid + spineT + 0.05;
    const railB = xMid - spineT - 0.05;
    rod(g, handrail, new THREE.Vector3(railA, base + rise + 0.9, zFoot), new THREE.Vector3(railA, lh + 0.9, zLanding), 0.022);
    rod(g, handrail, new THREE.Vector3(railB, lh + rise + 0.9, zLanding), new THREE.Vector3(railB, base + 2 * half + 0.9, zFoot), 0.022);
  }
  // closed storage under the first ground-floor flight B (keeps the walker out from under the stairs)
  box(levels.ground, m.plasterInterior, x0, xMid - spineT, G, G + 1.5, zFoot, zLanding, { solid: 'ground' });
}

// -----------------------------------------------------------------------------
// Lighting fixtures
// -----------------------------------------------------------------------------
function spot(parent, color, intensity, at, target, angle, penumbra, distance) {
  const s = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
  s.position.fromArray(at);
  s.target.position.fromArray(target);
  parent.add(s, s.target);
  s.visible = false;
  return s;
}

function buildFacadeLights(m, levels) {
  const lights = [];
  const disc = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 20);
  const warm = '#ffc98f';
  for (const x of [-0.4, 1.35, 3.1]) {
    // porch soffit downlights
    const d1 = new THREE.Mesh(disc, m.ledStrip);
    d1.position.set(x, 3.425, 5.25);
    levels.first.add(d1);
    lights.push(spot(levels.first, warm, 9, [x, 3.4, 5.25], [x, 0, 5.4], 0.65, 0.9, 8));
    // balcony soffit downlights
    const d2 = new THREE.Mesh(disc, m.ledStrip);
    d2.position.set(x, 6.725, 5.3);
    levels.roof.add(d2);
    lights.push(spot(levels.roof, warm, 9, [x, 6.7, 5.3], [x, F, 5.4], 0.65, 0.9, 8));
  }
  // up/down wall washers grazing the marble block
  for (const x of [-3.75, -1.75]) {
    const body = box(levels.first, m.aluminium, x - 0.05, x + 0.05, 5.0, 5.22, MARBLE_Z, MARBLE_Z + 0.1);
    void body;
    box(levels.first, m.ledStrip, x - 0.035, x + 0.035, 5.22, 5.225, MARBLE_Z + 0.015, MARBLE_Z + 0.085, { cast: false });
    box(levels.first, m.ledStrip, x - 0.035, x + 0.035, 4.995, 5.0, MARBLE_Z + 0.015, MARBLE_Z + 0.085, { cast: false });
    lights.push(spot(levels.first, warm, 14, [x, 5.25, MARBLE_Z + 0.08], [x, 8.3, MARBLE_Z + 0.02], 0.28, 0.6, 5));
    lights.push(spot(levels.first, warm, 14, [x, 4.97, MARBLE_Z + 0.08], [x, 3.6, MARBLE_Z + 0.02], 0.32, 0.6, 3));
  }
  return lights;
}

const FAN_ROOMS = new Set(['bed1', 'living', 'bed2', 'bed3', 'family', 'master', 'bed4']);

function buildRoomLights(m, levels) {
  const rooms = [];
  const disc = new THREE.CylinderGeometry(0.07, 0.07, 0.012, 24);
  for (const room of ROOMS) {
    if (room.outdoor || room.noLight) continue;
    const g = levels[room.level];
    const ceil = LVL[room.level] + 3.15;
    const cx = (room.x0 + room.x1) / 2;
    const cz = (room.z0 + room.z1) / 2;
    const w = room.x1 - room.x0;
    const d = room.z1 - room.z0;

    // each room gets its own emissive material so it glows independently
    const glow = m.lampWarm.clone();
    const fixtures = new THREE.Group();
    g.add(fixtures);
    const spots = room.small ? [[cx, cz]] : [
      [room.x0 + w * 0.25, room.z0 + d * 0.25], [room.x0 + w * 0.75, room.z0 + d * 0.25],
      [room.x0 + w * 0.25, room.z0 + d * 0.75], [room.x0 + w * 0.75, room.z0 + d * 0.75],
    ];
    for (const [x, z] of spots) {
      const dl = new THREE.Mesh(disc, glow);
      dl.position.set(x, ceil - 0.005, z);
      fixtures.add(dl);
    }

    let light = null;
    if (!room.small) {
      light = new THREE.PointLight('#ffd3a3', 2.2 + w * d * 0.55, Math.max(w, d) * 1.7, 2);
      light.position.set(cx, ceil - 0.45, cz);
      light.visible = false;
      g.add(light);
    }
    const entry = { room, light, glow, on: false, fan: FAN_ROOMS.has(room.id), center: [cx, ceil, cz] };
    makeInteractive(fixtures, {
      label: () => `${room.name}: lights ${entry.on ? 'off' : 'on'}`,
      onClick: () => { entry.on = !entry.on; entry.dirty = true; },
    });
    rooms.push(entry);
  }
  return rooms;
}
