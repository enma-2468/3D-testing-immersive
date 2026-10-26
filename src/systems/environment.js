import * as THREE from 'three';
import { assetUrl, hdrLoader } from '../assets/loaders.js';
import { setFoliageSun } from '../world/vegetation.js';
import { setInteriorAmbient } from '../assets/materials.js';

// Image-based lighting from real HDR skies. For each sky we find the sun in
// the HDR itself (brightest pixel), rotate the sky so sunlight rakes across the
// facade, and align a shadow-casting directional light with it. Fog takes the
// sky's own horizon colour so the ground melts into the panorama.

// Poly Haven HDRIs are not on a common absolute scale (the night sky is
// exposed brighter than the day one), so each preset names the average sky
// luminance it wants and the intensity is derived from the measured HDR.
//   ambient   target mean sky luminance used for lighting
//   skyBoost  extra brightness for the visible background only
export const TIMES = {
  day: { label: 'Day', hdr: 'day', azimuth: -1.2, sun: 3.6, exposure: 0.82, ambient: 0.47, skyBoost: 1, lights: false, bloom: 0, fog: [45, 260], interior: 0.75 },
  sunset: { label: 'Sunset', hdr: 'sunset', azimuth: 0.9, sun: 3.0, exposure: 0.95, ambient: 0.3, skyBoost: 1.2, lights: true, bloom: 0.35, fog: [40, 240], interior: 0.4 },
  night: { label: 'Night', hdr: 'night', azimuth: -0.5, sun: 0.08, sunColor: '#9fb4ff', exposure: 1.0, ambient: 0.012, skyBoost: 6, lights: true, bloom: 0.5, fog: [30, 220], interior: 0.05 },
};

function analyse(tex) {
  const { data, width: W, height: H } = tex.image;
  const lum = (i) => data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  // Sun: brightest pixel in the upper hemisphere
  let best = -1, bestIdx = 0;
  for (let r = 0; r < H / 2; r++) {
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4;
      const l = lum(i);
      if (l > best) { best = l; bestIdx = r * W + c; }
    }
  }
  const row = Math.floor(bestIdx / W);
  const col = bestIdx % W;
  const v = 1 - (row + 0.5) / H;
  const u = (col + 0.5) / W;
  const lat = (v - 0.5) * Math.PI;
  const phi = (u - 0.5) * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
  const i = bestIdx * 4;
  const peak = Math.max(data[i], data[i + 1], data[i + 2]);
  const sunColor = new THREE.Color(data[i] / peak, data[i + 1] / peak, data[i + 2] / peak);

  // Horizon colour: average a band 1-5 degrees above the horizon
  const horizon = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let deg = 1; deg <= 5; deg++) {
    const r = Math.round((1 - (deg / 180 + 0.5)) * H);
    for (let c = 0; c < W; c += 4) {
      const k = (r * W + c) * 4;
      horizon.r += data[k];
      horizon.g += data[k + 1];
      horizon.b += data[k + 2];
      n++;
    }
  }
  horizon.multiplyScalar(1 / n);

  // Average sky luminance (upper hemisphere, cosine weighted), excluding the sun disc
  let sum = 0, wsum = 0;
  for (let r = 0; r < H / 2; r += 2) {
    const w = Math.cos((0.5 - (r + 0.5) / H) * Math.PI);
    for (let c = 0; c < W; c += 4) {
      const l = lum((r * W + c) * 4);
      sum += Math.min(l, 50) * w;
      wsum += w;
    }
  }
  return { dir, sunColor, horizon, skyLum: sum / wsum, sunLum: best };
}

export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cache = new Map();
    this.current = null;

    const sun = new THREE.DirectionalLight('#ffffff', 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const cam = sun.shadow.camera;
    cam.left = -17; cam.right = 17; cam.top = 17; cam.bottom = -17;
    cam.near = 1; cam.far = 140;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.025;
    sun.target.position.set(0, 3, 0);
    scene.add(sun, sun.target);
    this.sun = sun;

    scene.fog = new THREE.Fog('#cccccc', 45, 260);
  }

  prepare(name) {
    const preset = TIMES[name];
    if (!this.cache.has(preset.hdr)) {
      this.cache.set(preset.hdr, hdrLoader.loadAsync(assetUrl(`hdri/${preset.hdr}.hdr`)).then((tex) => {
        const info = analyse(tex);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const env = this.pmrem.fromEquirectangular(tex).texture;
        tex.dispose(); // the float source is no longer needed once prefiltered
        return { env, ...info };
      }));
    }
    return this.cache.get(preset.hdr);
  }

  async set(name) {
    const preset = TIMES[name];
    const data = await this.prepare(name);
    const scene = this.scene;

    // rotate the sky so the sun sits at the preset azimuth (azimuth = atan2(x, z))
    const texAz = Math.atan2(data.dir.x, data.dir.z);
    const theta = preset.azimuth - texAz;
    scene.environment = data.env;
    scene.background = data.env;
    scene.environmentRotation.set(0, theta, 0);
    scene.backgroundRotation.set(0, theta, 0);
    const intensity = preset.ambient / data.skyLum;
    scene.environmentIntensity = intensity;
    scene.backgroundIntensity = intensity * preset.skyBoost;
    scene.backgroundBlurriness = 0;

    const dir = data.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), theta);
    // keep the light a little above the horizon so it still casts sensible shadows
    if (dir.y < 0.12) { dir.y = 0.12; dir.normalize(); }
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 70);
    if (preset.sunColor) this.sun.color.set(preset.sunColor);
    else this.sun.color.copy(data.sunColor);
    this.sun.intensity = preset.sun;
    this.renderer.toneMappingExposure = preset.exposure;
    setFoliageSun(dir, this.sun.color, this.sun.intensity);
    setInteriorAmbient(preset.interior);

    scene.fog.color.copy(data.horizon).multiplyScalar(intensity * preset.skyBoost);
    scene.fog.near = preset.fog[0];
    scene.fog.far = preset.fog[1];
    this.current = name;
    return preset;
  }

  setShadowQuality(size) {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}
