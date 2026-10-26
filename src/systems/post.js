import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { GTAOShader } from 'three/addons/shaders/GTAOShader.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Post-processing chain:
//   scene -> 4x MSAA half-float target that also keeps its depth texture
//   -> view-space normals reconstructed from that depth in one cheap pass
//   -> GTAO ambient occlusion + denoise reading those normals
//      (so the scene is drawn once per frame, not twice)
//   -> bloom (night only) -> ACES tone mapping + sRGB output

export const QUALITY = {
  // AO always runs at full resolution: half-res AO leaves bright halos along edges
  // grass = share of the 3D grass tufts drawn; wind = plants move by default
  high: { label: 'High', pixelRatio: 2, shadow: 4096, ao: 1, aoSamples: 16, msaa: 4, grass: 1, wind: true },
  medium: { label: 'Medium', pixelRatio: 1.5, shadow: 2048, ao: 1, aoSamples: 12, msaa: 4, grass: 0.6, wind: true },
  // phones: no AO, but MSAA (cheap on tile-based mobile GPUs) and a sharp-enough pixel ratio
  low: { label: 'Low', pixelRatio: 1.5, shadow: 2048, ao: 0, aoSamples: 0, msaa: 4, grass: 0.3, wind: false },
};

/** Draws the scene into its own target (with depth), or straight into the composer's buffer. */
class ScenePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.target = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.target || readBuffer);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
}

// Reuses GTAOShader's depth helpers (getViewPosition, computeNormalFromDepth)
// to write packed view-space normals once per frame. Without this, GTAO and
// its denoiser rebuild a normal from 9 depth taps for every one of their samples.
function normalFromDepthMaterial() {
  const head = GTAOShader.fragmentShader.split('void main()')[0];
  return new THREE.ShaderMaterial({
    defines: { ...GTAOShader.defines, NORMAL_VECTOR_TYPE: 0 },
    uniforms: THREE.UniformsUtils.merge([GTAOShader.uniforms, {}]),
    vertexShader: GTAOShader.vertexShader,
    fragmentShader: `${head}
      void main() {
        float depth = getDepth(vUv);
        if (depth >= 1.0) { gl_FragColor = vec4(0.5, 0.5, 1.0, 1.0); return; }
        gl_FragColor = vec4(packNormalToRGB(computeNormalFromDepth(vUv)), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

/** Runs GTAO on the scene target and writes the composited result into the chain. */
class AOPass extends Pass {
  constructor(gtao, input, camera) {
    super();
    this.gtao = gtao;
    this.input = input;
    this.camera = camera;
    this.scale = 1;
    this.normalTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.normalMaterial = normalFromDepthMaterial();
    this.normalMaterial.uniforms.tDepth.value = input.depthTexture;
    this.quad = new FullScreenQuad(this.normalMaterial);
    gtao.setGBuffer(input.depthTexture, this.normalTarget.texture);
  }

  setSize(w, h) {
    const sw = Math.max(1, Math.round(w * this.scale));
    const sh = Math.max(1, Math.round(h * this.scale));
    this.gtao.setSize(sw, sh);
    this.normalTarget.setSize(sw, sh);
  }

  render(renderer, writeBuffer, readBuffer, dt, mask) {
    const u = this.normalMaterial.uniforms;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    u.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
    u.cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);
    renderer.setRenderTarget(this.normalTarget);
    this.quad.render(renderer);
    this.gtao.render(renderer, writeBuffer, this.input, dt, mask);
  }
}

/**
 * One complete post-processing pipeline. `scale` sets its internal resolution
 * relative to the canvas; the app keeps a full-res pipeline for still frames
 * and a reduced one for camera motion on slow GPUs (see main.js).
 */
export class Post {
  constructor(renderer, scene, camera, scale = 1, { aoScale = 1 } = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.aoScale = aoScale;
    this.quality = QUALITY.high;

    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);

    this.scenePass = new ScenePass(scene, camera);

    this.gtao = new GTAOPass(scene, camera, 1, 1);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 1;
    this.gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.aoPass = new AOPass(this.gtao, this.sceneTarget, camera); // also wires the G-buffer

    // high threshold: only real light sources (emissive > ~3 in linear HDR) bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.4, 3.0);
    this.bloom.enabled = false;
    this.output = new OutputPass();

    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.aoPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  setQuality(q) {
    this.quality = q;
    const ao = q.ao > 0;
    this.aoPass.enabled = ao;
    this.aoPass.scale = (q.ao || 1) * this.aoScale;
    this.scenePass.target = ao ? this.sceneTarget : null;
    if (ao && this.aoSamples !== q.aoSamples) {
      this.aoSamples = q.aoSamples;
      this.gtao.updateGtaoMaterial({ samples: q.aoSamples });
    }
    // MSAA lives on whichever target the scene is drawn into
    const setSamples = (target, n) => {
      if (target.samples !== n) {
        target.samples = n;
        target.dispose();
      }
    };
    setSamples(this.sceneTarget, q.msaa);
    setSamples(this.composer.renderTarget1, ao ? 0 : q.msaa);
    setSamples(this.composer.renderTarget2, ao ? 0 : q.msaa);
  }

  /** Size the internal targets for a canvas of w x h CSS pixels at pixel ratio pr. */
  resize(w, h, pr) {
    const r = pr * this.scale;
    this.composer.setPixelRatio(r);
    this.composer.setSize(w, h);
    this.sceneTarget.setSize(Math.round(w * r), Math.round(h * r));
  }

  setBloom(strength) {
    this.bloom.strength = strength;
    this.bloom.enabled = strength > 0;
  }

  render() {
    this.composer.render();
  }
}
