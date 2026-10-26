// All dimensions in metres. +Z faces the main road, +X is to the right when
// standing on the road looking at the house, Y is up.

export const FT = 0.3048;

// 30' x 51' plot centred on the origin
export const PLOT = {
  x0: -15 * FT, x1: 15 * FT,
  z0: -25.5 * FT, z1: 25.5 * FT,
};

// Building envelope (outer faces of the external walls)
export const B = { x0: -4.35, x1: 4.35, z0: -7.4, z1: 4.6 };

export const EXT = 0.23;   // external wall thickness (9" brick)
export const PART = 0.12;  // internal partition (4.5" brick)
export const SLAB = 0.15;

// Finished floor levels
export const LVL = {
  ground: 0.45,
  first: 3.75,
  roof: 7.05,
};
export const FLOOR_TO_FLOOR = LVL.first - LVL.ground; // 3.3
export const DOOR_H = 2.15;

// Inner faces of the external walls
export const IN = {
  x0: B.x0 + EXT, x1: B.x1 - EXT,
  z0: B.z0 + EXT, z1: B.z1 - EXT,
};

// Dog-leg staircase between the levels
export const STAIR = {
  x0: IN.x0, xMid: -2.96, x1: -1.81, // inner faces of the stair well
  wall: -1.75,                         // centre line of the wall to the dining / family hall
  zBack: -3.9,                         // wall to the rear rooms
  zFoot: -2.78,                        // first riser
  zLanding: -0.53,                     // landing starts here
  zFront: 0.54,                        // landing ends at the front partition
  risers: 10,                          // per flight
  get going() { return (this.zLanding - this.zFoot) / (this.risers - 1); },
  get rise() { return FLOOR_TO_FLOOR / 2 / this.risers; },
};

// Rooms (interior extents) used for labels, lights and camera fly-tos.
export const ROOMS = [
  // Ground floor
  { id: 'bed1', level: 'ground', name: 'Bedroom 1', x0: IN.x0, x1: -0.66, z0: 0.66, z1: IN.z1 },
  { id: 'living', level: 'ground', name: 'Living Room', x0: -0.54, x1: IN.x1, z0: 0.6, z1: IN.z1 },
  { id: 'dining', level: 'ground', name: 'Dining', x0: -1.69, x1: IN.x1, z0: -3.84, z1: 0.6 },
  { id: 'stair', level: 'ground', name: 'Staircase', x0: IN.x0, x1: -1.81, z0: -3.84, z1: 0.54, noLight: true },
  { id: 'kitchen', level: 'ground', name: 'Kitchen', x0: 0.26, x1: IN.x1, z0: IN.z0, z1: -3.96 },
  { id: 'bed2', level: 'ground', name: 'Bedroom 2', x0: IN.x0, x1: 0.14, z0: IN.z0, z1: -3.96 },
  { id: 'toilet1', level: 'ground', name: 'Toilet', x0: IN.x0, x1: -2.81, z0: IN.z0, z1: -5.96, small: true },
  { id: 'porch', level: 'ground', name: 'Porch', x0: -1.2, x1: 3.95, z0: B.z1, z1: 5.4, outdoor: true },
  // First floor
  { id: 'bed3', level: 'first', name: 'Bedroom 3', x0: IN.x0, x1: -1.26, z0: 0.66, z1: IN.z1 },
  { id: 'lounge', level: 'first', name: 'Lounge', x0: -1.14, x1: IN.x1, z0: 0.6, z1: IN.z1 },
  { id: 'family', level: 'first', name: 'Family Hall', x0: -1.69, x1: IN.x1, z0: -3.84, z1: 0.6 },
  { id: 'master', level: 'first', name: 'Master Bedroom', x0: IN.x0, x1: 0.14, z0: IN.z0, z1: -3.96 },
  { id: 'bed4', level: 'first', name: 'Bedroom 4', x0: 0.26, x1: IN.x1, z0: IN.z0, z1: -3.96 },
  { id: 'toilet2', level: 'first', name: 'Toilet', x0: IN.x0, x1: -2.81, z0: IN.z0, z1: -5.96, small: true },
  { id: 'balcony', level: 'first', name: 'Balcony', x0: -1.2, x1: 3.95, z0: B.z1, z1: 5.95, outdoor: true },
  // Roof
  { id: 'terrace', level: 'roof', name: 'Roof Terrace', x0: -1.75, x1: B.x1 - 0.15, z0: B.z0 + 0.15, z1: 5.9, outdoor: true },
];

export function levelY(level) {
  return LVL[level];
}

export function feetInches(m) {
  const totalIn = Math.round(m / 0.0254);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}
