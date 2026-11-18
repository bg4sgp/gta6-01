// World geometry and tuning for Vice Heat. The city of Port Azura is a grid: square
// blocks of buildings separated by two-lane roads, a sand beach along the east edge
// and open water beyond it. Everything is measured in world pixels; the camera shows
// a 1280x720 window onto it.

export const ROAD = 96; // width of every road, both directions
export const BLOCK = 240; // side of one city block (buildings plus their sidewalk)
export const COLS = 10; // blocks across, west to east
export const ROWS = 8; // blocks down, north to south
export const SAND = 300; // beach width east of the last road
export const WATER = 560; // sea width east of the sand

export const CITY_W = COLS * BLOCK + (COLS + 1) * ROAD;
export const CITY_H = ROWS * BLOCK + (ROWS + 1) * ROAD;
export const WORLD_W = CITY_W + SAND + WATER;
export const WORLD_H = CITY_H;

export const VIEW_W = 1280;
export const VIEW_H = 720;

// The player, on foot and behind the wheel.
export const FOOT_SPEED = 168;
export const FOOT_SPRINT = 258;
export const FOOT_RADIUS = 11;
export const PLAYER_HP = 100;

// Wanted heat: crimes add heat, stars follow the thresholds, heat cools when the
// police lose sight of the player.
export const STAR_THRESHOLDS = [1, 3, 6, 10, 15];
export const HEAT = {
  stealCar: 2,
  hitPed: 2,
  downPed: 3,
  shootNearCop: 1,
  ramCop: 2,
  crashProperty: 0.5,
};
export const HEAT_DECAY = 0.22; // heat per second while unseen
export const HEAT_SIGHT = 430; // a police car closer than this sees the player

// Car kinds: top speed (px/s), acceleration, grip and the paint jobs they come in.
export const CAR_KINDS = {
  sedan: { top: 330, accel: 250, grip: 7.5, colors: ['#c0c6ce', '#7a4a8c', '#2e6f8e', '#8c2e3e', '#3e7a4a', '#d8d3c3'] },
  hatch: { top: 300, accel: 240, grip: 7.5, colors: ['#e0a32e', '#4a7ac2', '#c25b7a', '#5bc2a3', '#ece7da'] },
  sports: { top: 465, accel: 360, grip: 8.5, colors: ['#e33f4e', '#ffb52e', '#27b6c9', '#f2f0eb', '#8e2ee3'] },
  truck: { top: 265, accel: 185, grip: 6.0, colors: ['#b8b0a0', '#5d6d7e', '#946b4a'] },
  police: { top: 435, accel: 330, grip: 8.0, colors: ['#f4f6f8'] },
};

// Sunset over the bay: the whole game is lit like the last hour of the day.
export const PALETTE = {
  asphalt: '#3d3a44',
  asphaltDark: '#353240',
  laneMark: '#e8c96a',
  sidewalk: '#9b8d84',
  blockBase: '#6e6259',
  sand: '#ecd29a',
  sandWet: '#dfc084',
  water: '#1f7d96',
  waterDeep: '#166a8c',
  foam: '#bfeef2',
  grass: '#5f9e5a',
};
