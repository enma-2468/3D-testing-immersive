import * as THREE from 'three';
import './ui/styles.css';

import { LVL } from './config.js';
import { manager } from './assets/loaders.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMaterials, setInteriorEnvironment, setMaxAnisotropy, setPaint, setStoneFinish, setWoodFinish } from './assets/materials.js';
import { buildHouse } from './world/house.js';
import { buildInterior } from './world/interior.js';
import { buildSite } from './world/site.js';
import { Environment, TIMES } from './systems/environment.js';
import { Lighting } from './systems/lighting.js';
import { Post, QUALITY } from './systems/post.js';
import { CameraRig, SHOTS } from './systems/camera-rig.js';
import { Walk } from './systems/walk.js';
import { Interaction } from './systems/interaction.js';
import { frame, invalidate, requestShadowUpdate, runAnimators } from './systems/interaction-registry.js';
import { optimiseWorld } from './systems/optimize.js';
import { updateWind } from './world/wind.js';
import { RoomLabels } from './ui/labels.js';
import { createUI } from './ui/ui.js';

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
setMaxAnisotropy(Math.min(16, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 1500);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const materials = createMaterials();
// neutral studio-room lighting used as the ambient/reflections for interior surfaces
setInteriorEnvironment(new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture);
const house = buildHouse(materials);
buildInterior(materials, house.levels);
const site = buildSite(materials);
scene.add(house.root, site.root);
// ~900 static boxes (walls, slats, treads, louvres...) -> a few dozen meshes
const merged = optimiseWorld([house.levels.ground, house.levels.first, house.levels.roof, site.root]);
if (import.meta.env.DEV) console.info(`merged ${merged.removed} static meshes into ${merged.created}`);

const env = new Environment(renderer, scene);
const lighting = new Lighting({ house, site, materials });
// Two pipelines: full resolution for still frames, and a 70% one used only
// while the camera moves, and only if this device proves too slow for smooth
// full-res motion. Each keeps its own targets, so switching costs nothing.
const MOTION_SCALE = 0.7;
const post = new Post(renderer, scene, camera, 1);
const motionPost = new Post(renderer, scene, camera, MOTION_SCALE, { aoScale: 0.5 });
const pipelines = [post, motionPost];
const rig = new CameraRig(camera, canvas);
const walk = new Walk(camera, document.body);

// ---------------------------------------------------------------------------
// App state + actions (the UI calls these)
// ---------------------------------------------------------------------------
const state = {
  time: 'day',
  cutaway: 'full',
  quality: defaultQuality(),
  wind: null, // null = follow the quality preset until the user picks
  savedOrbit: null,
  walkResume: null,
};

// Plants sway continuously, so wind means drawing every frame; slow presets start without it
const windOn = () => state.wind ?? QUALITY[state.quality].wind;

function defaultQuality() {
  if (matchMedia('(pointer: coarse)').matches || window.innerWidth < 760) return 'low';
  // integrated GPUs get the medium preset (half-res AO, 1.5x pixel ratio)
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  return /intel|mali|adreno|powervr|apple gpu|swiftshader/i.test(gpu) ? 'medium' : 'high';
}

const app = {
  async setTime(name) {
    if (!TIMES[name] || env.busy) return;
    env.busy = true;
    ui.fade(true);
    await new Promise((r) => setTimeout(r, 380));
    try {
      const preset = await env.set(name);
      state.time = name;
      lighting.setFacade(preset.lights);
      lighting.setInterior(preset.lights);
      for (const p of pipelines) p.setBloom(preset.bloom);
      ui.setTime(name);
      ui.setLights({ facade: preset.lights, interior: preset.lights });
      requestShadowUpdate();
    } catch (err) {
      console.error(err);
      ui.toast('Could not load that sky');
    }
    ui.fade(false);
    env.busy = false;
  },

  setCutaway(mode, frameIt = false) {
    state.cutaway = mode;
    house.levels.roof.visible = mode === 'full';
    house.levels.first.visible = mode !== 'ground';
    labels.show(mode === 'full' ? null : mode);
    ui.setCutaway(mode);
    requestShadowUpdate();
    if (frameIt && mode !== 'full') {
      app.flyTo(mode === 'ground' ? 'planGround' : 'planFirst', false);
    }
  },

  async flyTo(id, applyCutaway = true) {
    const shot = SHOTS[id];
    if (!shot || walk.active) return;
    if (applyCutaway && shot.cutaway !== state.cutaway) app.setCutaway(shot.cutaway);
    ui.setShot(id);
    await rig.fly(shot);
  },

  flyToRoom(room) {
    const cx = (room.x0 + room.x1) / 2;
    const cz = (room.z0 + room.z1) / 2;
    const y = LVL[room.level];
    rig.fly({ pos: [cx + 2.4, y + 5.2, cz + 4.6], target: [cx, y + 0.6, cz] }, 1.3);
    ui.setShot(null);
  },

  setFacadeLights(on) { lighting.setFacade(on); },
  setWind(on) {
    state.wind = on;
    ui.setWind(on);
    invalidate();
  },
  setInteriorLights(on) { lighting.setInterior(on); },

  setFinish(kind, key) {
    if (kind === 'stone') setStoneFinish(materials, key);
    if (kind === 'wood') setWoodFinish(materials, key);
    if (kind === 'paint') setPaint(materials, key);
    ui.setFinish(kind, key);
    invalidate();
  },

  setQuality(key) {
    const q = QUALITY[key];
    state.quality = key;
    for (const p of pipelines) p.setQuality(q);
    site.grass.setDensity(q.grass);
    ui.setWind(windOn());
    resize();
    perf.reset(); // re-measure: the new preset may be fast enough for full-res motion
    env.setShadowQuality(q.shadow);
    labels.setSize(window.innerWidth, window.innerHeight);
    ui.setQuality(key);
    requestShadowUpdate();
  },

  startWalk() {
    if (walk.active) return;
    state.savedOrbit = { pos: camera.position.toArray(), target: rig.controls.target.toArray() };
    app.setCutaway('full');
    // first time: start on the footpath in front of the gate
    const spawn = state.walkResume || { x: 2.1, y: 0.12, z: 8.9, lookAt: [2.1, 1.7, 0] };
    // mouse + keyboard get pointer-lock mouse look; phones and tablets get the touch controls
    if (walk.supported) walk.enter(spawn);
    else walk.enterTouch(spawn);
  },

  exitWalk() {
    walk.exit();
  },

  screenshot() {
    post.render();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `residence-${state.time}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      ui.toast('Screenshot saved');
    }, 'image/png');
  },

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  },
};

const ui = createUI(app);
// labels live in their own tiny scene so the label renderer never walks the whole world
const labelScene = new THREE.Scene();
const labels = new RoomLabels(document.getElementById('app'), labelScene, (room) => app.flyToRoom(room));
const interaction = new Interaction({
  camera,
  dom: canvas,
  roots: [house.root, site.root],
  tooltip: ui.tooltip,
  crosshairLabel: ui.crosshairLabel,
});

// ---------------------------------------------------------------------------
// Walk mode wiring
// ---------------------------------------------------------------------------
walk.addEventListener('enter', () => {
  rig.controls.enabled = false;
  interaction.setWalkMode(true);
  ui.setWalking(true, walk.touch);
  ui.setShot(null);
  if (walk.touch) ui.toast('Use the joystick to walk · drag to look');
});
walk.addEventListener('exit', () => {
  state.walkResume = { x: walk.feet.x, y: walk.feet.y, z: walk.feet.z, lookAt: camera.getWorldDirection(new THREE.Vector3()).add(camera.position).toArray() };
  interaction.setWalkMode(false);
  ui.setWalking(false);
  if (state.savedOrbit) rig.jump(state.savedOrbit);
  rig.controls.enabled = true;
});
document.addEventListener('mousedown', (e) => {
  if (walk.active && !walk.touch && e.button === 0) interaction.useCentre();
});
// touch walkthrough: joystick to move, drag to look, tap things to use them
walk.attachTouchLook(canvas);
walk.attachJoystick(ui.joystick, ui.joystickKnob);
walk.addEventListener('tap', (e) => interaction.useAt(e.detail.x, e.detail.y));
// on touch screens there is no hover tooltip, so confirm every tap with a short toast
interaction.onAction = (label) => { if (ui.touch) ui.toast(label); };

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
const shotKeys = Object.keys(SHOTS);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.repeat) return;
  if (walk.active) {
    if (e.code === 'KeyE') interaction.useCentre();
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && shotKeys[n - 1]) app.flyTo(shotKeys[n - 1]);
  else if (e.code === 'KeyF') app.startWalk();
  else if (e.code === 'KeyT') {
    const names = Object.keys(TIMES);
    app.setTime(names[(names.indexOf(state.time) + 1) % names.length]);
  } else if (e.code === 'KeyL') {
    const on = !lighting.interiorOn;
    lighting.setInterior(on);
    ui.setLights({ facade: lighting.facadeOn, interior: on });
  } else if (e.code === 'KeyC') {
    const modes = ['full', 'first', 'ground'];
    app.setCutaway(modes[(modes.indexOf(state.cutaway) + 1) % modes.length], true);
  } else if (e.code === 'KeyP') app.screenshot();
  else if (e.code === 'KeyH') ui.toggleHelp();
});

// ---------------------------------------------------------------------------
// Resize + loop
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 62 : 45; // keep the whole facade in frame on portrait screens
  camera.updateProjectionMatrix();
  const pr = Math.min(window.devicePixelRatio || 1, post.quality.pixelRatio);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  for (const p of pipelines) p.resize(w, h, pr);
  labels.setSize(w, h);
  invalidate();
}

// Watches frame times during camera motion. If full-res frames can't keep up
// (slower than ~48 fps), motion switches to the reduced pipeline; the moment
// the camera stops, one full-quality frame is drawn, so still images are
// never degraded. Fast GPUs never leave full resolution.
const perf = {
  adaptive: false,
  ema: 16,
  samples: 0,
  last: 0,
  reset() { this.adaptive = false; this.ema = 16; this.samples = 0; },
  track(now, moving) {
    const interval = now - this.last;
    this.last = now;
    if (!moving || this.adaptive || interval > 100) return; // only consecutive motion frames count
    this.ema = this.ema * 0.9 + interval * 0.1;
    if (++this.samples > 20 && this.ema > 21) this.adaptive = true;
  },
};
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
const lastView = new THREE.Matrix4();
let lastFrameWasMotion = false;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  runAnimators(dt, clock.elapsedTime);
  if (walk.active) walk.update(dt);
  else rig.update(dt);
  lighting.update(dt);
  interaction.update();
  if (updateWind(clock.elapsedTime, windOn())) frame.dirty = true;

  camera.updateMatrixWorld();
  const moving = !camera.matrixWorld.equals(lastView);
  // Render on demand: a still view costs nothing; anything that changes calls invalidate().
  // After motion rendered at reduced resolution, one full-quality frame refines the view.
  if (!moving && !frame.dirty && !lastFrameWasMotion) return;
  lastView.copy(camera.matrixWorld);
  frame.dirty = false;
  if (frame.shadows) {
    renderer.shadowMap.needsUpdate = true;
    frame.shadows = false;
  }
  perf.track(performance.now(), moving);
  const useMotion = moving && perf.adaptive;
  (useMotion ? motionPost : post).render();
  lastFrameWasMotion = useMotion;
  labels.render(labelScene, camera);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
manager.onProgress = (url, loaded, total) => {
  ui.setProgress(loaded, total, url);
  requestShadowUpdate(); // newly streamed furniture casts shadows too
};
const everythingLoaded = new Promise((resolve) => { manager.onLoad = resolve; });

async function boot() {
  app.setQuality(state.quality);
  ui.setFinish('stone', 'nero');
  ui.setFinish('wood', 'teak');
  ui.setFinish('paint', 'white');
  ui.setCutaway('full');
  resize();
  rig.jump(SHOTS.aerial);

  // all three skies are prefiltered during loading so switching never stalls
  const skies = Promise.all([env.prepare('sunset'), env.prepare('night')]);
  await env.set('day');
  ui.setTime('day');
  ui.setLights({ facade: false, interior: false });
  // don't hold the user hostage to a slow asset: show the scene after 25 s regardless
  await Promise.race([Promise.all([everythingLoaded, skies]), new Promise((r) => setTimeout(r, 25000))]);
  ui.setProgress(1, 1, 'compiling shaders');
  await compileShaders(false);
  post.render(); // compiles the post-processing shaders too (shared by both pipelines)
  motionPost.render();
  requestShadowUpdate();
  renderer.setAnimationLoop(tick);
  ui.hideLoader();
  app.flyTo('front');
  setTimeout(() => compileShaders(true), 500);
  if (import.meta.env.DEV) window.__residence = { ready: true, app, scene, camera, renderer, rig, env, walk, house, site, post, motionPost, lighting, perf, interaction };
}

// Shaders depend on how many lights are visible, and on the render target
// (the scene renders into an off-screen HDR target, so no tone mapping in the
// material shaders). Compile the daylight set before showing the scene, then
// queue the "lights on" set, which the driver builds in parallel
// (KHR_parallel_shader_compile). Switching lights later never compiles anything.
function compileShaders(lightsOn) {
  lighting.setAllVisible(lightsOn);
  const glow = interaction.prewarmObject();
  scene.add(glow);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(post.sceneTarget);
  const done = renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(previous);
  scene.remove(glow);
  lighting.setAllVisible(false);
  lighting.lightsShown = null;
  return done;
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loader-text').textContent = 'Something went wrong — see the console';
});
