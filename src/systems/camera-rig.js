import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LVL } from '../config.js';

const G = LVL.ground, F = LVL.first, R = LVL.roof;

// Named viewpoints. `cutaway` says which levels must be visible for the shot.
export const SHOTS = {
  front: { label: 'Front', pos: [0.6, 4.6, 23], target: [0.2, 4.1, 1], cutaway: 'full' },
  street: { label: 'Street', pos: [14.5, 1.8, 16.5], target: [0, 3.6, 2], cutaway: 'full' },
  aerial: { label: 'Aerial', pos: [-17, 19, 21], target: [0, 2.5, -0.5], cutaway: 'full' },
  entrance: { label: 'Entrance', pos: [5.2, 1.65, 10.4], target: [2.2, 2.1, 4.2], cutaway: 'full' },
  living: { label: 'Living', pos: [3.75, G + 1.55, 4.0], target: [0.4, G + 1.0, 1.2], cutaway: 'full' },
  dining: { label: 'Dining', pos: [3.8, G + 1.6, 0.4], target: [1.0, G + 0.9, -4.5], cutaway: 'full' },
  lounge: { label: 'Lounge', pos: [2.9, F + 1.55, 0.9], target: [1.2, F + 1.2, 6.5], cutaway: 'full' },
  terrace: { label: 'Terrace', pos: [3.7, R + 1.7, 5.4], target: [-2.0, R + 1.0, 1.4], cutaway: 'full' },
  planGround: { label: 'Ground plan', pos: [0.4, 21, 2.6], target: [0, 0, -1.2], cutaway: 'ground' },
  planFirst: { label: 'First plan', pos: [0.4, 24, 2.6], target: [0, F, -1.2], cutaway: 'first' },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.495;
    c.minDistance = 0.4;
    c.maxDistance = 80;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    this.flight = null;
  }

  jump(shot) {
    this.camera.position.fromArray(shot.pos);
    this.controls.target.fromArray(shot.target);
    this.controls.update();
    this.jumped = true;
  }

  fly(shot, duration = 1.6) {
    const from = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    const to = { pos: new THREE.Vector3().fromArray(shot.pos), target: new THREE.Vector3().fromArray(shot.target) };
    // lift the path over the house when travelling far, so we don't fly through walls
    const dist = from.pos.distanceTo(to.pos);
    const arc = Math.min(8, dist * 0.25);
    return new Promise((resolve) => {
      this.flight = { from, to, t: 0, duration, arc, resolve };
    });
  }

  get flying() { return !!this.flight; }

  /** Advances the camera; returns true if it moved (so a new frame is needed). */
  update(dt) {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = ease(f.t);
      this.camera.position.lerpVectors(f.from.pos, f.to.pos, k);
      this.camera.position.y += Math.sin(k * Math.PI) * f.arc;
      this.controls.target.lerpVectors(f.from.target, f.to.target, k);
      this.camera.lookAt(this.controls.target);
      if (f.t >= 1) {
        this.flight = null;
        this.controls.update();
        f.resolve();
      }
      return true;
    }
    const jumped = this.jumped;
    this.jumped = false;
    return (this.controls.enabled && this.controls.update()) || jumped;
  }
}
