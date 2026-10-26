// Downloads the CC0 textures, HDRIs and models used by the app from Poly Haven
// into public/assets. Safe to re-run: files that already exist are skipped.
//
//   npm run assets
//
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

// id -> resolution
const TEXTURES = {
  marble_01: '2k',
  kitchen_wood: '2k',
  dirty_carpet: '1k',
  fabric_pattern_05: '1k',
  castle_wall_slates: '2k',
  white_stucco: '2k',
  painted_plaster_wall: '1k',
  large_grey_tiles: '1k',
  leafy_grass: '1k',
  asphalt_02: '1k',
  laminate_floor_02: '1k',
};
const TEXTURE_MAPS = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' };

// Leaf and bark maps borrowed from scanned tree models (the full tree meshes are
// 50-200 MB, far too heavy, so the app builds its own trees from these maps).
// [polyhaven model id, folder, { map key: [resolution, format, file name] }]
const FOLIAGE = [
  ['jacaranda_tree', 'jacaranda', {
    leaves_diff: ['2k', 'jpg', 'leaves_diff.jpg'],
    leaves_alpha: ['2k', 'png', 'leaves_alpha.png'],
    leaves_nor_gl: ['1k', 'jpg', 'leaves_nor.jpg'],
    leaves_arm: ['1k', 'jpg', 'leaves_arm.jpg'],
    trunk_diff: ['1k', 'jpg', 'bark_diff.jpg'],
    trunk_nor_gl: ['1k', 'jpg', 'bark_nor.jpg'],
    trunk_arm: ['1k', 'jpg', 'bark_arm.jpg'],
  }],
];

const HDRIS = {
  day: 'kloofendal_48d_partly_cloudy_puresky',
  sunset: 'qwantani_sunset_puresky',
  night: 'qwantani_night_puresky',
};

const MODELS = [
  'sofa_02', 'modern_arm_chair_01', 'modern_coffee_table_01', 'dining_chair_02',
  'ceiling_fan', 'modern_ceiling_lamp_01', 'television_02', 'side_table_01',
  'throw_pillows_01', 'modern_wooden_cabinet', 'potted_plant_02', 'potted_plant_04',
  'calathea_orbifolia_01', 'planter_box_01', 'outdoor_table_chair_set_01', 'street_lamp_01',
  'shrub_04', 'flower_gazania', 'fern_02',
];

async function exists(p) {
  try { return (await stat(p)).size > 0; } catch { return false; }
}

async function download(url, dest) {
  if (await exists(dest)) return 0;
  await mkdir(dirname(dest), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      return buf.length;
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
}

async function files(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!res.ok) throw new Error(`Poly Haven has no asset "${id}"`);
  return res.json();
}

const jobs = [];

for (const [id, res] of Object.entries(TEXTURES)) {
  jobs.push(async () => {
    const f = await files(id);
    let bytes = 0;
    for (const [key, short] of Object.entries(TEXTURE_MAPS)) {
      // fabric scans ship colour variants (col_01...) instead of a single Diffuse map
      const url = (f[key] || (key === 'Diffuse' && f.col_01))[res].jpg.url;
      bytes += await download(url, join(ROOT, 'textures', id, `${short}.jpg`));
    }
    return `texture ${id} (${res})`;
  });
}

for (const [id, folder, maps] of FOLIAGE) {
  jobs.push(async () => {
    const f = await files(id);
    for (const [key, [res, fmt, name]] of Object.entries(maps)) {
      await download(f[key][res][fmt].url, join(ROOT, 'foliage', folder, name));
    }
    return `foliage ${folder} <- ${id}`;
  });
}

for (const [name, id] of Object.entries(HDRIS)) {
  jobs.push(async () => {
    const f = await files(id);
    await download(f.hdri['2k'].hdr.url, join(ROOT, 'hdri', `${name}.hdr`));
    return `hdri ${name} <- ${id}`;
  });
}

for (const id of MODELS) {
  jobs.push(async () => {
    const g = (await files(id)).gltf['1k'].gltf;
    await download(g.url, join(ROOT, 'models', id, `${id}.gltf`));
    for (const [rel, file] of Object.entries(g.include)) {
      await download(file.url, join(ROOT, 'models', id, rel));
    }
    return `model ${id}`;
  });
}

// Small worker pool so we don't hammer the CDN
const queue = [...jobs];
let failed = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const job = queue.shift();
    try {
      console.log('✓', await job());
    } catch (err) {
      failed++;
      console.error('✗', err.message);
    }
  }
}));

if (failed) {
  console.error(`${failed} asset(s) failed to download`);
  process.exit(1);
}
console.log('All assets ready in public/assets');
