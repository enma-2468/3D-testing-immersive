import * as THREE from 'three';
import { B, LVL, PLOT } from '../config.js';
import { box, slider } from './builder.js';
import { addCollider, addSurface } from '../systems/physics.js';
import { placeModel } from '../assets/models.js';
import { Vegetation, addModelWind } from './vegetation.js';
import { GRASS_GROUND_GLSL, LAWN_GLSL, createGrass, grassGroundUniforms } from './grass.js';

const WALL_T = 0.23;
const FRONT_IN = PLOT.z1 - WALL_T; // inner face of the front compound wall

function groundPlane(m) {
  const size = 600;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const tile = m.grass.userData.tile;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);

  // Break up texture tiling with two low-frequency samples of the same map
  // (the grass blades use the same function, so they match the ground under them)
  m.grass.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, grassGroundUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LAWN_GLSL}\n${GRASS_GROUND_GLSL}`)
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        diffuseColor.rgb *= lawnMacro(map, vMapUv) * grassShade(vMapUv);
      `);
  };
  const mesh = new THREE.Mesh(geo, m.grass);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

function compoundWall(root, m, x0, x1, z0, z1, h, tag) {
  box(root, m.plaster, x0, x1, 0, h, z0, z1, { solid: tag });
  box(root, m.granite, x0 - 0.02, x1 + 0.02, h, h + 0.05, z0 - 0.02, z1 + 0.02);
}

export function buildSite(m) {
  const root = new THREE.Group();
  root.name = 'site';
  const tag = 'site';
  const veg = new Vegetation(m);

  root.add(groundPlane(m));

  // --- inside the plot -----------------------------------------------------------
  const px0 = PLOT.x0 + WALL_T;
  const px1 = PLOT.x1 - WALL_T;
  box(root, m.paving, -1.2, px1, 0, 0.02, 6.0, FRONT_IN, { cast: false });      // driveway
  box(root, m.paving, B.x1, px1, 0, 0.02, PLOT.z0 + WALL_T, 6.0, { cast: false }); // side passage
  box(root, m.paving, px0, B.x0, 0, 0.02, PLOT.z0 + WALL_T, B.z1, { cast: false });
  box(root, m.paving, px0, px1, 0, 0.02, PLOT.z0 + WALL_T, B.z0, { cast: false });
  // garden edging + stepping stones across the lawn
  box(root, m.granite, -1.26, -1.2, 0, 0.06, B.z1, FRONT_IN, { cast: false });
  for (let i = 0; i < 4; i++) {
    const z = 5.0 + i * 0.6;
    box(root, m.paving, -2.9, -2.3, 0, 0.025, z, z + 0.4, { cast: false });
  }

  // --- compound walls & gate ----------------------------------------------------------
  const gateX0 = 0.1, gateX1 = 4.1;
  compoundWall(root, m, PLOT.x0, -0.35, FRONT_IN, PLOT.z1, 1.2, tag);
  box(root, m.stone, PLOT.x0, -0.35, 0, 1.2, PLOT.z1, PLOT.z1 + 0.02);
  for (const [x0, x1] of [[-0.35, gateX0], [gateX1, PLOT.x1]]) {
    box(root, m.stone, x0, x1, 0, 1.55, FRONT_IN - 0.05, PLOT.z1 + 0.05, { solid: tag });
    box(root, m.granite, x0 - 0.03, x1 + 0.03, 1.55, 1.6, FRONT_IN - 0.08, PLOT.z1 + 0.08);
    box(root, m.aluminium, (x0 + x1) / 2 - 0.09, (x0 + x1) / 2 + 0.09, 1.6, 1.85, PLOT.z1 - 0.2, PLOT.z1 - 0.02);
    box(root, m.ledStrip, (x0 + x1) / 2 - 0.07, (x0 + x1) / 2 + 0.07, 1.62, 1.8, PLOT.z1 - 0.025, PLOT.z1 - 0.015, { cast: false });
  }
  // house number plate
  box(root, m.steel, gateX1 + 0.08, PLOT.x1 - 0.08, 1.0, 1.25, PLOT.z1 + 0.05, PLOT.z1 + 0.06);

  for (const x of [PLOT.x0, PLOT.x1 - WALL_T]) {
    compoundWall(root, m, x, x + WALL_T, PLOT.z0, B.z1, 1.8, tag);
    compoundWall(root, m, x, x + WALL_T, B.z1, FRONT_IN, 1.2, tag);
  }
  compoundWall(root, m, PLOT.x0, PLOT.x1, PLOT.z0, PLOT.z0 + WALL_T, 1.8, tag);

  // sliding gate: black frame with horizontal teak slats; slides behind the left wall
  const gate = new THREE.Group();
  root.add(gate);
  const gz0 = FRONT_IN - 0.16, gz1 = FRONT_IN - 0.08;
  box(gate, m.aluminium, gateX0, gateX1, 0.05, 0.13, gz0, gz1);
  box(gate, m.aluminium, gateX0, gateX1, 1.37, 1.45, gz0, gz1);
  for (let x = gateX0; x <= gateX1 + 1e-3; x += (gateX1 - gateX0) / 4) {
    box(gate, m.aluminium, Math.max(gateX0, x - 0.04), Math.min(gateX1, x + 0.04), 0.05, 1.45, gz0, gz1);
  }
  for (let y = 0.17; y < 1.34; y += 0.1) box(gate, m.wood, gateX0 + 0.04, gateX1 - 0.04, y, y + 0.075, gz0 + 0.015, gz1 - 0.015);
  box(root, m.steel, -3.9, gateX1, 0, 0.015, (gz0 + gz1) / 2 - 0.015, (gz0 + gz1) / 2 + 0.015, { cast: false });
  slider(gate, { axis: 'x', distance: -(gateX1 - gateX0) + 0.05, label: 'Main gate', rate: 1.6 });

  // --- street ---------------------------------------------------------------------------
  const fp0 = PLOT.z1, fp1 = PLOT.z1 + 1.7, road0 = fp1 + 0.15, road1 = road0 + 7.0;
  box(root, m.paving, -80, 80, 0, 0.12, fp0, fp1, { cast: false });
  addSurface(-80, 80, fp0, fp1, 0.12, tag);
  box(root, m.kerb, -80, 80, 0, 0.15, fp1, road0, { cast: false });
  box(root, m.asphalt, -80, 80, 0, 0.01, road0, road1, { cast: false });
  box(root, m.kerb, -80, 80, 0, 0.15, road1, road1 + 0.15, { cast: false });
  box(root, m.paving, -80, 80, 0, 0.12, road1 + 0.15, road1 + 1.85, { cast: false });
  const mid = (road0 + road1) / 2;
  for (let x = -78; x < 80; x += 6) box(root, m.whiteLine, x, x + 3, 0.01, 0.014, mid - 0.06, mid + 0.06, { cast: false, receive: true });
  // driveway ramp across the footpath into the gate
  box(root, m.kerb, gateX0, gateX1, 0, 0.125, fp0, fp1 - 0.02, { cast: false });

  const streetLights = [];
  const lampMats = [];
  for (const x of [-7, 8]) {
    placeModel('street_lamp_01', {
      parent: root,
      at: [x, 0.12, fp1 - 0.35],
      collider: tag,
      onLoad: (model) => model.traverse((o) => {
        if (o.isMesh && /bulb|glass/.test(o.material.name)) {
          o.material = o.material.clone();
          o.material.emissive = new THREE.Color('#ffcf8f');
          o.material.emissiveIntensity = 0;
          lampMats.push(o.material);
        }
      }),
    });
    const l = new THREE.PointLight('#ffc98a', 0, 22, 2);
    l.position.set(x, 3.6, fp1 - 0.35);
    l.visible = false;
    root.add(l);
    streetLights.push(l);
  }

  // --- open lawns either side, like the reference render --------------------------------------
  compoundWall(root, m, -15.6, PLOT.x0, PLOT.z1 - 0.23, PLOT.z1, 0.9, tag);
  compoundWall(root, m, PLOT.x1, 15.2, PLOT.z1 - 0.23, PLOT.z1, 0.9, tag);

  // --- planting ------------------------------------------------------------------------------
  veg.hedge(px0 + 0.05, -1.4, 6.85, 7.3, 0.95, 11);
  veg.hedge(-1.12, 2.32, 5.48, 5.92, 0.55, 5, LVL.ground - 0.06); // porch planter
  veg.hedge(px0 + 0.05, px0 + 0.45, B.z1 + 0.3, 6.6, 0.8, 17);
  veg.tree(-3.3, 6.1, { height: 4.2, spread: 1.25, seed: 4, density: 0.9 });
  // hedges hugging the outside of the side walls
  veg.hedge(PLOT.x0 - 0.75, PLOT.x0 - 0.05, -7.5, 7.2, 1.5, 23);
  veg.hedge(PLOT.x1 + 0.05, PLOT.x1 + 0.75, -7.5, 7.2, 1.5, 29);
  // Planting like a real residential street rather than an orchard:
  // [x, z, height, spread, shape]
  const trees = [
    // street trees on this footpath (between the lamps) and the far side avenue
    [-14, 9.4, 6.5, 2.4, 'round'], [15, 9.4, 6.8, 2.5, 'round'], [-23, 9.4, 7, 2.6, 'round'], [24, 9.4, 6.2, 2.3, 'round'],
    [-30, 19.6, 8, 3, 'round'], [-20, 19.4, 7.5, 2.8, 'round'], [-11, 19.6, 8.2, 3, 'round'],
    [11, 19.5, 7.8, 2.9, 'round'], [20, 19.6, 8.4, 3.1, 'round'], [30, 19.4, 7.4, 2.7, 'round'],
    // neighbours' garden trees just behind the side walls
    [-8.6, 5.6, 6.2, 2.4, 'round'], [-9.4, -1.5, 7.6, 2.8, 'round'], [-8.4, -8.5, 6.8, 2.5, 'tall'],
    [8.8, 5.2, 6, 2.3, 'round'], [9.6, -2.5, 8, 3, 'round'], [8.6, -9.2, 6.6, 2.4, 'tall'],
    // rear boundary
    [-10.5, -13.5, 9, 3.4, 'round'], [-3.5, -13, 8, 3, 'tall'], [3.5, -13.8, 9.5, 3.5, 'round'], [11, -13, 8.5, 3.2, 'round'],
    // groves further out
    [-18, -4, 9, 3.4, 'round'], [-21, 4, 8, 3, 'round'], [-17, -16, 10, 3.8, 'round'], [-26, -11, 9, 3.3, 'tall'],
    [18, -6, 9.5, 3.5, 'round'], [22, 3, 8, 3, 'round'], [17, -17, 9, 3.4, 'tall'], [27, -11, 10, 3.6, 'round'],
  ];
  trees.forEach(([x, z, h, s, shape], i) => veg.tree(x, z, { height: h, spread: s, shape, seed: i + 20 }));
  // continuous distant tree line: its own lighter set (bigger cards, no shadow casting
  // - it is outside the shadow map anyway), since it is only ever seen far away
  const farVeg = new Vegetation(m);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + Math.sin(i * 12.9) * 0.04;
    const r = 52 + ((i * 37) % 19);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    farVeg.tree(x, z, { height: 10 + (i % 5) * 1.7, spread: 4.2 + (i % 3) * 0.7, shape: i % 5 === 0 ? 'tall' : 'round', seed: 100 + i, density: 0.55, leafScale: 2.1 });
  }
  // undergrowth, so tree trunks don't stand on bare lawn like an orchard
  const rnd = (() => { let s = 977; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  let bushSeed = 300;
  const bush = (x, z, size, o = {}) => veg.bush(x, z, { size, seed: bushSeed++, ...o });
  // shrub borders along the low front walls of the neighbouring lawns
  for (const side of [-1, 1]) {
    for (let d = 6.1; d < 14.8; d += 1.15 + rnd() * 0.9) {
      if (rnd() < 0.2) continue;
      bush(side * d, 6.85 + rnd() * 0.25, 0.75 + rnd() * 0.5);
    }
  }
  // round the feet of the garden and grove trees, on the side away from the house
  trees.forEach(([x, z, h], i) => {
    if (Math.abs(z - 9.4) < 0.5) return; // street trees stand in paved tree pits
    const away = Math.atan2(z, x) + (rnd() - 0.5) * 1.6;
    const n = 1 + (i % 3 === 0 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a = away + k * 1.9, d = 0.9 + rnd() * 0.9;
      bush(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.7 + rnd() * 0.6 + h * 0.04);
    }
  });
  // behind the far footpath, between the avenue trees
  for (let x = -33; x <= 33; x += 3 + rnd() * 2.5) bush(x, 20.6 + rnd() * 0.8, 0.9 + rnd() * 0.7);

  // front garden: gazania border along the driveway and the house, ferns in the tree's shade
  const flowers = [[-1.52, 4.86], [-1.5, 5.2], [-1.54, 5.54], [-1.5, 5.88], [-1.53, 6.22], [-1.5, 6.56], [-3.5, 4.82], [-3.15, 4.84], [-2.0, 4.82]];
  flowers.forEach(([x, z], i) => {
    placeModel('flower_gazania', {
      parent: root, at: [x, 0, z], rotY: rnd() * Math.PI * 2, only: `_${'abcdefgh'[i % 8]}_`, center: true, scale: 1.5 + rnd() * 0.3, // sized to stand above the lawn
      onLoad: (model) => addModelWind(model, { amount: 0.1, height: 0.35 }),
    });
  });
  for (const [x, z, s] of [[-3.55, 5.45, 0.7], [-2.0, 6.35, 0.62]]) {
    placeModel('fern_02', {
      parent: root, at: [x, 0, z], rotY: rnd() * Math.PI * 2, only: '_a', center: true, scale: s,
      onLoad: (model) => addModelWind(model, { amount: 0.14, height: 0.4 }),
    });
  }

  // big, cheap shrubs filling the gaps in the distant tree line
  for (let i = 0; i < 56; i++) {
    const a = ((i + 0.5) / 56) * Math.PI * 2;
    const r = 47 + ((i * 29) % 11);
    farVeg.bush(Math.cos(a) * r, Math.sin(a) * r, { size: 1.6 + (i % 4) * 0.4, seed: 600 + i, density: 0.6, leafScale: 1.4, flex: 0.35 });
  }

  veg.build(root);
  farVeg.build(root, { castShadow: false });
  for (const [x, z, r] of veg.trunks) addCollider(x - r, x + r, 0, 4, z - r, z + r, tag);

  // 3D lawn grass everywhere except paving, the road and inside the walls.
  // Rectangles are painted in order; `true` re-allows grass (the front garden).
  const blocked = [
    [PLOT.x0 - 0.05, PLOT.x1 + 0.05, PLOT.z0 - 0.05, PLOT.z1 + 0.05],
    [px0 + 0.02, -1.3, B.z1 + 0.03, FRONT_IN - 0.02, true],
    ...[0, 1, 2, 3].map((i) => [-2.93, -2.27, 4.97 + i * 0.6, 5.43 + i * 0.6]), // stepping stones
    [-82, 82, PLOT.z1 - 0.25, road1 + 1.9], // footpaths, kerbs and road
  ];
  const grass = createGrass(m.grass, blocked);
  root.add(grass.group);

  return { root, streetLights, lampMats, gate, grass };
}
