// worldmap.js — Port Azura itself: a sun-soaked grid of avenues and streets
// on a bay, generated once from a fixed seed. Owns the road layout, the
// buildings, the beach and every named landmark the story visits, plus the
// spatial questions other modules ask (is this point road? building? water?).

import { createRng, clamp } from './seeded-random.js';

export const WORLD_W = 3600;
export const WORLD_H = 2600;
export const BEACH_X = 3050; // sand starts here
export const WATER_X = 3190; // open water starts here

const AVENUES = [300, 790, 1280, 1770, 2260, 2750]; // vertical road centres
const STREETS = [290, 730, 1170, 1610, 2050, 2420]; // horizontal road centres
export const AVENUE_W = 124;
export const STREET_W = 112;

const BLOCK_FILLS = ['#f6c177', '#7fd1ae', '#84c7e8', '#f28ba8', '#f9e08a', '#b8a7e8', '#ffb37a', '#8ad6c0'];
const ROOF_TONES = ['#c96f4a', '#5f8f7b', '#4a6fa5', '#a54a6f', '#b89a3e', '#6a5a9e', '#c97e4a', '#4a7d6b'];

export const LANDMARKS = {
  diner: { x: 430, y: 420, label: "Viv's Diner" },
  spa: { x: 1340, y: 800, w: 190, h: 120, label: 'Shine & Go Auto Spa' },
  chopGarage: { x: 2380, y: 2150, w: 210, h: 130, label: 'Azura Customs (back lot)' },
  docks: { x: 2870, y: 2280, label: 'Port Azura Docks' },
  marina: { x: 2980, y: 1180, label: 'Sunset Marina' },
  airstrip: { x: 560, y: 130, label: 'North Point Airstrip' },
  hospital: { x: 830, y: 1560, label: 'Azura General Hospital' },
  station: { x: 1830, y: 420, label: 'PAPD Headquarters' },
  hideout: { x: 150, y: 2380, label: 'Canal Street Hideout' },
  hotel: { x: 2560, y: 620, label: 'Hotel Miramar' },
};

export function buildCity() {
  const rng = createRng(20261119);
  const buildings = [];
  const trees = [];

  // Fill each block between roads with 1-4 buildings, leaving the beach clear.
  for (let i = 0; i < AVENUES.length; i++) {
    for (let j = 0; j < STREETS.length; j++) {
      const x0 = AVENUES[i] + AVENUE_W / 2 + 26;
      const x1 = (i + 1 < AVENUES.length ? AVENUES[i + 1] : BEACH_X - 60) - AVENUE_W / 2 - 26;
      const y0 = STREETS[j] + STREET_W / 2 + 26;
      const y1 = (j + 1 < STREETS.length ? STREETS[j + 1] : WORLD_H - 40) - STREET_W / 2 - 26;
      if (x1 - x0 < 150 || y1 - y0 < 130) continue;
      const cols = rng.int(1, 2);
      const rows = rng.int(1, 2);
      const cw = (x1 - x0) / cols;
      const ch = (y1 - y0) / rows;
      for (let a = 0; a < cols; a++) {
        for (let b = 0; b < rows; b++) {
          if (rng.chance(0.14)) continue; // a plaza or parking gap
          const pad = rng.range(8, 20);
          const tone = rng.int(0, BLOCK_FILLS.length - 1);
          buildings.push({
            x: x0 + a * cw + pad,
            y: y0 + b * ch + pad,
            w: cw - pad * 2,
            h: ch - pad * 2,
            floors: rng.int(2, 9),
            fill: BLOCK_FILLS[tone],
            roof: ROOF_TONES[tone],
          });
        }
      }
      // Palms and shade trees on the block corners.
      if (rng.chance(0.75)) trees.push({ x: x0 + 8, y: y0 + 8, s: rng.range(0.8, 1.3) });
      if (rng.chance(0.5)) trees.push({ x: x1 - 8, y: y1 - 8, s: rng.range(0.8, 1.3) });
    }
  }

  // A double row of palms along the beach promenade.
  for (let y = 120; y < WORLD_H - 80; y += 130) {
    trees.push({ x: BEACH_X + 34, y: y + rng.range(-14, 14), s: rng.range(1, 1.5), palm: true });
    if (rng.chance(0.6)) trees.push({ x: BEACH_X + 86, y: y + 60, s: rng.range(0.9, 1.3), palm: true });
  }

  // Landmarks keep clear ground: no building may swallow the diner door,
  // the hotel drop-off, the mall loading bay or any other story address.
  const clearings = [
    { x: LANDMARKS.diner.x, y: LANDMARKS.diner.y, r: 125 },
    { x: LANDMARKS.marina.x, y: LANDMARKS.marina.y, r: 115 },
    { x: LANDMARKS.docks.x, y: LANDMARKS.docks.y, r: 115 },
    { x: LANDMARKS.hotel.x, y: LANDMARKS.hotel.y, r: 125 },
    { x: LANDMARKS.hideout.x, y: LANDMARKS.hideout.y, r: 105 },
    { x: LANDMARKS.station.x, y: LANDMARKS.station.y, r: 105 },
    { x: LANDMARKS.hospital.x, y: LANDMARKS.hospital.y, r: 105 },
    { x: 940, y: 1900, r: 115 }, // Seabreeze Mall loading bay
  ];
  const clearRects = [
    { x: LANDMARKS.spa.x - 34, y: LANDMARKS.spa.y - 34, w: LANDMARKS.spa.w + 68, h: LANDMARKS.spa.h + 68 },
    { x: LANDMARKS.chopGarage.x - 34, y: LANDMARKS.chopGarage.y - 34, w: LANDMARKS.chopGarage.w + 68, h: LANDMARKS.chopGarage.h + 68 },
    { x: 190, y: 50, w: 740, h: 160 }, // the airstrip apron
  ];
  const kept = buildings.filter((b) => {
    for (const c of clearings) {
      const nx = clamp(c.x, b.x, b.x + b.w);
      const ny = clamp(c.y, b.y, b.y + b.h);
      if (Math.hypot(c.x - nx, c.y - ny) < c.r) return false;
    }
    for (const r of clearRects) {
      if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) return false;
    }
    return true;
  });

  return { buildings: kept, trees };
}

export function onRoad(x, y) {
  for (const ax of AVENUES) if (Math.abs(x - ax) <= AVENUE_W / 2) return true;
  for (const sy of STREETS) if (Math.abs(y - sy) <= STREET_W / 2) return true;
  return false;
}

export function inWater(x, y) {
  return x > WATER_X;
}

export function buildingAt(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

// Ground a car or walker may occupy: roads, sand, plazas — not buildings,
// not open water.
export function passable(city, x, y) {
  if (x < 12 || y < 12 || x > WORLD_W - 12 || y > WORLD_H - 12) return false;
  if (inWater(x, y)) return false;
  return !buildingAt(city, x, y);
}

// Snap a point to the middle of the nearest road, for spawning traffic and
// police where they can actually drive.
export function nearestRoadPoint(x, y) {
  let bestAx = AVENUES[0];
  for (const ax of AVENUES) if (Math.abs(ax - x) < Math.abs(bestAx - x)) bestAx = ax;
  let bestSy = STREETS[0];
  for (const sy of STREETS) if (Math.abs(sy - y) < Math.abs(bestSy - y)) bestSy = sy;
  if (Math.abs(bestAx - x) < Math.abs(bestSy - y)) return { x: bestAx, y: clamp(y, 40, WORLD_H - 40) };
  return { x: clamp(x, 40, WORLD_W - 40), y: bestSy };
}

export function avenueCentres() {
  return AVENUES;
}
export function streetCentres() {
  return STREETS;
}
