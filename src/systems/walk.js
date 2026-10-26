import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { collide, groundHeight, updateDynamic } from './physics.js';

// First-person walkthrough with stairs, gravity and collisions against the
// walls, furniture, doors and gate. Two input modes:
//  - desktop: pointer-lock mouse look + WASD
//  - touch:   on-screen joystick to move, drag anywhere to look, tap to use

const EYE = 1.62;
const RADIUS = 0.24;
const BODY = 1.75;
const STEP = 0.42;
const LOOK_SPEED = 0.0055; // radians per CSS pixel of drag
const JOYSTICK_RADIUS = 46;

export class Walk extends EventTarget {
  constructor(camera, dom) {
    super();
    this.camera = camera;
    this.controls = new PointerLockControls(camera, dom);
    this.feet = new THREE.Vector3();
    this.vy = 0;
    this.bob = 0;
    this.keys = {};
    this.stick = new THREE.Vector2(); // touch joystick, x = right, y = forward
    this.active = false;
    this.touch = false;
    this.spawn = null;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this.controls.addEventListener('lock', () => this._begin(false));
    this.controls.addEventListener('unlock', () => this._end());

    window.addEventListener('keydown', (e) => { if (this.active) this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.stick.set(0, 0); });
  }

  /** Mouse + keyboard with pointer lock available? */
  get supported() {
    return 'requestPointerLock' in document.body && !matchMedia('(pointer: coarse)').matches;
  }

  /** spawn: { x, y, z, lookAt: [x, y, z] } — or null to resume where we left off */
  enter(spawn) {
    this.spawn = spawn;
    this.vy = 0;
    this.controls.lock();
  }

  enterTouch(spawn) {
    this.spawn = spawn;
    this.vy = 0;
    this._begin(true);
  }

  exit() {
    if (this.touch) this._end();
    else this.controls.unlock();
  }

  _begin(touch) {
    this.active = true;
    this.touch = touch;
    if (this.spawn) {
      this.feet.set(this.spawn.x, this.spawn.y, this.spawn.z);
      this.camera.position.set(this.feet.x, this.feet.y + EYE, this.feet.z);
      this.camera.lookAt(this.spawn.lookAt[0], this.spawn.lookAt[1], this.spawn.lookAt[2]);
      this.spawn = null;
    }
    this.dispatchEvent(new Event('enter'));
  }

  _end() {
    if (!this.active) return;
    this.active = false;
    this.touch = false;
    this.keys = {};
    this.stick.set(0, 0);
    this.dispatchEvent(new Event('exit'));
  }

  /** Touch look: drag anywhere on the view; a short tap is reported as a 'tap' event. */
  attachTouchLook(dom) {
    let look = null;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active || !this.touch || look) return;
      look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
    });
    dom.addEventListener('pointermove', (e) => {
      if (!look || e.pointerId !== look.id) return;
      const dx = e.clientX - look.x;
      const dy = e.clientY - look.y;
      look.x = e.clientX;
      look.y = e.clientY;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= dx * LOOK_SPEED;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x - dy * LOOK_SPEED, -1.35, 1.35);
      this.camera.quaternion.setFromEuler(this.euler);
    });
    const end = (e) => {
      if (!look || e.pointerId !== look.id) return;
      const moved = Math.hypot(e.clientX - look.sx, e.clientY - look.sy);
      if (e.type === 'pointerup' && moved < 10 && performance.now() - look.t < 400) {
        this.dispatchEvent(new CustomEvent('tap', { detail: { x: e.clientX, y: e.clientY } }));
      }
      look = null;
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
  }

  /** On-screen joystick: `base` is the ring, `knob` the thumb. */
  attachJoystick(base, knob) {
    let id = null;
    const set = (e) => {
      const r = base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) { dx *= JOYSTICK_RADIUS / len; dy *= JOYSTICK_RADIUS / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.set(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
    };
    base.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      base.setPointerCapture(id);
      base.classList.add('active');
      set(e);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      base.classList.remove('active');
      knob.style.transform = '';
      this.stick.set(0, 0);
    };
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
  }

  update(dt) {
    if (!this.active) return;
    updateDynamic();
    const k = this.keys;
    const run = k.ShiftLeft || k.ShiftRight || this.stick.length() > 0.97;
    const speed = (run ? 3.4 : 1.7) * dt;
    let fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + this.stick.y;
    let side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + this.stick.x;
    const len = Math.hypot(fwd, side);
    if (len > 1) { fwd /= len; side /= len; }
    const moving = len > 0.05;

    // move in two half-steps so fast movement can't tunnel through thin partitions
    for (let i = 0; i < 2; i++) {
      this.camera.position.x = this.feet.x;
      this.camera.position.z = this.feet.z;
      if (moving) {
        this.camera.updateMatrix();
        this.controls.moveForward(fwd * speed * 0.5);
        this.controls.moveRight(side * speed * 0.5);
      }
      this.feet.x = this.camera.position.x;
      this.feet.z = this.camera.position.z;
      collide(this.feet, RADIUS, BODY, STEP);
    }

    // stand on the highest walkable surface we can step onto; otherwise fall
    const floorY = groundHeight(this.feet.x, this.feet.z, this.feet.y + STEP);
    if (floorY >= this.feet.y || (this.vy === 0 && this.feet.y - floorY <= STEP)) {
      // step up, or step down a stair, without "falling"
      this.feet.y = floorY;
      this.vy = 0;
    } else {
      this.vy -= 9.8 * dt;
      this.feet.y = Math.max(floorY, this.feet.y + this.vy * dt);
      if (this.feet.y === floorY) this.vy = 0;
    }

    // smooth the eye height over steps, plus a subtle head bob
    this.bob = moving ? this.bob + dt * (run ? 11 : 8) : this.bob * 0.9;
    const targetEye = this.feet.y + EYE + Math.sin(this.bob) * (moving ? 0.025 : 0);
    const y = this.camera.position.y;
    this.camera.position.set(this.feet.x, y + (targetEye - y) * Math.min(1, dt * 14), this.feet.z);
  }
}
