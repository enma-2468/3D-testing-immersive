import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { IN, LVL, ROOMS } from '../config.js';
import { box } from './builder.js';
import { placeModel } from '../assets/models.js';
import { registerInterior } from '../assets/materials.js';
import { addCollider } from '../systems/physics.js';
import { animate, approach, invalidate, makeInteractive } from '../systems/interaction-registry.js';

const G = LVL.ground;
const F = LVL.first;
const R = LVL.roof;
const HALF_PI = Math.PI / 2;

function soft(parent, mat, w, h, d, x, y, z, radius = 0.04, rotY = 0) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Abstract canvas art for the walls
function artTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 512;
  const ctx = c.getContext('2d');
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const palettes = [
    ['#e9e2d4', '#c8a27a', '#3d4a52', '#b5654a', '#1f2326'],
    ['#efe9e1', '#8fa39a', '#2e3b3f', '#d9b38c', '#5a6b5d'],
    ['#f2ede6', '#b7c4cc', '#1d2a33', '#c98b6b', '#6a7c87'],
  ];
  const pal = palettes[seed % palettes.length];
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 7; i++) {
    ctx.globalAlpha = 0.55 + rnd() * 0.45;
    ctx.fillStyle = pal[1 + Math.floor(rnd() * (pal.length - 1))];
    ctx.beginPath();
    if (rnd() > 0.5) {
      ctx.arc(rnd() * c.width, rnd() * c.height, 40 + rnd() * 130, 0, Math.PI * 2);
    } else {
      ctx.rect(rnd() * c.width * 0.7, rnd() * c.height * 0.8, 40 + rnd() * 200, 20 + rnd() * 120);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function artwork(parent, m, axis, x, y, z, w, h, seed, facing = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = axis === 'x' ? (facing > 0 ? 0 : Math.PI) : (facing > 0 ? HALF_PI : -HALF_PI);
  parent.add(g);
  box(g, m.lacquerDark, -w / 2 - 0.03, w / 2 + 0.03, -h / 2 - 0.03, h / 2 + 0.03, 0, 0.03);
  const canvasMat = new THREE.MeshStandardMaterial({ map: artTexture(seed), roughness: 0.9, envMapIntensity: 0.4 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), canvasMat);
  art.position.z = 0.031;
  g.add(art);
}

// --- furniture builders ---------------------------------------------------------

function bed(parent, m, { x, z, rotY, y, tag }) {
  // Built facing +Z (headboard at -Z), then rotated into place
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
  const W = 1.65, L = 2.1;
  box(g, m.woodInterior, -W / 2, W / 2, 0.1, 0.32, -L / 2, L / 2);
  box(g, m.aluminium, -W / 2 + 0.1, W / 2 - 0.1, 0, 0.1, -L / 2 + 0.1, L / 2 - 0.1);
  soft(g, m.fabricAccent, W + 0.1, 1.1, 0.12, 0, 0.62, -L / 2 - 0.02, 0.05); // headboard
  soft(g, m.fabricLight, W - 0.06, 0.24, L - 0.08, 0, 0.44, 0.02, 0.06);   // mattress
  soft(g, m.fabricGrey, W + 0.02, 0.07, L * 0.62, 0, 0.58, L * 0.17, 0.03); // duvet
  soft(g, m.fabricAccent, W + 0.04, 0.02, 0.45, 0, 0.62, L * 0.32, 0.01);   // throw
  for (const s of [-1, 1]) soft(g, m.fabricLight, 0.62, 0.15, 0.4, s * 0.38, 0.62, -L / 2 + 0.3, 0.07);
  g.updateWorldMatrix(true, true);
  const bb = new THREE.Box3().setFromObject(g);
  addCollider(bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z, tag);
  // bedside tables with lamps
  for (const s of [-1, 1]) {
    const local = new THREE.Vector3(s * (W / 2 + 0.38), 0, -L / 2 + 0.25).applyMatrix4(g.matrix);
    placeModel('side_table_01', { parent, at: [local.x, y, local.z], rotY, collider: tag, envMapIntensity: 0.9 });
    const lamp = soft(parent, m.lampWarm, 0.22, 0.24, 0.22, local.x, y + 0.71, local.z, 0.05);
    lamp.castShadow = false;
  }
  return g;
}

function wardrobe(parent, m, { x0, x1, z0, z1, y, tag, doors = 3 }) {
  box(parent, m.woodInterior, x0, x1, y, y + 2.3, z0, z1, { solid: tag });
  // door grooves + handles on the long open face
  const alongX = x1 - x0 > z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  for (let i = 1; i < doors; i++) {
    const a = (alongX ? x0 : z0) + (len * i) / doors;
    if (alongX) {
      const zf = z1 + 0.002;
      box(parent, m.lacquerDark, a - 0.004, a + 0.004, y + 0.05, y + 2.25, zf - 0.002, zf + 0.001, { cast: false });
      box(parent, m.steelInterior, a - 0.05, a - 0.035, y + 0.9, y + 1.4, zf, zf + 0.03);
    } else {
      const xf = x0 - 0.002;
      box(parent, m.lacquerDark, xf - 0.001, xf + 0.002, y + 0.05, y + 2.25, a - 0.004, a + 0.004, { cast: false });
      box(parent, m.steelInterior, xf - 0.03, xf, y + 0.9, y + 1.4, a - 0.05, a - 0.035);
    }
  }
}

// A calm landscape "screensaver" for the TV picture, painted once on a canvas
function tvPicture() {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 220);
  sky.addColorStop(0, '#1d4f86');
  sky.addColorStop(0.6, '#e9a46a');
  sky.addColorStop(1, '#f6d29b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 640, 360);
  const sun = ctx.createRadialGradient(430, 190, 4, 430, 190, 70);
  sun.addColorStop(0, 'rgba(255,248,225,1)');
  sun.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(330, 110, 200, 160);
  const ridge = (y, amp, color, seed) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 360);
    for (let x = 0; x <= 640; x += 8) {
      ctx.lineTo(x, y + Math.sin(x * 0.011 + seed) * amp + Math.sin(x * 0.037 + seed * 2) * amp * 0.35);
    }
    ctx.lineTo(640, 360);
    ctx.fill();
  };
  ridge(215, 22, '#7b6e86', 1);
  ridge(250, 18, '#4b4a62', 3);
  ridge(290, 14, '#262a3a', 5);
  const lake = ctx.createLinearGradient(0, 300, 0, 360);
  lake.addColorStop(0, '#d79b6a');
  lake.addColorStop(1, '#1c2436');
  ctx.fillStyle = lake;
  ctx.fillRect(0, 318, 640, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let tvTexture = null;

function tv(parent, m, { x, y, z, rotY }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
  tvTexture ||= tvPicture();
  const screenMat = registerInterior(m.screen.clone());
  screenMat.emissiveMap = tvTexture;
  box(g, m.lacquerDark, -0.74, 0.74, -0.43, 0.43, 0, 0.035); // slim bezel + body
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.82), screenMat);
  screen.position.z = 0.0362;
  g.add(screen);
  const state = { on: false, k: 0 };
  makeInteractive(g, {
    label: () => `TV: switch ${state.on ? 'off' : 'on'}`,
    onClick: () => { state.on = !state.on; },
  });
  animate((dt) => {
    const next = approach(state.k, state.on ? 1 : 0, 6, dt);
    if (Math.abs(next - state.k) < 1e-4) return;
    state.k = next;
    screenMat.emissiveIntensity = state.k * 1.6;
    invalidate();
  });
}

function kitchen(parent, m, tag) {
  const y = G;
  const d = 0.62;
  // base units along the back wall and the right wall
  box(parent, m.lacquer, 0.32, IN.x1, y, y + 0.86, IN.z0, IN.z0 + d, { solid: tag });
  box(parent, m.lacquer, IN.x1 - d, IN.x1, y, y + 0.86, IN.z0 + d, -4.75, { solid: tag });
  box(parent, m.lacquerDark, 0.32, IN.x1, y, y + 0.1, IN.z0 + d - 0.05, IN.z0 + d + 0.002, { cast: false });
  box(parent, m.lacquerDark, IN.x1 - d - 0.002, IN.x1 - d + 0.05, y, y + 0.1, IN.z0 + d, -4.75, { cast: false });
  // granite countertop
  box(parent, m.granite, 0.3, IN.x1, y + 0.86, y + 0.9, IN.z0, IN.z0 + d + 0.03);
  box(parent, m.granite, IN.x1 - d - 0.03, IN.x1, y + 0.86, y + 0.9, IN.z0 + d + 0.03, -4.72);
  // handles
  for (let x = 0.55; x < IN.x1 - 0.7; x += 0.6) box(parent, m.steelInterior, x - 0.15, x + 0.15, y + 0.74, y + 0.755, IN.z0 + d, IN.z0 + d + 0.02);
  // sink under the window
  box(parent, m.steelInterior, 2.15, 2.85, y + 0.9, y + 0.905, IN.z0 + 0.12, IN.z0 + 0.52, { cast: false });
  box(parent, m.lacquerDark, 2.2, 2.8, y + 0.902, y + 0.906, IN.z0 + 0.16, IN.z0 + 0.48, { cast: false });
  const tap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 10, 24, Math.PI), m.chrome);
  tap.position.set(2.5, y + 0.92, IN.z0 + 0.1);
  tap.rotation.y = HALF_PI;
  parent.add(tap);
  // hob + hood on the right wall
  box(parent, m.screen, IN.x1 - 0.55, IN.x1 - 0.08, y + 0.9, y + 0.91, -6.1, -5.4, { cast: false });
  box(parent, m.steelInterior, IN.x1 - 0.55, IN.x1, y + 1.65, y + 1.78, -6.2, -5.3);
  box(parent, m.steelInterior, IN.x1 - 0.3, IN.x1, y + 1.78, y + 2.7, -5.9, -5.6);
  // wall units
  box(parent, m.woodInterior, 0.32, 1.5, y + 1.5, y + 2.25, IN.z0, IN.z0 + 0.35);
  box(parent, m.woodInterior, IN.x1 - 0.35, IN.x1, y + 1.5, y + 2.25, -5.25, -4.2);
  box(parent, m.woodInterior, IN.x1 - 0.35, IN.x1, y + 1.5, y + 2.25, -7.17, -6.25);
  // backsplash
  box(parent, m.tilesWall, 0.32, 1.55, y + 0.9, y + 1.5, IN.z0, IN.z0 + 0.006, { cast: false });
  box(parent, m.tilesWall, 3.45, IN.x1, y + 0.9, y + 1.5, IN.z0, IN.z0 + 0.006, { cast: false });
  // refrigerator
  box(parent, m.steelInterior, 0.32, 1.02, y, y + 1.8, -4.75, -4.06, { solid: tag });
  box(parent, m.lacquerDark, 1.0, 1.025, y + 0.05, y + 1.75, -4.42, -4.4, { cast: false });
}

function toiletFittings(parent, m, y, tag) {
  // wall-hung WC and vanity basin
  soft(parent, m.ceramic, 0.38, 0.4, 0.55, -3.85, y + 0.4, -6.8, 0.12, 0);
  soft(parent, m.ceramic, 0.36, 0.06, 0.5, -3.85, y + 0.62, -6.83, 0.03);
  soft(parent, m.lacquer, 0.5, 0.1, 0.15, -3.85, y + 0.95, -7.1, 0.02);
  addCollider(-4.05, -3.65, y, y + 0.65, -7.17, -6.5, tag);
  soft(parent, m.ceramic, 0.36, 0.16, 0.6, -2.99, y + 0.82, -6.5, 0.05);
  box(parent, m.chrome, -2.86, -2.83, y + 0.9, y + 1.08, -6.51, -6.49);
  box(parent, m.chrome, -2.815, -2.81, y + 1.2, y + 1.9, -6.8, -6.2, { cast: false }); // mirror
  addCollider(-3.17, -2.81, y, y + 0.9, -6.8, -6.2, tag);
}

// --- main -----------------------------------------------------------------------

export function buildInterior(m, levels) {
  const g = levels.ground;
  const f = levels.first;
  const r = levels.roof;
  const fans = [];

  // ---------- ground floor ----------
  // living room
  placeModel('modern_wooden_cabinet', { parent: g, at: [-0.27, G, 3.0], rotY: HALF_PI, collider: 'ground', envMapIntensity: 0.9 });
  tv(g, m, { x: -0.5, y: G + 1.45, z: 3.0, rotY: HALF_PI });
  placeModel('sofa_02', { parent: g, at: [3.45, G, 2.65], rotY: -HALF_PI, collider: 'ground', envMapIntensity: 0.9 });
  placeModel('throw_pillows_01', { parent: g, at: [3.62, G + 0.68, 2.65], rotY: -HALF_PI, scale: 0.85, envMapIntensity: 0.9 });
  placeModel('modern_coffee_table_01', { parent: g, at: [1.7, G, 2.8], collider: 'ground', envMapIntensity: 0.9 });
  placeModel('modern_arm_chair_01', { parent: g, at: [1.4, G, 1.25], rotY: 0.25, collider: 'ground', envMapIntensity: 0.9 });
  placeModel('potted_plant_02', { parent: g, at: [3.8, G, 0.95], collider: 'ground', envMapIntensity: 0.9 });
  placeModel('calathea_orbifolia_01', { parent: g, at: [-1.3, G, 0.25], only: '_b', center: true, scale: 1.4, envMapIntensity: 0.9 });
  box(g, m.rug, 0.5, 2.9, G, G + 0.008, 1.75, 3.85, { cast: false });

  // dining
  const tableY = G + 0.76;
  box(g, m.woodInterior, 0.35, 2.25, tableY - 0.04, tableY, -2.08, -1.12);
  for (const [lx, lz] of [[0.5, -1.25], [2.1, -1.25], [0.5, -1.95], [2.1, -1.95]]) {
    box(g, m.aluminium, lx - 0.025, lx + 0.025, G, tableY - 0.04, lz - 0.025, lz + 0.025);
  }
  addCollider(0.35, 2.25, G, tableY, -2.08, -1.12, 'ground');
  for (const x of [0.7, 1.3, 1.9]) {
    placeModel('dining_chair_02', { parent: g, at: [x, G, -0.82], rotY: Math.PI, envMapIntensity: 0.9 });
    placeModel('dining_chair_02', { parent: g, at: [x, G, -2.38], rotY: 0, envMapIntensity: 0.9 });
  }
  for (const x of [0.85, 1.75]) placeModel('modern_ceiling_lamp_01', { parent: g, at: [x, 3.6 - 1.17, -1.6], envMapIntensity: 1 });
  placeModel('potted_plant_02', { parent: g, at: [3.85, G, -3.55], collider: 'ground', envMapIntensity: 0.9 });
  artwork(g, m, 'x', 3.4, G + 1.6, -3.84, 1.0, 0.7, 7, 1);

  kitchen(g, m, 'ground');
  bed(g, m, { x: IN.x0 + 1.15, z: 2.65, rotY: HALF_PI, y: G, tag: 'ground' });
  wardrobe(g, m, { x0: -3.45, x1: -2.2, z0: 0.66, z1: 1.26, y: G, tag: 'ground', doors: 2 });
  bed(g, m, { x: 0.14 - 1.12, z: -5.5, rotY: -HALF_PI, y: G, tag: 'ground' });
  wardrobe(g, m, { x0: -2.69, x1: -1.55, z0: -4.56, z1: -3.96, y: G, tag: 'ground', doors: 2 });
  toiletFittings(g, m, G, 'ground');
  artwork(g, m, 'z', -4.11, G + 1.6, -5.0, 0.6, 0.8, 11, 1);

  // ---------- first floor ----------
  bed(f, m, { x: IN.x0 + 1.15, z: 2.65, rotY: HALF_PI, y: F, tag: 'first' });
  wardrobe(f, m, { x0: -3.45, x1: -2.2, z0: 0.66, z1: 1.26, y: F, tag: 'first', doors: 2 });
  // lounge facing the balcony
  placeModel('modern_arm_chair_01', { parent: f, at: [0.6, F, 2.5], rotY: 0.35, collider: 'first', envMapIntensity: 0.9 });
  placeModel('modern_arm_chair_01', { parent: f, at: [2.4, F, 2.5], rotY: -0.35, collider: 'first', envMapIntensity: 0.9 });
  placeModel('modern_coffee_table_01', { parent: f, at: [1.5, F, 3.3], rotY: HALF_PI, scale: 0.8, collider: 'first', envMapIntensity: 0.9 });
  placeModel('potted_plant_02', { parent: f, at: [3.8, F, 1.0], collider: 'first', envMapIntensity: 0.9 });
  box(f, m.rug, 0.0, 3.0, F, F + 0.008, 1.7, 3.9, { cast: false });
  // family hall
  placeModel('modern_wooden_cabinet', { parent: f, at: [2.95, F, -3.56], collider: 'first', envMapIntensity: 0.9 });
  tv(f, m, { x: 2.95, y: F + 1.45, z: -3.83, rotY: 0 });
  placeModel('sofa_02', { parent: f, at: [2.95, F, -0.45], rotY: Math.PI, collider: 'first', envMapIntensity: 0.9 });
  placeModel('modern_coffee_table_01', { parent: f, at: [2.95, F, -1.9], rotY: HALF_PI, collider: 'first', envMapIntensity: 0.9 });
  box(f, m.rug, 1.6, 4.1, F, F + 0.008, -2.9, -0.2, { cast: false });
  artwork(f, m, 'z', -1.68, F + 1.6, -1.5, 0.9, 1.2, 5, 1);
  // bedrooms
  bed(f, m, { x: 0.14 - 1.12, z: -5.5, rotY: -HALF_PI, y: F, tag: 'first' });
  wardrobe(f, m, { x0: -2.69, x1: -1.55, z0: -4.56, z1: -3.96, y: F, tag: 'first', doors: 2 });
  bed(f, m, { x: 0.26 + 1.15, z: -5.7, rotY: HALF_PI, y: F, tag: 'first' });
  wardrobe(f, m, { x0: IN.x1 - 0.6, x1: IN.x1, z0: -5.0, z1: -3.96, y: F, tag: 'first', doors: 2 });
  toiletFittings(f, m, F, 'first');
  artwork(f, m, 'z', -1.27, F + 1.6, 3.0, 1.0, 0.7, 2, -1);
  // balcony
  placeModel('potted_plant_02', { parent: f, at: [-0.85, F, 5.55], collider: 'first' });
  placeModel('potted_plant_02', { parent: f, at: [3.6, F, 5.55], rotY: 1.2, collider: 'first' });

  // ---------- roof terrace ----------
  placeModel('outdoor_table_chair_set_01', { parent: r, at: [-2.4, R, 2.7], rotY: HALF_PI, collider: 'roof' });
  for (const z of [-5.5, -3.0, -0.5, 2.0]) {
    placeModel('planter_box_01', { parent: r, at: [4.0, R, z], rotY: HALF_PI, collider: 'roof' });
    placeModel('potted_plant_04', { parent: r, at: [4.0, R + 0.35, z - 0.2], scale: 1.4 });
  }
  placeModel('potted_plant_02', { parent: r, at: [-0.9, R, 4.2], collider: 'roof' });
  placeModel('potted_plant_02', { parent: r, at: [3.7, R, 5.4], rotY: 2, collider: 'roof' });

  // ---------- ceiling fans ----------
  for (const room of ROOMS) {
    if (!['bed1', 'living', 'bed2', 'bed3', 'family', 'master', 'bed4'].includes(room.id)) continue;
    const parent = levels[room.level];
    const cx = (room.x0 + room.x1) / 2;
    const cz = (room.z0 + room.z1) / 2;
    // fans start off: a still scene costs nothing to display (rendering is on demand)
    const state = { on: false, speed: 0, blades: [] };
    const fan = placeModel('ceiling_fan', {
      parent,
      envMapIntensity: 0.9,
      at: [cx, LVL[room.level] + 3.15, cz],
      onLoad: (root) => root.traverse((o) => { if (o.name === 'ceiling_fan_blades') state.blades.push(o); }),
    });
    makeInteractive(fan, {
      label: () => `Ceiling fan: ${state.on ? 'stop' : 'start'}`,
      onClick: () => { state.on = !state.on; },
    });
    animate((dt) => {
      state.speed = approach(state.speed, state.on ? 9 : 0, 1.2, dt);
      if (state.speed < 0.01 && !state.on) { state.speed = 0; return; }
      for (const b of state.blades) b.rotation.y += state.speed * dt;
      invalidate();
    });
    fans.push(state);
  }

  return { fans };
}
