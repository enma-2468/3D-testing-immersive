import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetUrl, textureLoader } from '../assets/loaders.js';
import { WIND_GLSL, wind, windVertex } from './wind.js';

// Trees, bushes and hedges built from real photographed foliage: every card is
// one scanned compound-leaf sprig (Poly Haven jacaranda maps, CC0 — the same
// leaf type as neem/gulmohar street trees). Cards are rooted inside the crown
// and point outward like twigs. What makes them read as real foliage:
//  - normals are bent outward from the crown centre, so the canopy shades
//    like a rounded mass instead of a pile of flat cards
//  - self-occlusion is baked per leaf: sprigs deep inside a clump, or low in
//    the crown, are darker, and every sprig darkens towards its stem
//  - leaves glow yellow-green where the sun shines through them (thin-leaf
//    translucency, masked by the shadow map so shaded leaves stay dark)
//  - wind: clumps sway together with the gusts, single sprigs flutter
// All cards are instanced (3 sprig shapes = 3 draw calls) with a depth pre-pass.

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// The three sprigs in the atlas: uv rectangle + where the stem starts.
// `flip` mirrors the card so the stem is always at the origin and the tip is +X.
const SPRIGS = [
  { u0: 0.155, u1: 0.99, v0: 0.53, v1: 0.975, pu: 0.163, pv: 0.773, flip: false, weight: 0.45 },
  { u0: 0.0, u1: 0.42, v0: 0.30, v1: 0.67, pu: 0.0, pv: 0.507, flip: false, weight: 0.25 },
  { u0: 0.24, u1: 1.0, v0: 0.0, v1: 0.42, pu: 1.0, pv: 0.197, flip: true, weight: 0.30 },
];
const ATLAS_METRES = 1.0; // the whole leaf atlas spans ~1 m of real foliage

function sprigGeometry(s) {
  const T = ATLAS_METRES;
  const xs = s.flip ? [(s.pu - s.u1) * T, (s.pu - s.u0) * T] : [(s.u0 - s.pu) * T, (s.u1 - s.pu) * T];
  const us = s.flip ? [s.u1, s.u0] : [s.u0, s.u1];
  const y0 = (s.v0 - s.pv) * T, y1 = (s.v1 - s.pv) * T;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([xs[0], y0, 0, xs[1], y0, 0, xs[1], y1, 0, xs[0], y1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([us[0], s.v0, us[1], s.v0, us[1], s.v1, us[0], s.v1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

function foliageTexture(name, srgb) {
  const t = textureLoader.load(assetUrl(`foliage/jacaranda/${name}`));
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Shared sun uniforms for the translucency term (updated when the sky changes)
export const sunUniforms = {
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
  uSunColor: { value: new THREE.Color(3, 3, 3) },
};

export function setFoliageSun(direction, color, intensity) {
  sunUniforms.uSunDir.value.copy(direction).normalize();
  sunUniforms.uSunColor.value.copy(color).multiplyScalar(intensity);
}

/**
 * Sunlight transmitted through thin leaves/blades, for any lit material.
 * `wrap` softens the back-face term (0 = only faces turned away from the sun
 * glow). Masked by the sun's shadow, so leaves in shade never glow: the light
 * loop's own shadow lookup is kept (see patchSunShadow) rather than sampling
 * the shadow map a second time.
 */
export const SUN_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  float gSunShadow = 1.0;
  vec3 sunTransmission(vec3 n, float wrap) {
    vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float back = saturate((dot(-n, L) + wrap) / (1.0 + wrap));
    float toward = saturate(dot(normalize(vViewPosition), -L));
    return uSunColor * back * (0.3 + 0.7 * toward * toward) * gSunShadow;
  }
`;

// The directional-light loop with the first light's (the sun's) shadow kept in gSunShadow
const LIGHTS_BEGIN_SUN = THREE.ShaderChunk.lights_fragment_begin.replace(
  /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \][^;]*;/,
  (line) => `${line.replace('directLight.color *=', 'float dirShadow =')}
    directLight.color *= dirShadow;
    #if UNROLLED_LOOP_INDEX == 0
      gSunShadow = dirShadow;
    #endif`,
);

/** Add SUN_GLSL to a lit fragment shader (after the shadow declarations). */
export function patchSunShadow(fragmentShader) {
  return fragmentShader
    .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${SUN_GLSL}`)
    .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN_SUN);
}

// Leaf-card wind (view-space offset after projection; identical in the lit
// pass and the depth pre-pass, so the pre-pass depth always matches).
// aCenter.xyz = clump centre, aCenter.w = how freely this plant moves.
const LEAF_WIND = windVertex('aCenter.xyz', 'aCenter.w * 0.07', `
  #ifdef USE_INSTANCING
    vec3 lfRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float lfPh = dot(lfRoot, vec3(12.9898, 7.233, 4.719));
    float lfTip = clamp(position.x / 0.45, 0.0, 1.0);
    wOff += vec3(sin(uTime * 6.3 + lfPh), sin(uTime * 5.1 + lfPh * 1.7) * 0.7, cos(uTime * 5.7 + lfPh * 0.8))
      * 0.02 * lfTip * aCenter.w * uWind * (0.5 + length(wOff) * 8.0);
  #endif
`);

function patchFoliage(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sunUniforms, wind.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aCenter;\nvarying float vStem;\n${WIND_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        #ifdef USE_INSTANCING
          // bend the card normal towards "away from the crown centre"
          vec3 lfWorld = (instanceMatrix * vec4(position, 1.0)).xyz;
          vec3 lfOut = transpose(mat3(instanceMatrix)) * normalize(lfWorld - aCenter.xyz);
          objectNormal = normalize(mix(normalize(objectNormal), normalize(lfOut), 0.7));
        #endif
        // leaflets near the stem sit in the shadow of the rest of the sprig
        vStem = mix(0.62, 1.0, clamp(position.x / 0.35, 0.0, 1.0));
      `)
      .replace('#include <project_vertex>', LEAF_WIND);
    shader.fragmentShader = patchSunShadow(shader.fragmentShader)
      .replace('#include <common>', '#include <common>\nvarying float vStem;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vStem;')
      // keep the bent normal on both faces of the card (no back-face flip)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        // the bent normals catch sky reflections at grazing angles and turn leaves frosty; keep a little sheen
        reflectedLight.indirectSpecular *= 0.4;
        // sunlight transmitted through thin leaves: warmer and more saturated than the leaf face
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.05, 1.1, 0.55) * sunTransmission(normal, 0.15) * 0.3;
      `);
  };
  material.customProgramCacheKey = () => 'foliage-v3';
}

function patchFoliageDepth(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aCenter;\n${WIND_GLSL}`)
      .replace('#include <project_vertex>', LEAF_WIND);
  };
  material.customProgramCacheKey = () => 'foliage-depth-v1';
}

// Leaf/bark materials are shared by every Vegetation set (near trees, far tree line)
let shared = null;
function sharedMaterials() {
  if (shared) return shared;
  const map = foliageTexture('leaves_diff.jpg', true);
  const alphaMap = foliageTexture('leaves_alpha.png', false);
  const normalMap = foliageTexture('leaves_nor.jpg', false);
  const arm = foliageTexture('leaves_arm.jpg', false);

  const leafMat = new THREE.MeshStandardMaterial({
    map,
    alphaMap,
    alphaTest: 0.5,
    normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: arm,
    roughness: 1,
    side: THREE.DoubleSide,
    envMapIntensity: 0.75,
  });
  patchFoliage(leafMat);
  leafMat.depthWrite = false; // depth comes from the pre-pass below

  // Depth pre-pass: alpha-tested cards can't use early-z, so without this every
  // leaf hidden behind another leaf would be fully shaded. The pre-pass lays the
  // nearest leaf depth down (pushed back a hair); the lit pass then shades only
  // the visible leaf pixels.
  const prepassMat = new THREE.MeshDepthMaterial({
    alphaMap,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    colorWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  patchFoliageDepth(prepassMat);
  const barkMap = (n, srgb) => { const t = foliageTexture(n, srgb); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const barkArm = barkMap('bark_arm.jpg', false);
  const bark = new THREE.MeshStandardMaterial({ map: barkMap('bark_diff.jpg', true), normalMap: barkMap('bark_nor.jpg', false), roughnessMap: barkArm, aoMap: barkArm, roughness: 1 });
  bark.color.setRGB(1.45, 1.38, 1.3); // the scan is shot dark; lift it to weathered grey-brown
  shared = { leafMat, prepassMat, bark };
  return shared;
}

const _v = new THREE.Vector3();

export class Vegetation {
  constructor(m) {
    this.m = m;
    this.cards = SPRIGS.map(() => ({ matrices: [], colors: [], centres: [] }));
    this.woodGeos = [];
    this.trunks = []; // [x, z, radius] for colliders
  }

  _pickSprig(rnd) {
    let r = rnd();
    for (let i = 0; i < SPRIGS.length; i++) {
      r -= SPRIGS[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  /** One leaf card rooted at `base`, pointing along `dir`. `shade` is baked self-occlusion. */
  _card(rnd, base, dir, scale, centre, tint, shade = 1, flex = 1) {
    const qAim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rnd() * Math.PI * 2);
    const q = qAim.multiply(qRoll);
    const type = this._pickSprig(rnd);
    const bucket = this.cards[type];
    bucket.matrices.push(new THREE.Matrix4().compose(base, q, new THREE.Vector3(scale, scale, scale)));
    const c = new THREE.Color().setHSL(tint.h + (rnd() - 0.5) * 0.03, tint.s, tint.l + (rnd() - 0.5) * 0.14);
    bucket.colors.push(c.multiplyScalar(shade));
    bucket.centres.push(centre.x, centre.y, centre.z, flex);
  }

  _limb(a, b, r0, r1) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r1, r0, len, 10, 1, true);
    // bark at real scale: ~0.6 m of bark per texture repeat
    const uv = geo.attributes.uv;
    const around = (2 * Math.PI * (r0 + r1)) / 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(0.5, around / 0.6), uv.getY(i) * (len / 0.6));
    geo.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    geo.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    this.woodGeos.push(geo);
  }

  /** A limb with a kink in the middle, so branches aren't ruler-straight. */
  _branch(rnd, a, b, r0, r1, kink = 0.12) {
    const len = a.distanceTo(b);
    const mid = a.clone().lerp(b, 0.5);
    mid.x += (rnd() - 0.5) * len * kink * 2;
    mid.z += (rnd() - 0.5) * len * kink * 2;
    mid.y += (rnd() - 0.3) * len * kink;
    const rm = (r0 + r1) / 2;
    this._limb(a, mid, r0, rm);
    this._limb(mid, b, rm, r1);
    return mid;
  }

  /**
   * Fill clumps with outward-pointing sprigs. Self-occlusion is baked into each
   * sprig's colour from how deep it sits in its clump and in the whole crown,
   * and how low it hangs (the underside of a canopy only sees the ground).
   */
  _fillClumps(rnd, clumps, { leafScale, density, tint, flex, droop = 0.25 }) {
    // crown bounds from the clumps
    const centre = new THREE.Vector3();
    let wsum = 0, lo = Infinity, hi = -Infinity;
    for (const [c, cr] of clumps) {
      centre.addScaledVector(c, cr * cr);
      wsum += cr * cr;
      lo = Math.min(lo, c.y - cr);
      hi = Math.max(hi, c.y + cr);
    }
    centre.multiplyScalar(1 / wsum);
    let reach = 0;
    for (const [c, cr] of clumps) reach = Math.max(reach, c.distanceTo(centre) + cr);

    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (const [c, cr] of clumps) {
      // clumps catching more sky are a touch yellower/lighter
      const top = THREE.MathUtils.clamp((c.y - lo) / Math.max(hi - lo, 0.1), 0, 1);
      const clumpTint = { h: tint.h + (top - 0.5) * 0.02, s: tint.s, l: tint.l + (top - 0.5) * 0.06 };
      const n = Math.round(cr * cr * 46 * density / (leafScale * leafScale));
      for (let k = 0; k < n; k++) {
        dir.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
        if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
        dir.normalize();
        dir.y = dir.y * 0.75 + 0.1; // clumps are a little flattened and sun-seeking
        const depth = 0.15 + Math.sqrt(rnd()) * 0.55;
        pos.copy(c).addScaledVector(dir, cr * depth);
        dir.y -= droop + rnd() * 0.2; // sprigs droop
        dir.normalize();

        const inClump = THREE.MathUtils.clamp((depth - 0.15) / 0.55, 0, 1);
        const inCrown = THREE.MathUtils.clamp(_v.subVectors(pos, centre).length() / reach, 0, 1);
        const height = THREE.MathUtils.clamp((pos.y - lo) / Math.max(hi - lo, 0.1), 0, 1);
        const shade = THREE.MathUtils.lerp(0.5, 1.0, Math.pow(inClump * 0.45 + inCrown * 0.55, 0.8)) * THREE.MathUtils.lerp(0.74, 1.0, height);
        this._card(rnd, pos, dir, leafScale * (0.75 + rnd() * 0.5), c, clumpTint, shade, flex);
      }
    }
  }

  /** Per-plant colour: neem-like greens, from yellowish to bluish, some darker. */
  _tint(rnd, base = 0.8) {
    return { h: 0.2 + rnd() * 0.075, s: 0.14 + rnd() * 0.14, l: base + (rnd() - 0.5) * 0.14 };
  }

  /**
   * A broadleaf tree grown like a real one: a gently curved trunk with a root
   * flare -> 4-6 kinked scaffold limbs -> secondary branches, each ending in a
   * dense clump of leaf sprigs. Branch tips sit inside their clumps, so no bare
   * sticks poke out of the crown, and the clumps give the billowy, gappy
   * silhouette of a real canopy. Extra clumps along the limbs fill the crown's
   * underside so it doesn't look like a lollipop.
   * shape: 'round' (spreading, neem/gulmohar-like) | 'tall' (upright, ashoka-like)
   */
  tree(x, z, { height = 7, spread = 2.6, shape = 'round', seed = 1, y = 0, density = 1, leafScale = 0.72, flex = 1 } = {}) {
    const rnd = seeded(seed * 7919 + 13);
    const tall = shape === 'tall';
    const trunkH = height * (tall ? 0.3 : 0.34) * (0.85 + rnd() * 0.25);
    const base = new THREE.Vector3(x, y, z);
    const lean = new THREE.Vector3((rnd() - 0.5) * 0.2, 1, (rnd() - 0.5) * 0.2).normalize();
    const r = 0.06 + height * 0.02;
    // trunk: three slightly offset sections, tapering, with a flared foot
    const p1 = base.clone().addScaledVector(lean, trunkH * 0.4).add(new THREE.Vector3((rnd() - 0.5) * r * 1.6, 0, (rnd() - 0.5) * r * 1.6));
    const p2 = base.clone().addScaledVector(lean, trunkH * 0.75).add(new THREE.Vector3((rnd() - 0.5) * r * 1.6, 0, (rnd() - 0.5) * r * 1.6));
    const top = base.clone().addScaledVector(lean, trunkH);
    this._limb(base.clone().setY(y - 0.1), base.clone().setY(y + 0.45), r * 1.9, r * 1.08); // root flare
    this._limb(base.clone().setY(y + 0.2), p1, r * 1.12, r * 1.0);
    this._limb(p1, p2, r * 1.0, r * 0.9);
    this._limb(p2, top, r * 0.9, r * 0.8);
    this.trunks.push([x, z, r + 0.05]);

    const crownTop = y + height;
    const clumps = []; // [centre, radius]
    const clumpR = (tall ? 0.36 : 0.42) * spread * (0.85 + rnd() * 0.3);

    // central leader keeps the crown full in the middle
    const leaderEnd = new THREE.Vector3(top.x + (rnd() - 0.5) * 0.3, crownTop - clumpR * 0.9, top.z + (rnd() - 0.5) * 0.3);
    this._branch(rnd, top, leaderEnd, r * 0.6, r * 0.2);
    clumps.push([leaderEnd, clumpR * 1.1]);
    clumps.push([top.clone().lerp(leaderEnd, 0.55), clumpR * 0.95]);

    const limbs = 4 + Math.floor(rnd() * 3);
    const az0 = rnd() * Math.PI * 2;
    for (let i = 0; i < limbs; i++) {
      const az = az0 + (i / limbs) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const elev = (tall ? 1.05 : 0.55) + rnd() * 0.35; // radians above horizontal
      const len = (tall ? 0.55 : 0.8) * spread * (0.8 + rnd() * 0.4) / Math.cos(elev * 0.6);
      const start = top.clone().addScaledVector(lean, -rnd() * trunkH * 0.18);
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
      const end = start.clone().addScaledVector(dir, len);
      end.y = Math.min(end.y, crownTop - clumpR * 0.6);
      const mid = this._branch(rnd, start, end, r * 0.55, r * 0.16);
      clumps.push([end, clumpR]);
      // a lower clump hanging off the limb fills the underside of the crown
      if (!tall && rnd() < 0.75) clumps.push([mid.clone().add(new THREE.Vector3(0, -clumpR * 0.25, 0)), clumpR * (0.65 + rnd() * 0.2)]);
      // two or three secondary branches off the outer half of the limb
      const subs = 2 + Math.floor(rnd() * 2);
      for (let j = 0; j < subs; j++) {
        const from = start.clone().lerp(end, 0.45 + rnd() * 0.4);
        const sAz = az + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6);
        const sElev = elev * (0.4 + rnd() * 0.6);
        const sDir = new THREE.Vector3(Math.cos(sAz) * Math.cos(sElev), Math.sin(sElev), Math.sin(sAz) * Math.cos(sElev));
        const tip = from.clone().addScaledVector(sDir, len * (0.35 + rnd() * 0.2));
        tip.y = Math.min(tip.y, crownTop - clumpR * 0.7);
        this._branch(rnd, from, tip, r * 0.22, r * 0.07, 0.18);
        clumps.push([tip, clumpR * (0.75 + rnd() * 0.25)]);
      }
    }

    this._fillClumps(rnd, clumps, { leafScale, density, tint: this._tint(rnd, 0.82), flex });
  }

  /**
   * Free-growing shrub: a mound of overlapping leaf clumps sitting on the
   * ground (no visible wood). size ~ height in metres.
   */
  bush(x, z, { size = 1, seed = 1, y = 0, density = 1, leafScale = 0.42, flex = 0.55 } = {}) {
    const rnd = seeded(seed * 4271 + 7);
    const clumps = [[new THREE.Vector3(x, y + size * 0.5, z), size * 0.55]];
    const n = 3 + Math.floor(rnd() * 3);
    const az0 = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const az = az0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.8;
      const d = size * (0.3 + rnd() * 0.25);
      clumps.push([new THREE.Vector3(x + Math.cos(az) * d, y + size * (0.28 + rnd() * 0.25), z + Math.sin(az) * d), size * (0.32 + rnd() * 0.16)]);
    }
    this._fillClumps(rnd, clumps, { leafScale, density, tint: this._tint(rnd, 0.7), flex, droop: 0.1 });
  }

  /** Clipped hedge filling an axis-aligned box. */
  hedge(x0, x1, z0, z1, height, seed = 3, y = 0) {
    const rnd = seeded(seed);
    const along = x1 - x0 > z1 - z0 ? 'x' : 'z';
    const area = (x1 - x0) * (z1 - z0) + ((x1 - x0) + (z1 - z0)) * height * 2;
    const count = Math.round(area * 110);
    const tint = { h: 0.24, s: 0.22, l: 0.6 };
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2;
    for (let i = 0; i < count; i++) {
      pos.set(x0 + rnd() * (x1 - x0), y + 0.1 + Math.pow(rnd(), 0.7) * (height - 0.35), z0 + rnd() * (z1 - z0));
      // how far inside the clipped surface this sprig grows, and how low
      const inside = Math.min(pos.x - x0, x1 - pos.x, pos.z - z0, z1 - pos.z, y + height - pos.y);
      const shade = THREE.MathUtils.lerp(1.0, 0.5, THREE.MathUtils.clamp(inside / 0.3, 0, 1))
        * THREE.MathUtils.lerp(0.7, 1.0, THREE.MathUtils.clamp((pos.y - y) / height, 0, 1));
      centre.set(along === 'x' ? pos.x : midX, y + height * 0.35, along === 'z' ? pos.z : midZ);
      dir.subVectors(pos, centre);
      dir.y = Math.max(dir.y, 0) + 0.15;
      dir.x += (rnd() - 0.5) * 0.6;
      dir.z += (rnd() - 0.5) * 0.6;
      dir.normalize();
      // pull the root inward so the clipped face is made of leaf tips
      pos.addScaledVector(dir, -0.22);
      this._card(rnd, pos, dir, 0.32 + rnd() * 0.12, centre, tint, shade, 0.22);
    }
  }

  build(parent, { castShadow = true } = {}) {
    const { leafMat, prepassMat, bark } = sharedMaterials();
    this.m.leaves = leafMat;

    let total = 0;
    SPRIGS.forEach((sprig, i) => {
      const { matrices, colors, centres } = this.cards[i];
      if (!matrices.length) return;
      const geo = sprigGeometry(sprig);
      geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centres), 4));
      const leaves = new THREE.InstancedMesh(geo, leafMat, matrices.length);
      matrices.forEach((mtx, k) => {
        leaves.setMatrixAt(k, mtx);
        leaves.setColorAt(k, colors[k]);
      });
      leaves.instanceMatrix.needsUpdate = true;
      leaves.castShadow = castShadow;
      leaves.receiveShadow = true;
      leaves.userData.noAO = true;
      leaves.raycast = () => {};
      leaves.computeBoundingSphere();
      leaves.boundingSphere.radius += 0.3; // room for wind sway
      parent.add(leaves);

      const prepass = new THREE.InstancedMesh(geo, prepassMat, matrices.length);
      prepass.instanceMatrix = leaves.instanceMatrix;
      prepass.boundingSphere = leaves.boundingSphere;
      prepass.renderOrder = -1;
      prepass.raycast = () => {};
      prepass.userData.noAO = true;
      parent.add(prepass);
      total += matrices.length;
    });

    if (this.woodGeos.length) {
      const wood = new THREE.Mesh(mergeGeometries(this.woodGeos), bark);
      wood.castShadow = castShadow;
      wood.receiveShadow = true;
      wood.raycast = () => {};
      parent.add(wood);
    }
    return total;
  }
}

/**
 * Let a scanned plant model (fern, flowers...) move in the wind: vertices
 * sway more the higher they sit above the model's origin.
 */
export function addModelWind(root, { amount = 0.12, height = 0.5 } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (mat.userData.wind) continue;
      mat.userData.wind = true;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, wind.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${WIND_GLSL}`)
          .replace('#include <project_vertex>', windVertex(
            '(modelMatrix * vec4(transformed, 1.0)).xyz',
            `${amount.toFixed(3)} * pow(clamp(((modelMatrix * vec4(transformed, 1.0)).y - modelMatrix[3].y) / ${height.toFixed(3)}, 0.0, 1.0), 1.5)`,
            `wOff += vec3(sin(uTime * 4.1 + wRoot.x * 9.0), 0.0, cos(uTime * 3.7 + wRoot.z * 9.0)) * length(wOff) * 0.35;`,
          ));
      };
      mat.customProgramCacheKey = () => `plant-wind-${amount}-${height}`;
      mat.needsUpdate = true;
    }
  });
}
