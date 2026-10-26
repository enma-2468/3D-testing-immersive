import { approach, invalidate } from './interaction-registry.js';

// Artificial lighting: facade spots, street lamps, per-room ceiling lights.
// Intensities fade smoothly. All artificial lights are shown or hidden
// together (an off light just has zero intensity): every change in the number
// of visible lights makes three.js rebuild every shader, so keeping it to
// exactly two states (none / all), both compiled up front, avoids hitches.

const EPS = 0.003;

export class Lighting {
  constructor({ house, site, materials }) {
    this.m = materials;
    this.facade = house.lights.facade.map((light) => ({ light, base: light.intensity }));
    this.street = site.streetLights.map((light) => ({ light, base: 30 }));
    this.lampMats = site.lampMats;
    this.rooms = house.lights.rooms;
    for (const r of this.rooms) {
      r.base = r.light ? r.light.intensity : 0;
      r.k = 0;
    }
    this.facadeOn = false;
    this.facadeK = 0;
    this.lightsShown = null;
  }

  setFacade(on) { this.facadeOn = on; invalidate(); }
  setInterior(on) {
    for (const r of this.rooms) r.on = on;
    invalidate();
  }
  get interiorOn() { return this.rooms.some((r) => r.on); }

  /** Force all artificial lights visible/hidden (used to pre-compile shaders). */
  setAllVisible(on) {
    for (const { light } of [...this.facade, ...this.street]) light.visible = on;
    for (const r of this.rooms) if (r.light) r.light.visible = on;
  }

  update(dt) {
    let changing = false;
    const step = (current, target, rate) => {
      const next = approach(current, target, rate, dt);
      if (Math.abs(next - target) > 1e-4) changing = true;
      return Math.abs(next - target) <= 1e-4 ? target : next;
    };

    this.facadeK = step(this.facadeK, this.facadeOn ? 1 : 0, 4);
    const fk = this.facadeK;
    for (const { light, base } of [...this.facade, ...this.street]) light.intensity = base * fk;
    this.m.ledStrip.emissiveIntensity = fk * 4.5;
    for (const mat of this.lampMats) mat.emissiveIntensity = fk * 7;

    let interiorActive = false;
    let anyOn = 0;
    for (const r of this.rooms) {
      r.k = step(r.k, r.on ? 1 : 0, 6);
      r.glow.emissiveIntensity = r.k * 7;
      if (r.on || r.k > EPS) interiorActive = true;
      anyOn = Math.max(anyOn, r.k);
    }
    for (const r of this.rooms) if (r.light) r.light.intensity = r.base * r.k;
    const anyActive = interiorActive || this.facadeOn || fk > EPS;
    if (anyActive !== this.lightsShown) {
      this.lightsShown = anyActive;
      this.setAllVisible(anyActive);
    }
    // bedside lamps & pendant globes share the base warm material
    this.m.lampWarm.emissiveIntensity = anyOn * 4;

    if (changing) invalidate();
  }
}
