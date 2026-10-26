import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { LVL, ROOMS, feetInches } from '../config.js';

// Floating room tags (name + size in feet) shown in the cutaway / plan views.

export class RoomLabels {
  constructor(container, scene, onPick) {
    this.renderer = new CSS2DRenderer();
    this.renderer.domElement.className = 'labels-layer';
    container.appendChild(this.renderer.domElement);
    this.byLevel = { ground: [], first: [], roof: [] };
    for (const room of ROOMS) {
      const el = document.createElement('button');
      el.className = 'room-tag';
      const w = room.x1 - room.x0;
      const d = room.z1 - room.z0;
      el.innerHTML = `<span class="room-name">${room.name}</span><span class="room-size">${feetInches(w)} × ${feetInches(d)}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); onPick(room); });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      const obj = new CSS2DObject(el);
      obj.position.set((room.x0 + room.x1) / 2, LVL[room.level] + 0.05, (room.z0 + room.z1) / 2);
      obj.visible = false;
      scene.add(obj);
      this.byLevel[room.level].push(obj);
    }
  }

  show(level) {
    for (const [lvl, objs] of Object.entries(this.byLevel)) {
      for (const o of objs) o.visible = lvl === level;
    }
  }

  setSize(w, h) { this.renderer.setSize(w, h); }

  render(scene, camera) { this.renderer.render(scene, camera); }
}
