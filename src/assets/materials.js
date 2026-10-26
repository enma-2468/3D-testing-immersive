import * as THREE from 'three';
import { assetUrl, textureLoader } from './loaders.js';

// Physically based material library. Scanned Poly Haven textures (CC0) give
// the surfaces real micro detail; `userData.tile` is the real-world size in
// metres of one texture repeat (geometry gets world-space UVs, see builder.js).

let maxAnisotropy = 8;
export function setMaxAnisotropy(n) { maxAnisotropy = n; }

function tex(path, srgb) {
  const t = textureLoader.load(assetUrl(path));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pbrSet(id, noMap) {
  return {
    map: noMap ? null : tex(`textures/${id}/diff.jpg`, true),
    normalMap: tex(`textures/${id}/nor.jpg`, false),
    arm: tex(`textures/${id}/arm.jpg`, false), // R = AO, G = roughness, B = metalness
  };
}

function pbr(id, { tile = 1, color = '#ffffff', roughness = 1, normalScale = 1, envMapIntensity = 1, physical, ...rest } = {}) {
  const s = pbrSet(id, rest.map === null);
  const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Mat({
    map: s.map,
    normalMap: s.normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: s.arm,
    aoMap: s.arm,
    aoMapIntensity: 0.7,
    roughness,
    metalness: 0,
    color,
    envMapIntensity,
    ...(physical || {}),
    ...rest,
  });
  m.userData.tile = tile;
  return m;
}

// Load an image, run a per-pixel transform on a canvas, return a CanvasTexture.
function processedTexture(path, transform, { grout } = {}) {
  const canvas = document.createElement('canvas');
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  textureLoader.load(assetUrl(path), (src) => {
    const img = src.image;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    transform(data.data);
    ctx.putImageData(data, 0, 0);
    if (grout) {
      // thin joints along the tile edges -> panels/tiles line up with the tile size
      ctx.fillStyle = grout.color;
      const w = grout.width;
      ctx.fillRect(0, 0, canvas.width, w);
      ctx.fillRect(0, 0, w, canvas.height);
      if (grout.split) { // 2 x 2 tiles per texture repeat
        ctx.fillRect(0, canvas.height / 2 - w / 2, canvas.width, w);
        ctx.fillRect(canvas.width / 2 - w / 2, 0, w, canvas.height);
      }
    }
    t.needsUpdate = true;
    src.dispose();
  });
  return t;
}

// The marble_01 scan is a low-contrast grey stone (luminance ~120-170) whose
// veins are darker than the base. Remapping that vein signal lets one scan
// produce black Nero Marquina (white veins), white Statuario and floor tiles.
const veins = (L) => Math.pow(Math.min(1, Math.max(0, (151 - L) / 15)), 0.9);
const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

function neroMarble(d) {
  for (let i = 0; i < d.length; i += 4) {
    const L = lum(d, i);
    const c = 15 + (L - 152) * 0.35 + veins(L) * 225;
    d[i] = c; d[i + 1] = c * 0.99; d[i + 2] = c * 0.97;
  }
}

function statuarioMarble(d) {
  for (let i = 0; i < d.length; i += 4) {
    const L = lum(d, i);
    const c = 238 + (L - 152) * 0.5 - veins(L) * 115;
    d[i] = c; d[i + 1] = c - 1; d[i + 2] = c - 3;
  }
}

function floorMarble(d) {
  for (let i = 0; i < d.length; i += 4) { // warm ivory, like polished Indian marble tiles
    const L = lum(d, i);
    const c = 236 + (L - 152) * 0.16 - veins(L) * 30;
    d[i] = c + 3; d[i + 1] = c; d[i + 2] = c - 7;
  }
}

// Paint scans are photographed grey; re-centre them on a neutral off-white
// (keeping a scaled-down copy of their real variation) so paint colours read true.
function neutralWhite(target, contrast) {
  return (d) => {
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    const mean = sum / (d.length / 4) / 3;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const c = target + (l - mean) * contrast;
      d[i] = c; d[i + 1] = c; d[i + 2] = c;
    }
  };
}

// Exterior paint the way it looks after a few monsoons: slight tonal drift
// across a wall (the texture sampled at a very large scale) and a faint
// splash-back band in the bottom metre near the ground.
function weathered(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        float wDrift = dot(texture2D(map, vMapUv * 0.09 + 0.31).rgb, vec3(0.333));
        diffuseColor.rgb *= mix(0.955, 1.02, smoothstep(0.8, 1.0, wDrift));
        diffuseColor.rgb *= 1.0 - 0.085 * (1.0 - smoothstep(0.05, 1.0, vWorldY));
      `);
  };
  material.customProgramCacheKey = () => 'weathered-v1';
  return material;
}

export const PALETTES = {
  stone: {
    nero: { label: 'Nero Marquina', color: '#ffffff' },
    emperador: { label: 'Dark Emperador', color: '#c79a72' },
    statuario: { label: 'Statuario White', color: '#ffffff' },
  },
  wood: {
    // multipliers on the grey-brown veneer scan (values > 1 lift it)
    teak: { label: 'Teak', color: '#b0703f', rgb: [1.5, 1.04, 0.7] },
    walnut: { label: 'Walnut', color: '#5e4030', rgb: [0.82, 0.62, 0.48] },
    oak: { label: 'Natural Oak', color: '#d1a878', rgb: [1.7, 1.42, 1.08] },
  },
  paint: {
    white: { label: 'Swan White', color: '#f7f1e8' },
    greige: { label: 'Greige', color: '#d9d2c5' },
    sage: { label: 'Sage', color: '#c9d1c0' },
    sand: { label: 'Desert Sand', color: '#e6d3b8' },
  },
};

// ---------------------------------------------------------------------------
// Interior ambient light. Indoors, the sky HDR is the wrong ambient: rooms
// would be lit (and floors would reflect) blue sky from every direction. Interior
// materials get a neutral "room" environment instead (set up in main.js), scaled
// per time of day, which stands in for light bouncing around a white room.
// ---------------------------------------------------------------------------
const interior = { materials: new Set(), texture: null, k: 1 };

export function registerInterior(mat) {
  if (interior.materials.has(mat)) return mat;
  interior.materials.add(mat);
  mat.userData.baseEnv = mat.envMapIntensity;
  if (interior.texture) {
    mat.envMap = interior.texture;
    mat.envMapIntensity = mat.userData.baseEnv * interior.k;
  }
  return mat;
}

export function setInteriorEnvironment(texture) {
  interior.texture = texture;
  for (const mat of interior.materials) {
    mat.envMap = texture;
    mat.needsUpdate = true;
  }
}

export function setInteriorAmbient(k) {
  interior.k = k;
  for (const mat of interior.materials) mat.envMapIntensity = mat.userData.baseEnv * k;
}

export function createMaterials() {
  const marbleSet = pbrSet('marble_01');

  const neroMap = processedTexture('textures/marble_01/diff.jpg', neroMarble, {
    grout: { color: '#0a0a0a', width: 4 },
  });
  const whiteMarbleMap = processedTexture('textures/marble_01/diff.jpg', statuarioMarble, {
    grout: { color: '#cfcac2', width: 3 },
  });
  const floorMarbleMap = processedTexture('textures/marble_01/diff.jpg', floorMarble, {
    grout: { color: '#d3cdc3', width: 2, split: true },
  });
  const plasterMap = processedTexture('textures/white_stucco/diff.jpg', neutralWhite(238, 0.55));
  const paintMap = processedTexture('textures/painted_plaster_wall/diff.jpg', neutralWhite(240, 0.35));

  const m = {};

  // --- facade -------------------------------------------------------------
  m.marbleFacade = new THREE.MeshPhysicalMaterial({
    map: neroMap,
    normalMap: marbleSet.normalMap,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughness: 0.22,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
  });
  m.marbleFacade.userData = { tile: 3.6, maps: { nero: neroMap, statuario: whiteMarbleMap } };

  // exterior: fine "texture paint" stucco; interior: smooth emulsion on plaster
  m.plaster = weathered(pbr('white_stucco', { tile: 1.6, color: PALETTES.paint.white.color, normalScale: 0.9, aoMapIntensity: 0.5, map: plasterMap }));
  m.plasterInterior = pbr('painted_plaster_wall', { tile: 2.5, color: '#fbf3e8', normalScale: 0.5, envMapIntensity: 1.3, aoMapIntensity: 0, map: paintMap });
  m.ceiling = pbr('painted_plaster_wall', { tile: 3, color: '#fbf5ec', normalScale: 0.3, envMapIntensity: 1.25, aoMapIntensity: 0, map: paintMap });

  // natural stacked slate (ledge-stone cladding)
  m.stone = pbr('castle_wall_slates', { tile: 1.5, normalScale: 1.3, aoMapIntensity: 1 });
  m.stone.color.setRGB(1.75, 1.7, 1.62); // the scan is shot dark; lift it to a light grey ledge-stone
  // straight-grain veneer (doors, cabinets, slats); grain runs along V = vertical on doors
  m.wood = pbr('kitchen_wood', { tile: 1.4, roughness: 0.75, physical: { clearcoat: 0.4, clearcoatRoughness: 0.3 } });
  m.woodInterior = pbr('kitchen_wood', { tile: 1.4, roughness: 0.6, envMapIntensity: 0.9, physical: { clearcoat: 0.25, clearcoatRoughness: 0.25 } });
  setWoodFinish(m, 'teak');
  m.paving = pbr('large_grey_tiles', { tile: 2.2, color: '#d9d7d3' });
  m.grass = pbr('leafy_grass', { tile: 2.2, color: '#8cab62', normalScale: 1.2 });
  m.asphalt = pbr('asphalt_02', { tile: 5 });
  m.laminate = pbr('laminate_floor_02', { tile: 2.4, roughness: 0.8, envMapIntensity: 0.85 });

  // polished 800 x 800 vitrified tiles: satin base under a mirror-like glaze
  m.floorMarble = new THREE.MeshPhysicalMaterial({
    map: floorMarbleMap,
    normalMap: marbleSet.normalMap,
    normalScale: new THREE.Vector2(0.05, 0.05),
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 0.75,
  });
  m.floorMarble.userData.tile = 1.6;

  m.granite = new THREE.MeshPhysicalMaterial({
    color: '#141414',
    normalMap: marbleSet.normalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
  });
  m.granite.userData.tile = 1.5;

  m.concrete = pbr('white_stucco', { tile: 2, color: '#b9b6b0', normalScale: 1, map: plasterMap });

  // --- metals & glass -----------------------------------------------------
  m.aluminium = new THREE.MeshPhysicalMaterial({ color: '#1d1e20', metalness: 0.7, roughness: 0.38, clearcoat: 0.3 });
  m.steel = new THREE.MeshStandardMaterial({ color: '#cfd2d4', metalness: 1, roughness: 0.25 });
  m.chrome = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.08 });
  m.steelInterior = m.steel.clone(); // appliances: reflect the room, not the sky

  m.glass = new THREE.MeshPhysicalMaterial({
    color: '#2b3539',
    metalness: 0,
    roughness: 0.02,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.8,
    specularIntensity: 1,
  });
  m.glassRailing = m.glass.clone();
  m.glassRailing.opacity = 0.2;
  m.glassRailing.color.set('#8fa6a2');

  // --- interiors ------------------------------------------------------------
  // woven cloth: real weave relief (scanned normal map) under a velvet-like sheen
  const fabric = (color, sheenColor) => {
    const f = pbr('fabric_pattern_05', { map: null, color, normalScale: 0.7, envMapIntensity: 0.9, physical: { sheen: 1, sheenColor: new THREE.Color(sheenColor), sheenRoughness: 0.55 } });
    for (const t of [f.normalMap, f.roughnessMap]) t.repeat.set(6, 6); // soft furnishings use 0-1 UVs
    return f;
  };
  m.fabricLight = fabric('#ebe6dc', '#ffffff');
  m.fabricGrey = fabric('#7d7f82', '#c9c9c9');
  m.fabricAccent = fabric('#7a5a3c', '#d7b48c');
  // loop-pile rug: carpet relief from a scan, our own colour
  m.rug = pbr('dirty_carpet', { tile: 0.7, map: null, color: '#b2a796', normalScale: 1.1, envMapIntensity: 0.8, physical: { sheen: 1, sheenColor: new THREE.Color('#e8dfd2'), sheenRoughness: 0.8 } });
  m.lacquer = new THREE.MeshPhysicalMaterial({ color: '#efece6', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.9 });
  m.lacquerDark = new THREE.MeshPhysicalMaterial({ color: '#2b2d30', roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.9 });
  m.ceramic = new THREE.MeshPhysicalMaterial({ color: '#f6f6f4', roughness: 0.08, clearcoat: 1, envMapIntensity: 0.7 });
  m.tilesWall = new THREE.MeshStandardMaterial({ map: whiteMarbleMap, roughness: 0.15, envMapIntensity: 0.8 });
  m.tilesWall.userData.tile = 0.6;
  // TV panel: black glass that reflects the room faintly; the picture is an emissive map
  m.screen = new THREE.MeshPhysicalMaterial({ color: '#020203', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.25, emissive: '#ffffff', emissiveIntensity: 0 });
  m.blackPlastic = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.55 });
  m.leaves = null; // created in vegetation.js
  m.bark = new THREE.MeshStandardMaterial({ color: '#4a3d33', roughness: 0.95 });
  m.soil = new THREE.MeshStandardMaterial({ color: '#3b2c22', roughness: 1 });
  m.whiteLine = new THREE.MeshStandardMaterial({ color: '#e9e9e2', roughness: 0.8 });
  m.kerb = new THREE.MeshStandardMaterial({ color: '#9d9a95', roughness: 0.9 });

  for (const key of ['plasterInterior', 'ceiling', 'floorMarble', 'laminate', 'woodInterior', 'fabricLight', 'fabricGrey',
    'fabricAccent', 'rug', 'lacquer', 'lacquerDark', 'ceramic', 'tilesWall', 'screen', 'chrome', 'steelInterior']) {
    registerInterior(m[key]);
  }

  // --- light emitters (driven by the lighting system) -----------------------
  m.lampWarm = new THREE.MeshStandardMaterial({ color: '#fff8ee', emissive: '#ffd7a1', emissiveIntensity: 0, roughness: 0.4 });
  m.ledStrip = new THREE.MeshStandardMaterial({ color: '#fff4e2', emissive: '#ffcf8a', emissiveIntensity: 0, roughness: 0.4 });

  return m;
}

// --- configurator hooks ---------------------------------------------------------

export function setStoneFinish(m, key) {
  const p = PALETTES.stone[key];
  const maps = m.marbleFacade.userData.maps;
  m.marbleFacade.map = key === 'statuario' ? maps.statuario : maps.nero;
  m.marbleFacade.color.set(p.color);
  m.marbleFacade.needsUpdate = true;
}

export function setWoodFinish(m, key) {
  const [r, g, b] = PALETTES.wood[key].rgb;
  m.wood.color.setRGB(r, g, b);
  m.woodInterior.color.setRGB(r, g, b);
}

export function setPaint(m, key) {
  m.plaster.color.set(PALETTES.paint[key].color);
}
