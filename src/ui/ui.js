import { SHOTS } from '../systems/camera-rig.js';
import { TIMES } from '../systems/environment.js';
import { QUALITY } from '../systems/post.js';
import { PALETTES } from '../assets/materials.js';

// One markup for every screen size. Desktop: brand card, floor rail, view dock,
// side panel. Phones (<= 820px): compact top bar, bottom tab bar, bottom sheets
// that swipe down to close, and a touch walkthrough HUD (joystick + drag-to-look).

// Line icons (24x24, stroke = currentColor)
const I = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5"/><path d="M12 17.5h.01"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M9 12l2-4 4 2 2 3M11 8l-3 2-1 3"/>',
  house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  floor: '<path d="M4 6h16v12H4z"/><path d="M4 12h9M13 6v12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunset: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0"/><path d="M12 4v4M5 9l1.5 1.5M19 9l-1.5 1.5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  views: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 4"/>',
  street: '<path d="M4 20L9 4M20 20L15 4M12 6v2M12 11v2M12 16v2"/>',
  aerial: '<path d="M2 12l9-2 3-7 2 1-1 6 6 2v2l-6 0-1 5-2 1-1-6-9-1z"/>',
  door: '<path d="M6 21V4h12v17M3 21h18"/><path d="M14 12h.01"/>',
  sofa: '<path d="M4 12V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 12h18v5H3zM5 17v2M19 17v2"/>',
  table: '<path d="M3 9h18M5 9v10M19 9v10M8 9V6h8v3"/>',
  terrace: '<path d="M3 20h18M5 20v-8M19 20v-8M3 12h18M7 12V8l5-4 5 4v4"/>',
  plan: '<path d="M4 4h16v16H4z"/><path d="M4 11h7v9M11 4v4M15 11h5"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[name]}</svg>`;

const SHOT_META = {
  front: { icon: 'house', group: 'Outside' },
  street: { icon: 'street', group: 'Outside' },
  aerial: { icon: 'aerial', group: 'Outside' },
  entrance: { icon: 'door', group: 'Outside' },
  living: { icon: 'sofa', group: 'Inside' },
  dining: { icon: 'table', group: 'Inside' },
  lounge: { icon: 'sofa', group: 'Inside' },
  terrace: { icon: 'terrace', group: 'Inside' },
  planGround: { icon: 'plan', group: 'Plans' },
  planFirst: { icon: 'plan', group: 'Plans' },
};

const SWATCH = {
  stone: { nero: 'linear-gradient(135deg,#151515 0 40%,#d8d8d8 41% 43%,#151515 44% 70%,#9a9a9a 71% 72%,#151515 73%)', emperador: 'linear-gradient(135deg,#3e2c22 0 45%,#b48a66 46% 48%,#3e2c22 49%)', statuario: 'linear-gradient(135deg,#f1f0ec 0 45%,#a9a9a9 46% 47%,#f1f0ec 48%)' },
};

const CUTAWAYS = [
  ['full', 'house', 'Exterior', 'The whole house and garden'],
  ['first', 'layers', 'First floor', 'Roof lifted off: bedrooms, lounge, balcony'],
  ['ground', 'floor', 'Ground floor', 'Living, dining, kitchen, bedrooms'],
];

export function createUI(app) {
  const hud = document.getElementById('hud');
  const touch = matchMedia('(hover: none)').matches;

  const shotChips = Object.entries(SHOTS)
    .map(([id, s]) => `<button class="chip" data-shot="${id}">${s.label}</button>`).join('');
  const shotGroups = ['Outside', 'Inside', 'Plans'].map((group) => `
      <h3>${group}</h3>
      <div class="shot-grid">${Object.entries(SHOTS).filter(([id]) => SHOT_META[id].group === group)
    .map(([id, s]) => `<button class="shot-card" data-shot="${id}">${icon(SHOT_META[id].icon)}<span>${s.label}</span></button>`).join('')}</div>`).join('');
  const timeButtons = Object.entries(TIMES)
    .map(([id, t]) => `<button data-time="${id}">${icon(id === 'day' ? 'sun' : id === 'sunset' ? 'sunset' : 'moon')}<span>${t.label}</span></button>`).join('');
  const qualityButtons = Object.entries(QUALITY)
    .map(([id, q]) => `<button data-quality="${id}"><span>${q.label}</span></button>`).join('');
  const swatches = (kind) => Object.entries(PALETTES[kind]).map(([id, p]) => {
    const bg = SWATCH[kind]?.[id] || p.color;
    return `<button class="swatch" data-finish="${kind}:${id}" title="${p.label}" aria-label="${p.label}" style="--sw:${bg}"></button>`;
  }).join('');
  const cutawayRail = CUTAWAYS.map(([id, ic, label]) => `<button data-cutaway="${id}">${icon(ic)}<span>${label}</span></button>`).join('');
  const cutawayCards = CUTAWAYS.map(([id, ic, label, sub]) => `
      <button class="floor-card" data-cutaway="${id}">${icon(ic)}<span><b>${label}</b><small>${sub}</small></span></button>`).join('');
  const handle = '<div class="sheet-handle" data-drag></div>';

  hud.innerHTML = `
    <div class="loader" id="loader">
      <div class="loader-inner">
        <div class="loader-mark">${icon('house')}</div>
        <h1>Residence 30 × 51</h1>
        <p>Loading scanned materials, HDR sky and furniture…</p>
        <div class="bar"><span id="loader-bar"></span></div>
        <div class="loader-meta"><span id="loader-text">Starting</span><span id="loader-pct">0%</span></div>
      </div>
    </div>
    <div class="fade" id="fade"><div class="spinner"></div></div>

    <header class="glass brand">
      <div class="brand-title">Residence 30 × 51</div>
      <div class="brand-sub">Modern G+1 · 4 bedrooms · roof terrace</div>
      <dl class="stats">
        <div><dt>Plot</dt><dd>1,530 ft²</dd></div>
        <div><dt>Built-up</dt><dd>2,250 ft²</dd></div>
        <div><dt>Floors</dt><dd>G + 1</dd></div>
      </dl>
    </header>

    <div class="top-actions">
      <button class="icon-btn desktop-only" data-action="screenshot" title="Save a screenshot (P)" aria-label="Save a screenshot">${icon('camera')}</button>
      <button class="icon-btn" data-action="fullscreen" title="Fullscreen" aria-label="Fullscreen">${icon('expand')}</button>
      <button class="icon-btn" data-action="help" title="Controls (H)" aria-label="Help">${icon('help')}</button>
      <button class="icon-btn desktop-only" data-action="settings" title="Scene settings" aria-label="Scene settings">${icon('sliders')}</button>
    </div>

    <nav class="glass views desktop-only" aria-label="View mode">${cutawayRail}</nav>

    <div class="scrim" id="scrim"></div>

    <aside class="glass panel sheet" id="panel" data-sheet="scene" aria-label="Scene settings">
      ${handle}
      <div class="panel-head"><h2>Scene</h2><button class="icon-btn small" data-action="close" aria-label="Close">${icon('close')}</button></div>
      <section>
        <h3>Time of day</h3>
        <div class="segmented">${timeButtons}</div>
      </section>
      <section>
        <h3>Lighting</h3>
        <label class="toggle"><span>Facade &amp; garden</span><input type="checkbox" id="t-facade"><i></i></label>
        <label class="toggle"><span>Interior lights</span><input type="checkbox" id="t-interior"><i></i></label>
      </section>
      <section>
        <h3>Nature</h3>
        <label class="toggle"><span>Wind in trees &amp; grass</span><input type="checkbox" id="t-wind"><i></i></label>
      </section>
      <section>
        <h3>Finishes</h3>
        <div class="finish-row"><span>Feature stone</span><div class="swatches">${swatches('stone')}</div></div>
        <div class="finish-row"><span>Timber</span><div class="swatches">${swatches('wood')}</div></div>
        <div class="finish-row"><span>Wall paint</span><div class="swatches">${swatches('paint')}</div></div>
      </section>
      <section>
        <h3>Render quality</h3>
        <div class="segmented">${qualityButtons}</div>
      </section>
      <section class="mobile-only">
        <button class="wide-btn" data-action="screenshot">${icon('camera')}<span>Save screenshot</span></button>
      </section>
    </aside>

    <section class="glass sheet mobile-only" data-sheet="views" aria-label="Camera views">
      ${handle}
      <div class="panel-head"><h2>Views</h2><button class="icon-btn small" data-action="close" aria-label="Close">${icon('close')}</button></div>
      ${shotGroups}
    </section>

    <section class="glass sheet mobile-only" data-sheet="floors" aria-label="Floors">
      ${handle}
      <div class="panel-head"><h2>Floors</h2><button class="icon-btn small" data-action="close" aria-label="Close">${icon('close')}</button></div>
      <div class="floor-list">${cutawayCards}</div>
      <p class="sheet-note">Tap a room label to fly into that room.</p>
    </section>

    <div class="dock desktop-only">
      <button class="walk-btn" data-action="walk">${icon('walk')}<span>Walk through</span><kbd>F</kbd></button>
      <div class="shots glass" role="toolbar" aria-label="Camera views">${shotChips}</div>
    </div>

    <nav class="tabbar glass mobile-only" aria-label="Main">
      <button data-tab="views">${icon('views')}<span>Views</span></button>
      <button data-tab="floors">${icon('layers')}<span>Floors</span></button>
      <button data-action="walk" class="tab-primary">${icon('walk')}<span>Walk</span></button>
      <button data-tab="scene">${icon('sliders')}<span>Scene</span></button>
    </nav>

    <div class="tooltip" id="tooltip"></div>
    <div class="crosshair" id="crosshair"><i></i><span id="crosshair-label"></span></div>
    <div class="walk-help glass">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
      <span><kbd>Shift</kbd> run</span>
      <span><kbd>Click</kbd>/<kbd>E</kbd> open · switch</span>
      <span><kbd>Esc</kbd> exit</span>
    </div>
    <div class="touch-walk">
      <button class="walk-exit glass" data-action="exit-walk">${icon('close')}<span>Exit walk</span></button>
      <div class="walk-tip glass">Drag to look · tap doors, lights &amp; fans</div>
      <div class="joystick" id="joystick" aria-label="Move"><div class="joystick-knob" id="joystick-knob"></div></div>
    </div>
    <div class="toast" id="toast" role="status"></div>

    <div class="modal" id="help" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="glass modal-card">
        <div class="panel-head"><h2 id="help-title">How to explore</h2><button class="icon-btn small" data-action="help" aria-label="Close">${icon('close')}</button></div>
        <div class="help-grid">
          ${touch ? `
          <h3>Look around</h3>
          <p>Drag with one finger to orbit · pinch to zoom · drag with two fingers to pan.</p>
          <p>Tap doors, the gate, balcony doors, lights, fans and TVs to use them.</p>
          <h3>Walk through</h3>
          <p>Tap <b>Walk</b>. Use the joystick to move (push it all the way to run), drag anywhere else to look, tap things to open or switch them. The stairs go up to the roof terrace.</p>` : `
          <h3>Orbit view</h3>
          <p><kbd>Left drag</kbd> rotate · <kbd>Right drag</kbd> pan · <kbd>Scroll</kbd> zoom</p>
          <p>Hover anything that glows and click it: doors, the sliding gate, balcony doors, ceiling lights, fans and TVs all work.</p>
          <h3>Walkthrough</h3>
          <p><kbd>F</kbd> start · <kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>E</kbd> or click to interact · <kbd>Esc</kbd> leave. Stairs go all the way to the roof terrace.</p>
          <h3>Shortcuts</h3>
          <p><kbd>1</kbd>–<kbd>9</kbd> camera views · <kbd>T</kbd> time of day · <kbd>L</kbd> interior lights · <kbd>C</kbd> cutaway · <kbd>P</kbd> screenshot · <kbd>H</kbd> help</p>`}
          <h3>Credits</h3>
          <p>Textures, HDR skies and furniture scans: <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a> (CC0). Rendered with three.js.</p>
        </div>
      </div>
    </div>
  `;

  const $ = (sel) => hud.querySelector(sel);
  const $$ = (sel) => [...hud.querySelectorAll(sel)];
  const help = $('#help');
  const scrim = $('#scrim');
  const isMobile = () => matchMedia('(max-width: 820px), (pointer: coarse) and (max-height: 500px)').matches;

  // --- sheets (bottom sheets on phones; the scene sheet is the side panel on desktop) ---
  let openSheet = null;
  function showSheet(name) {
    const next = openSheet === name ? null : name;
    openSheet = next;
    $$('[data-sheet]').forEach((s) => {
      s.classList.toggle('open', s.dataset.sheet === next);
      s.style.transform = '';
    });
    $$('[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === next));
    scrim.classList.toggle('show', !!next && isMobile());
  }
  scrim.addEventListener('click', () => showSheet(null));

  // drag the handle (or header) down to dismiss a sheet
  for (const sheet of $$('[data-sheet]')) {
    let start = null;
    const grab = sheet.querySelectorAll('[data-drag], .panel-head');
    grab.forEach((el) => el.addEventListener('pointerdown', (e) => {
      if (!isMobile() || e.target.closest('button')) return;
      start = { y: e.clientY, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging');
    }));
    grab.forEach((el) => el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      sheet.style.transform = `translateY(${Math.max(0, e.clientY - start.y)}px)`;
    }));
    grab.forEach((el) => el.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dy = e.clientY - start.y;
      start = null;
      sheet.classList.remove('dragging');
      sheet.style.transform = '';
      if (dy > 70) showSheet(null);
    }));
  }

  hud.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.shot) {
      app.flyTo(btn.dataset.shot);
      if (isMobile()) showSheet(null);
    } else if (btn.dataset.cutaway) {
      app.setCutaway(btn.dataset.cutaway, true);
      if (isMobile()) showSheet(null);
    } else if (btn.dataset.tab) showSheet(btn.dataset.tab);
    else if (btn.dataset.time) app.setTime(btn.dataset.time);
    else if (btn.dataset.quality) app.setQuality(btn.dataset.quality);
    else if (btn.dataset.finish) {
      const [kind, key] = btn.dataset.finish.split(':');
      app.setFinish(kind, key);
    } else if (btn.dataset.action) {
      const a = btn.dataset.action;
      if (a === 'settings') showSheet('scene');
      else if (a === 'close') showSheet(null);
      else if (a === 'help') help.classList.toggle('open');
      else if (a === 'walk') { showSheet(null); app.startWalk(); }
      else if (a === 'exit-walk') app.exitWalk();
      else if (a === 'screenshot') app.screenshot();
      else if (a === 'fullscreen') app.toggleFullscreen();
    }
  });
  help.addEventListener('click', (e) => { if (e.target === help) help.classList.remove('open'); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { showSheet(null); help.classList.remove('open'); }
  });
  $('#t-facade').addEventListener('change', (e) => app.setFacadeLights(e.target.checked));
  $('#t-interior').addEventListener('change', (e) => app.setInteriorLights(e.target.checked));
  $('#t-wind').addEventListener('change', (e) => app.setWind(e.target.checked));

  let toastTimer = 0;
  const select = (attr, value) => $$(`[data-${attr}]`).forEach((b) => b.classList.toggle('active', b.dataset[attr] === value));

  return {
    touch,
    tooltip: $('#tooltip'),
    crosshairLabel: $('#crosshair-label'),
    joystick: $('#joystick'),
    joystickKnob: $('#joystick-knob'),
    setProgress(loaded, total, url) {
      const pct = total ? Math.round((loaded / total) * 100) : 0;
      $('#loader-bar').style.width = `${pct}%`;
      $('#loader-pct').textContent = `${pct}%`;
      if (url) $('#loader-text').textContent = url.split('/').slice(-2).join(' / ').replace(/\.(jpg|gltf|bin|hdr|png)$/, '');
    },
    hideLoader() { $('#loader').classList.add('done'); },
    fade(on) { $('#fade').classList.toggle('on', on); },
    setTime(id) { select('time', id); },
    setCutaway(id) { select('cutaway', id); },
    setQuality(id) { select('quality', id); },
    setShot(id) { select('shot', id); },
    setFinish(kind, key) {
      $$(`[data-finish^="${kind}:"]`).forEach((b) => b.classList.toggle('active', b.dataset.finish === `${kind}:${key}`));
    },
    setLights({ facade, interior }) {
      $('#t-facade').checked = facade;
      $('#t-interior').checked = interior;
    },
    setWind(on) { $('#t-wind').checked = on; },
    setWalking(on, touchMode = false) {
      showSheet(null);
      document.body.classList.toggle('walking', on);
      document.body.classList.toggle('walking-touch', on && touchMode);
    },
    toggleHelp() { help.classList.toggle('open'); },
    toast(text) {
      const t = $('#toast');
      t.textContent = text;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
    },
  };
}
