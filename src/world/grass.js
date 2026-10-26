import * as THREE from 'three';
import { WIND_GLSL, wind } from './wind.js';
import { patchSunShadow, sunUniforms } from './vegetation.js';

// Real 3D lawn grass, the way open-world games do it:
//  - grass clump cards: each tuft is three crossed quads carrying a painted
//    texture of ~90 fine, curved blades, so a lawn gets thousands of blades
//    per square metre for a few hundred triangles
//  - a fixed set of tufts tiles the ground around the camera; each tuft wraps
//    to the far side of the window as the camera moves, so it keeps a fixed
//    spot in the world and the cost is the same everywhere
//  - two layers (dense near field, sparser bigger cards further out) that
//    cross-fade, then fade into the lawn texture; nothing ever pops
//  - a painted mask keeps grass off paving, the road and walls
//  - each tuft takes its colour from the lawn texture under it, so the blades
//    melt into the ground where they fade out
//  - tips bend with the wind, and away from you when you walk through it

// Same low-frequency light/dark patches the lawn texture gets (see site.js),
// sampled at a fixed mip so the vertex shader (grass) and fragment shader
// (ground) agree exactly.
export const LAWN_GLSL = /* glsl */ `
  float lawnMacro(sampler2D map, vec2 uv) {
    float macroA = dot(textureLod(map, uv * 0.071, 5.0).rgb, vec3(0.333));
    float macroB = dot(textureLod(map, uv * 0.013 + 0.37, 5.0).rgb, vec3(0.333));
    return mix(0.72, 1.3, smoothstep(0.12, 0.42, macroA * 0.6 + macroB * 0.4));
  }
`;

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const CARD_W = 0.42, CARD_H = 0.16; // metres covered by the blade texture
const FAR = 34; // grass ends (fades into the lawn texture) this far from the camera

/**
 * Paint the blade texture: colour (opaque, so mipmaps don't bleed black into
 * the blades) and a separate coverage mask. Colour is a neutral luminance
 * ramp (dark roots, light tips, a few straw-coloured blades); the real green
 * comes from the lawn under each tuft.
 */
function bladeTextures() {
  const W = 512, H = 256;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    return c;
  };
  const colour = make(), mask = make();
  const gc = colour.getContext('2d'), gm = mask.getContext('2d');
  gc.fillStyle = 'rgb(120,124,110)';
  gc.fillRect(0, 0, W, H);
  gm.fillStyle = '#000';
  gm.fillRect(0, 0, W, H);
  gm.fillStyle = '#fff';
  const rnd = seeded(5);
  for (let i = 0; i < 150; i++) {
    // fewer and shorter blades towards the card edges: a domed tuft, so the
    // quad's outline never shows
    const x0 = W * (0.5 + (rnd() + rnd() + rnd() - 1.5) * 0.6);
    const u = (x0 / W - 0.5) * 2;
    const h = H * (0.25 + 0.73 * Math.pow(rnd(), 1.1)) * (1 - 0.55 * u * u);
    const lean = (rnd() - 0.5) * 0.7 * h;
    const w = 3 + rnd() * 3.5;
    const tx = x0 + lean, ty = H - h;
    const cx = x0 + lean * 0.25, cy = H - h * 0.6;
    const blade = (g) => {
      g.beginPath();
      g.moveTo(x0 - w / 2, H);
      g.quadraticCurveTo(cx - w * 0.4, cy, tx, ty);
      g.quadraticCurveTo(cx + w * 0.4, cy, x0 + w / 2, H);
      g.closePath();
      g.fill();
    };
    const l = 0.8 + rnd() * 0.35;
    const straw = rnd() < 0.12;
    const tip = straw ? [228 * l, 215 * l, 160 * l] : [210 * l, 228 * l, 190 * l];
    const grad = gc.createLinearGradient(x0, H, tx, ty);
    grad.addColorStop(0, `rgb(${tip.map((v) => Math.round(v * 0.5)).join(',')})`);
    grad.addColorStop(1, `rgb(${tip.map((v) => Math.min(255, Math.round(v))).join(',')})`);
    gc.fillStyle = grad;
    blade(gc);
    blade(gm);
  }
  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(colour, true), alphaMap: tex(mask, false) };
}

/** Three crossed cards, rooted at the origin, split vertically so the tips can bend. */
function tuftGeometry({ cards = 3, segments = 3, width = CARD_W, height = CARD_H }) {
  const pos = [], nor = [], uv = [], index = [];
  for (let c = 0; c < cards; c++) {
    const a = (c / cards) * Math.PI;
    const ax = Math.cos(a), az = Math.sin(a);
    const first = pos.length / 3;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      for (const side of [-0.5, 0.5]) {
        pos.push(ax * width * side, height * t, az * width * side);
        nor.push(-az, 0, ax);
        uv.push(side + 0.5, t);
      }
    }
    for (let s = 0; s < segments; s++) {
      const i = first + s * 2;
      index.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * Grass allowed (white) / not (black), painted in order from [x0, x1, z0, z1, allow?]
 * rectangles in world metres.
 */
function paintMask(rects, extent, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  const k = size / (extent * 2);
  for (const [x0, x1, z0, z1, allow] of rects) {
    g.fillStyle = allow ? '#fff' : '#000';
    g.fillRect((x0 + extent) * k, (z0 + extent) * k, (x1 - x0) * k, (z1 - z0) * k);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.flipY = false; // canvas row 0 = smallest z
  return tex;
}

// Shared by both layers
const grassUniforms = {
  uMask: { value: null },
  uMaskRect: { value: new THREE.Vector4() },
  uGround: { value: null },
  uGroundColor: { value: new THREE.Color() },
  uGroundTile: { value: 1 },
  uCenter: { value: new THREE.Vector3() }, // camera position
  uPusher: { value: new THREE.Vector3(0, 0, 0) },
  uGrassOn: { value: 1 },
};

/**
 * For the lawn's own shader: the ground between real grass blades is in their
 * shade, so the lawn darkens where the 3D grass grows, fading out with the
 * grass so there's no visible edge. Needs vMapUv (world xz / tile).
 */
export const grassGroundUniforms = {
  uMask: grassUniforms.uMask,
  uMaskRect: grassUniforms.uMaskRect,
  uGroundTile: grassUniforms.uGroundTile,
  uGrassOn: grassUniforms.uGrassOn,
};
export const GRASS_GROUND_GLSL = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec4 uMaskRect;
  uniform float uGroundTile;
  uniform float uGrassOn;
  float grassShade(vec2 uv) {
    vec2 xz = uv * uGroundTile;
    float mask = textureLod(uMask, (xz - uMaskRect.xy) * uMaskRect.zw, 0.0).r;
    float cover = mask * (1.0 - smoothstep(3.0, ${FAR.toFixed(1)}, distance(vec3(xz.x, 0.0, xz.y), cameraPosition)));
    return mix(1.0, 0.74, cover * uGrassOn);
  }
`;

// Tuft placement, shared by the lit pass and the depth pre-pass so both put
// every blade in exactly the same place.
const GRASS_PARS = /* glsl */ `
  attribute vec2 aOffset;
  attribute vec4 aRand;
  uniform sampler2D uMask;
  uniform vec4 uMaskRect;
  uniform vec3 uCenter; // camera position
  uniform vec3 uPusher;
  uniform float uRadius;
  uniform vec2 uFadeIn;
  ${WIND_GLSL}
  vec2 gXZ;     // world position of the tuft
  float gSize;  // 0 = masked / faded out .. 1
  float gH;     // height scale
  mat2 gRot;
  void grassPlace() {
    // the copy of this tuft's lattice slot nearest the camera
    vec2 rel = mod(aOffset - uCenter.xz + uRadius, 2.0 * uRadius) - uRadius;
    gXZ = uCenter.xz + rel;
    // fade by true distance from the eye: seen from high up, grass gives way to the lawn texture
    float dist = length(vec3(rel.x, max(uCenter.y - 1.7, 0.0), rel.y));
    float mask = textureLod(uMask, (gXZ - uMaskRect.xy) * uMaskRect.zw, 0.0).r;
    gSize = mask * (1.0 - smoothstep(uRadius * 0.62, uRadius * 0.95, dist));
    if (uFadeIn.y > 0.0) gSize *= smoothstep(uFadeIn.x, uFadeIn.y, dist);
    gSize = smoothstep(0.05, 0.6, gSize);
    float a = aRand.y * 6.2831853;
    gRot = mat2(cos(a), sin(a), -sin(a), cos(a));
    // mostly short lawn, the odd taller weedy tuft
    gH = mix(0.6, 1.25, aRand.x) * (aRand.w > 0.96 ? 1.7 : 1.0);
  }
  vec3 grassVertex(vec3 p, float t) {
    vec3 v = p;
    v.xz = gRot * v.xz * mix(0.85, 1.2, aRand.z);
    v.y *= gH * gSize;
    // wind gusts + a little per-tuft flutter, and blades bend away from the walker
    vec2 bend = windOffset(vec3(gXZ.x, 0.0, gXZ.y)).xz * 0.5;
    bend += vec2(sin(uTime * 2.7 + aRand.w * 40.0), cos(uTime * 2.3 + aRand.z * 31.0)) * 0.08 * uWind;
    vec2 away = gXZ - uPusher.xy;
    float awayLen = max(length(away), 1e-3);
    bend += away / awayLen * uPusher.z * (1.0 - smoothstep(0.2, 0.8, awayLen)) * 1.2;
    float bl = length(bend);
    if (bl > 1.2) bend *= 1.2 / bl;
    float w = t * t * ${CARD_H.toFixed(3)} * gH * gSize;
    v.xz += bend * w;
    v.y -= dot(bend, bend) * 0.3 * w;
    v.xz += gXZ;
    if (gSize < 0.01) v = vec3(gXZ.x, -1.0, gXZ.y); // collapsed: costs no pixels
    return v;
  }
`;

// Thin alpha-tested blades vanish in the mip chain (coverage averages below
// the cut-off). Boost alpha by the mip level so distant grass keeps its body.
const ALPHA_MIP = /* glsl */ `
  #include <alphamap_fragment>
  {
    vec2 aTex = vAlphaMapUv * vec2(512.0, 256.0);
    vec2 adx = dFdx(aTex), ady = dFdy(aTex);
    float aLod = max(0.0, 0.5 * log2(max(dot(adx, adx), dot(ady, ady))));
    diffuseColor.a *= 1.0 + aLod * 0.3;
  }
`;

function grassMaterials(textures, layer) {
  const uniforms = { ...grassUniforms, ...wind.uniforms, ...sunUniforms, ...layer.uniforms };
  const lit = new THREE.MeshStandardMaterial({
    map: textures.map,
    alphaMap: textures.alphaMap,
    alphaTest: 0.5,
    roughness: 0.8,
    side: THREE.DoubleSide,
    envMapIntensity: 0.8,
  });
  lit.depthWrite = false; // depth comes from the pre-pass
  lit.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGround;
        uniform vec3 uGroundColor;
        uniform float uGroundTile;
        varying vec3 vGrassColor;
        varying float vTip;
        ${GRASS_PARS}
        ${LAWN_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
        grassPlace();
        vec3 objectNormal = normal;
        objectNormal.xz = gRot * objectNormal.xz;
        // mostly-up normals: a lawn reads as one lit surface, like the ground under it
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.65));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif
      `)
      .replace('#include <begin_vertex>', `
        vec3 transformed = grassVertex(position, uv.y);
        // colour from the lawn texture under the tuft, with per-tuft variation
        vec2 gUv = gXZ / uGroundTile;
        vec3 gCol = textureLod(uGround, gUv, 4.0).rgb * uGroundColor * lawnMacro(uGround, gUv);
        gCol *= mix(0.85, 1.12, aRand.z) * vec3(mix(0.96, 1.06, aRand.x), 1.0, mix(0.9, 1.05, aRand.y));
        vGrassColor = gCol * 2.0; // the blade texture is a luminance ramp averaging ~0.5
        vTip = uv.y;
      `);
    shader.fragmentShader = patchSunShadow(shader.fragmentShader)
      .replace('#include <common>', `#include <common>
        varying vec3 vGrassColor;
        varying float vTip;`)
      .replace('#include <alphamap_fragment>', ALPHA_MIP)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vGrassColor;')
      // keep the up-biased normal on both faces
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        // sun shining through the blades when you look towards it
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 1.05, 0.6) * sunTransmission(normal, 1.0) * 0.45 * vTip;
      `);
  };
  lit.customProgramCacheKey = () => 'grass-v3';

  // Depth pre-pass (as for the tree leaves): grass seen at a low angle stacks
  // many alpha-tested layers per pixel; laying the nearest blade's depth down
  // first means only that one gets lit.
  const depth = new THREE.MeshDepthMaterial({
    alphaMap: textures.alphaMap,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    colorWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GRASS_PARS}`)
      .replace('#include <begin_vertex>', 'grassPlace();\nvec3 transformed = grassVertex(position, uv.y);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', ALPHA_MIP);
  };
  depth.customProgramCacheKey = () => 'grass-depth-v1';
  return { lit, depth };
}

/**
 * @param {THREE.Material} groundMat  the lawn material (grass map, colour, tile)
 * @param {Array} rects               mask rectangles, see paintMask
 */
export function createGrass(groundMat, rects) {
  const extent = 100; // mask covers +-100 m; beyond that it's lawn all the way
  grassUniforms.uMask.value = paintMask(rects, extent, 2048);
  grassUniforms.uMaskRect.value.set(-extent, -extent, 1 / (extent * 2), 1 / (extent * 2));
  grassUniforms.uGround.value = groundMat.map;
  grassUniforms.uGroundColor.value.copy(groundMat.color);
  grassUniforms.uGroundTile.value = groundMat.userData.tile;
  const textures = bladeTextures();

  const group = new THREE.Group();
  group.name = 'grass';
  const NEAR = 14;
  const layers = [
    // near: dense field of regular cards
    { radius: NEAR, fadeIn: [0, 0], perM2: 18, tuft: { cards: 3, segments: 3 } },
    // far: fewer, wider cards; fades in exactly where the near field fades out
    { radius: FAR, fadeIn: [NEAR * 0.62, NEAR * 0.95], perM2: 4.5, tuft: { cards: 2, segments: 2, width: CARD_W * 1.6 } },
  ];
  const meshes = layers.map((L, li) => {
    const geo = tuftGeometry(L.tuft);
    const side = L.radius * 2;
    const count = Math.round(side * side * L.perM2);
    const rnd = seeded(101 + li);
    const offsets = new Float32Array(count * 2);
    const rands = new Float32Array(count * 4);
    // jittered grid: even coverage without visible rows
    const n = Math.ceil(Math.sqrt(count));
    const cell = side / n;
    for (let i = 0; i < count; i++) {
      const gx = i % n, gz = Math.floor(i / n);
      offsets[i * 2] = (gx + rnd()) * cell;
      offsets[i * 2 + 1] = (gz + rnd()) * cell;
      for (let k = 0; k < 4; k++) rands[i * 4 + k] = rnd();
    }
    // shuffle so a lower instanceCount (quality presets) is still evenly spread
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      for (let k = 0; k < 2; k++) [offsets[i * 2 + k], offsets[j * 2 + k]] = [offsets[j * 2 + k], offsets[i * 2 + k]];
      for (let k = 0; k < 4; k++) [rands[i * 4 + k], rands[j * 4 + k]] = [rands[j * 4 + k], rands[i * 4 + k]];
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 4));
    geo.instanceCount = count;
    const { lit, depth } = grassMaterials(textures, {
      uniforms: {
        uRadius: { value: L.radius },
        uFadeIn: { value: new THREE.Vector2(...L.fadeIn) },
      },
    });
    const mesh = new THREE.Mesh(geo, lit);
    mesh.receiveShadow = true;
    const prepass = new THREE.Mesh(geo, depth);
    prepass.renderOrder = -1;
    for (const o of [mesh, prepass]) {
      o.frustumCulled = false; // the field is always around the camera
      o.matrixAutoUpdate = false;
      o.userData.noAO = true;
      o.userData.keep = true; // not a static mesh to merge
      o.raycast = () => {};
      group.add(o);
    }
    mesh.userData.full = count;
    return mesh;
  });

  // follow whichever camera is rendering; push blades aside when it's at walking height
  const follow = (renderer, scene, camera) => {
    const p = camera.position;
    grassUniforms.uCenter.value.copy(p);
    grassUniforms.uPusher.value.set(p.x, p.z, 1 - THREE.MathUtils.smoothstep(p.y, 1.9, 2.6));
  };
  for (const o of group.children) o.onBeforeRender = follow;

  return {
    group,
    /** 0..1 share of the tufts drawn (quality presets) */
    setDensity(k) {
      group.visible = k > 0;
      grassUniforms.uGrassOn.value = k > 0 ? 1 : 0;
      for (const m of meshes) m.geometry.instanceCount = Math.max(1, Math.round(m.userData.full * k));
    },
  };
}
