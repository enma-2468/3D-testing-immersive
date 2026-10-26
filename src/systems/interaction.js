import * as THREE from 'three';
import { findInteractive, invalidate } from './interaction-registry.js';

// Hover highlight: a warm additive layer drawn over the hovered object only.
// (Cheaper than an outline pass, which re-renders the whole scene every frame.)
const glowMat = new THREE.MeshBasicMaterial({
  color: '#ffcf8a',
  transparent: true,
  opacity: 0.16,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const noRaycast = () => {};

function addGlow(target) {
  const meshes = [];
  target.traverse((o) => { if (o.isMesh && !o.userData.glow) meshes.push(o); });
  return meshes.map((m) => {
    const g = new THREE.Mesh(m.geometry, glowMat);
    g.userData.glow = true;
    g.raycast = noRaycast;
    m.add(g);
    return g;
  });
}

// Hover highlight + click handling for anything registered with makeInteractive.
// Orbit mode picks under the mouse; walk mode picks under the crosshair.

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class Interaction {
  constructor({ camera, dom, roots, tooltip, crosshairLabel }) {
    this.camera = camera;
    this.dom = dom;
    this.roots = roots;
    this.tooltip = tooltip;
    this.crosshairLabel = crosshairLabel;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true; // BVH: nearest hit per mesh is all we need
    this.glow = [];
    this.ndc = new THREE.Vector2();
    this.hovered = null;
    this.enabled = true;
    this.walkMode = false;
    this.pendingMove = null;
    this.down = null;
    this.onAction = null; // optional callback (label) for UI feedback

    dom.addEventListener('pointermove', (e) => { this.pendingMove = e; });
    dom.addEventListener('pointerleave', () => { this.pendingMove = null; this.setHovered(null); });
    dom.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    dom.addEventListener('pointerup', (e) => {
      if (this.walkMode || !this.enabled || !this.down) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      if (moved > 5 || performance.now() - this.down.t > 600) return;
      const picked = this.pick(e.clientX, e.clientY);
      if (picked) this.activate(picked);
    });
  }

  pickNdc(x, y, maxDistance = Infinity) {
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.roots, true);
    for (const hit of hits) {
      if (!isShown(hit.object)) continue;
      const target = findInteractive(hit.object);
      const mat = hit.object.material;
      if (!target && mat && mat.transparent && mat.opacity < 0.3) continue; // look through plain glass
      return target ? { target, hit } : null;
    }
    return null;
  }

  pick(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    return this.pickNdc(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  activate({ target, hit }) {
    const label = this.labelOf(target); // what the tap is about to do, e.g. "Open the door"
    target.userData.interactive.onClick(hit);
    this.onAction?.(label);
    this.refreshLabel();
  }

  labelOf(target) {
    const l = target.userData.interactive.label;
    return typeof l === 'function' ? l() : l;
  }

  setHovered(target, clientX, clientY) {
    if (target !== this.hovered) {
      this.hovered = target;
      for (const g of this.glow) g.removeFromParent();
      this.glow = target ? addGlow(target) : [];
      invalidate();
      this.dom.style.cursor = target && !this.walkMode ? 'pointer' : '';
    }
    if (this.walkMode) {
      this.crosshairLabel.textContent = target ? this.labelOf(target) : '';
      this.crosshairLabel.parentElement.classList.toggle('on', !!target);
      return;
    }
    if (target) {
      this.tooltip.textContent = this.labelOf(target);
      this.tooltip.style.transform = `translate(${clientX + 16}px, ${clientY + 18}px)`;
      this.tooltip.classList.add('show');
    } else {
      this.tooltip.classList.remove('show');
    }
  }

  refreshLabel() {
    if (!this.hovered) return;
    const text = this.labelOf(this.hovered);
    if (this.walkMode) this.crosshairLabel.textContent = text;
    else this.tooltip.textContent = text;
  }

  // called once per frame
  update() {
    if (!this.enabled) {
      if (this.hovered) this.setHovered(null);
      return;
    }
    if (this.walkMode) {
      const picked = this.pickNdc(0, 0, 3.2);
      this.setHovered(picked ? picked.target : null);
      return;
    }
    const e = this.pendingMove;
    if (!e) return;
    this.pendingMove = null;
    if (e.buttons) { this.setHovered(null); return; }
    const picked = this.pick(e.clientX, e.clientY);
    this.setHovered(picked ? picked.target : null, e.clientX, e.clientY);
  }

  // walk mode "use" key / click
  useCentre() {
    const picked = this.pickNdc(0, 0, 3.2);
    if (picked) this.activate(picked);
  }

  /** A throwaway mesh using the hover material, so its shader can be compiled up front. */
  prewarmObject() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), glowMat);
    m.position.copy(this.camera.position);
    return m;
  }

  /** Touch walkthrough: use whatever was tapped, if it is within reach. */
  useAt(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    const picked = this.pickNdc(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 4.5);
    if (picked) this.activate(picked);
    return !!picked;
  }

  setWalkMode(on) {
    this.walkMode = on;
    this.tooltip.classList.remove('show');
    this.setHovered(null);
  }
}
