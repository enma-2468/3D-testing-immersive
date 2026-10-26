// Shared wind field for all vegetation (grass, leaves, shrubs).
// A slow gust front sweeps across the site plus faster local sway, so nearby
// plants move together and distant ones out of phase, like real wind.

export const wind = {
  enabled: true,
  uniforms: {
    uTime: { value: 0 },
    uWind: { value: 1 }, // overall strength (0 = still)
  },
};

export const WIND_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uWind;
  vec3 windOffset(vec3 p) {
    vec2 dir = normalize(vec2(1.0, 0.35));
    float t = uTime;
    float gust = sin(t * 0.55 - dot(p.xz, dir) * 0.09) * 0.5 + 0.5;
    gust = gust * gust;
    float sway = sin(t * 1.9 + p.x * 0.35 + p.z * 0.27) * 0.6 + sin(t * 3.3 + p.x * 0.9 - p.z * 0.7) * 0.25;
    float push = (0.3 + 0.7 * gust) * uWind;
    return vec3(dir.x, 0.0, dir.y) * (sway * 0.45 + gust * 0.75) * push;
  }
`;

/**
 * Add a world-space wind offset after projection setup. `amountExpr` is GLSL
 * giving how strongly this vertex bends (0 at the root, 1 at the tip...).
 * `rootExpr` is the world position used to sample the wind field.
 */
export function windVertex(rootExpr, amountExpr, extra = '') {
  return `
    #include <project_vertex>
    {
      vec3 wRoot = ${rootExpr};
      vec3 wOff = windOffset(wRoot) * (${amountExpr});
      ${extra}
      mvPosition.xyz += (viewMatrix * vec4(wOff, 0.0)).xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;
}

/** Advance the wind; returns true while anything is moving (the frame must be redrawn). */
export function updateWind(time, enabled) {
  const u = wind.uniforms;
  u.uWind.value += ((enabled ? 1 : 0) - u.uWind.value) * 0.05;
  if (!enabled && u.uWind.value < 0.003) u.uWind.value = 0;
  if (u.uWind.value === 0) return false;
  u.uTime.value = time;
  return true;
}
