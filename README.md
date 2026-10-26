# Residence 30 × 51 — interactive 3D walkthrough

A photoreal, browser-based walkthrough of a modern G+1 house on a 30' × 51' plot
(black marble feature wall, white balcony frame, teak slats, glass balustrades,
roof terrace with pergola). Built with three.js and Vite.

## Run it

```bash
npm install
npm run assets   # downloads the CC0 textures, HDR skies and furniture scans (~54 MB) into public/assets
npm run dev      # http://localhost:5173
```

`npm run build` produces a static site in `dist/` that can be hosted anywhere
(`npm run preview` serves it locally). It must be served over HTTP; opening
`index.html` from disk won't work because browsers block module scripts and
WebGL textures on `file://`.

## What you can do

- **Orbit** (drag / right-drag / scroll) and fly between camera presets: front, street, aerial, entrance, living, dining, lounge, terrace, floor plans.
- **Cutaway views** of each floor with room labels and sizes in feet; click a label to fly into that room.
- **Walkthrough** (F): first-person with collisions, stairs to the roof terrace, doors and the gate you can open.
- **Click things**: every door, the sliding gate, the balcony sliding door, ceiling lights (per room), fans, TVs.
- **Time of day**: day, sunset, night — each a real HDR sky with a matching sun and shadows; facade, street and interior lights come on at dusk.
- **Finishes**: switch the feature stone, timber and wall paint.
- **Wind**: trees, hedges, flowers and the lawn sway in gusts (Scene → Nature; off by default on the Low preset, since moving plants mean drawing every frame).
- **Quality presets** (auto-picked for the GPU) and a PNG screenshot button.

**On phones and tablets** the layout switches to a bottom tab bar (Views · Floors · Walk · Scene) with swipe-down sheets. Orbit with one finger, pinch to zoom, two fingers to pan; tap things to use them. Walk mode uses an on-screen joystick (push fully to run), drag-to-look and tap-to-open. The app can be added to the home screen and runs full screen.

Shortcuts: `1`–`9` camera views · `T` time of day · `L` interior lights · `C` cutaway · `P` screenshot · `H` help.

## Project layout

```
src/
  config.js              plot, levels, room list (all dimensions in metres)
  main.js                bootstraps renderer, world, systems, UI and the render loop
  assets/                loaders, PBR material library, glTF model placement
  world/                 house shell, interior furniture, site & street, procedural vegetation
  systems/               HDR environment, lighting, post-processing, camera rig,
                         walk controller, physics, picking/interaction
  ui/                    HUD, room labels, styles
scripts/fetch-assets.mjs downloads assets from Poly Haven
```

Realism notes: trees, bushes and hedges are built from real scanned leaf sprigs
and bark (Poly Haven jacaranda maps) on instanced cards, with crown-shaped
normals, baked canopy self-occlusion, per-tree colour variation and sunlight
shining through the leaves (masked by the shadow map). Lawns have real 3D grass
(`world/grass.js`): game-style clump cards with painted blades in a field that
follows the camera, coloured from the lawn texture and fading into it, bending in
the wind and away from you in walk mode. Scanned ferns and gazanias fill the
front garden; exterior walls use a fine stucco "texture paint" with
subtle weathering, the stone is natural stacked slate, and interior surfaces
get a neutral room environment for ambient light instead of the blue sky.

Rendering: PBR materials with scanned textures and world-scale UVs, image-based
lighting from HDRIs (sun position detected from the HDR and matched by a
shadow-casting light), 4× MSAA in a half-float buffer, GTAO ambient occlusion,
bloom for light sources at night, ACES tone mapping.

## Performance

- **Render on demand**: nothing is drawn while the view is still (unless wind is on); the sun's shadow map only updates when something that casts shadows moves.
- **Static merging** (`systems/optimize.js`): ~900 architectural pieces become a few dozen meshes per level; BVH-accelerated raycasting keeps hover/click/walk picking fast.
- **LODs**: dense scanned models (potted plants are ~70k triangles each) swap to a simplified mesh beyond a few metres.
- **Single scene pass for AO**: GTAO reads the main pass's depth; normals are rebuilt from it once in a cheap screen pass.
- **Foliage depth pre-pass**: alpha-tested leaves and grass lay their depth down first, so hidden leaf and blade pixels are never shaded.
- **Grass field**: a fixed set of tufts wraps around the camera (constant cost anywhere), two cross-faded density layers, and a share of the tufts per quality preset.
- **No shader hitches**: lights toggle as one group (an "off" light has zero intensity), and both light states are compiled behind the loading screen.
- **Adaptive motion resolution**: if full-resolution frames can't keep up while the camera moves, motion renders through a 70% pipeline and the view refines to full quality the moment it stops. Fast GPUs never switch.

## Credits

Textures, HDRIs and furniture models from [Poly Haven](https://polyhaven.com), CC0.
