// Port Azura itself: a seeded grid city of pastel towers, neon signs and parking
// lots, with a beach and a marina down its east side. This module owns the map's
// geometry: where the roads run, which rectangles are buildings (and so collide),
// where the named places are, and what kind of ground any point stands on.

import { BLOCK, CITY_H, CITY_W, COLS, ROAD, ROWS, SAND, WATER, WORLD_W } from './config.js';

/** X of the west edge of vertical road i (0..COLS). */
export const vRoadX = (i) => i * (BLOCK + ROAD);
/** Y of the north edge of horizontal road j (0..ROWS). */
export const hRoadY = (j) => j * (BLOCK + ROAD);
/** Centre line of vertical road i / horizontal road j. */
export const vRoadC = (i) => vRoadX(i) + ROAD / 2;
export const hRoadC = (j) => hRoadY(j) + ROAD / 2;
/** West edge of the block in column i / row j. */
export const blockX = (i) => vRoadX(i) + ROAD;
export const blockY = (j) => hRoadY(j) + ROAD;

/** Lane centre offsets for right-hand traffic on a road of the given west/north edge. */
export const laneEast = (roadY) => roadY + ROAD * 0.72; // heading +x keeps right, so the south lane
export const laneWest = (roadY) => roadY + ROAD * 0.28;
export const laneSouth = (roadX) => roadX + ROAD * 0.28; // heading +y, right side is west: the 0.28 lane
export const laneNorth = (roadX) => roadX + ROAD * 0.72; // heading -y, right side is east: the 0.72 lane

const BUILDING_COLORS = ['#e8b4a0', '#d98e7e', '#a8d8d8', '#f2e3c6', '#c9a8d8', '#8ec9b8', '#e8d44d', '#7ab5d9', '#f0f0ea', '#d97ab5'];
const ROOF_COLORS = ['#8c5a4a', '#6e4a5e', '#4a7a8c', '#9c8a6a', '#5e4a7a', '#4a8c7a', '#b89a3e', '#3e6a9c', '#c9c9c2', '#9c4a7a'];
const SIGNS = ['CAFE ONDA', 'PALMS COURT', 'AZURA SUITES', 'NEON PALMS', 'THE FLAMINGO', 'CORAL TOWER', 'VISTA DEL MAR', 'SOLSTICE', 'BRISA HOTEL'];

/** A named place the story or the systems point at. */
function place(name, x, y, sign) {
  return { name, x, y, sign };
}

export function createCity(rng) {
  const buildings = [];
  const palms = [];
  const lots = []; // parking lots: {x,y,w,h, spots:[{x,y,angle}]}
  const specials = {};

  const addBuilding = (x, y, w, h, opts = {}) => {
    const idx = buildings.length;
    const b = {
      x, y, w, h,
      color: opts.color ?? rng.pick(BUILDING_COLORS),
      roof: opts.roof ?? rng.pick(ROOF_COLORS),
      height: opts.height ?? rng.int(14, 58),
      sign: opts.sign ?? null,
      seed: rng.int(1, 1e9),
    };
    buildings.push(b);
    return b;
  };

  // The named blocks are fixed so the story always plays in the same city.
  const specialBlocks = new Map([
    ['0,7', 'garage'], ['5,0', 'police'], ['2,5', 'hospital'], ['7,4', 'hotel'],
    ['3,3', 'diner'], ['8,2', 'dealer'], ['9,6', 'warehouse'], ['6,6', 'shine'],
  ]);

  for (let i = 0; i < COLS; i += 1) {
    for (let j = 0; j < ROWS; j += 1) {
      const bx = blockX(i);
      const by = blockY(j);
      const kind = specialBlocks.get(`${i},${j}`);
      if (kind === 'garage') {
        addBuilding(bx + 30, by + 40, 150, 110, { sign: "ROOK'S GARAGE", height: 18, color: '#7ab5d9' });
        specials.garage = place('garage', bx + 105, by + 205, "Rook's Garage");
        lots.push({ x: bx + 20, y: by + 165, w: 200, h: 62, spots: [{ x: bx + 55, y: by + 196, angle: 0 }, { x: bx + 120, y: by + 196, angle: 0 }] });
        continue;
      }
      if (kind === 'police') {
        addBuilding(bx + 25, by + 30, 190, 120, { sign: 'AZURA PD', height: 22, color: '#dfe6ec', roof: '#3e5a8c' });
        specials.police = place('police', bx + 120, by + 185, 'Azura PD');
        lots.push({ x: bx + 20, y: by + 160, w: 200, h: 66, spots: [{ x: bx + 55, y: by + 193, angle: 0 }, { x: bx + 120, y: by + 193, angle: 0 }, { x: bx + 185, y: by + 193, angle: 0 }] });
        continue;
      }
      if (kind === 'hospital') {
        addBuilding(bx + 25, by + 30, 190, 130, { sign: 'ST AZURA MEDICAL', height: 30, color: '#f0f0ea', roof: '#b8452e' });
        specials.hospital = place('hospital', bx + 120, by + 190, 'St Azura Medical');
        continue;
      }
      if (kind === 'hotel') {
        addBuilding(bx + 55, by + 20, 130, 200, { sign: 'HOTEL LUMINA', height: 64, color: '#f2e3c6', roof: '#9c4a7a' });
        specials.hotel = place('hotel', bx + 120, by + 232, 'Hotel Lumina');
        continue;
      }
      if (kind === 'diner') {
        addBuilding(bx + 40, by + 60, 160, 90, { sign: "MARLOWE'S DINER", height: 14, color: '#e8d44d', roof: '#c25b7a' });
        specials.diner = place('diner', bx + 120, by + 185, "Marlowe's Diner");
        lots.push({ x: bx + 20, y: by + 160, w: 200, h: 64, spots: [{ x: bx + 55, y: by + 192, angle: 0 }, { x: bx + 120, y: by + 192, angle: 0 }, { x: bx + 185, y: by + 192, angle: 0 }] });
        continue;
      }
      if (kind === 'dealer') {
        // An open lot of cars for sale, one of them the gold Aurelia GT of the story.
        lots.push({
          x: bx + 12, y: by + 12, w: 216, h: 216, dealer: true,
          spots: [
            { x: bx + 48, y: by + 52, angle: 0 }, { x: bx + 120, y: by + 52, angle: 0 }, { x: bx + 192, y: by + 52, angle: 0 },
            { x: bx + 48, y: by + 128, angle: 0 }, { x: bx + 192, y: by + 128, angle: 0 },
            { x: bx + 48, y: by + 204, angle: 0 }, { x: bx + 120, y: by + 204, angle: 0 }, { x: bx + 192, y: by + 204, angle: 0 },
          ],
        });
        specials.dealer = place('dealer', bx + 120, by + 128, 'Azura Motors');
        addBuilding(bx + 88, by + 96, 64, 56, { sign: 'AZURA MOTORS', height: 12, color: '#27b6c9' });
        continue;
      }
      if (kind === 'warehouse') {
        addBuilding(bx + 20, by + 50, 200, 130, { sign: 'PORT FREIGHT', height: 20, color: '#9b8d84', roof: '#5d6d7e' });
        specials.warehouse = place('warehouse', bx + 120, by + 205, 'Port Freight warehouse');
        continue;
      }
      if (kind === 'shine') {
        addBuilding(bx + 30, by + 40, 180, 100, { sign: 'SHINE SHOP', height: 15, color: '#c9a8d8', roof: '#8e2ee3' });
        specials.shine = place('shine', bx + 120, by + 175, 'Shine Shop');
        specials.shineBay = { x: bx + 40, y: by + 150, w: 160, h: 60 };
        continue;
      }
      // Ordinary blocks: towers, pairs, lots and the odd plaza.
      const roll = rng.next();
      if (roll < 0.34) {
        addBuilding(bx + 42, by + 42, 156, 156, { sign: rng.chance(0.4) ? rng.pick(SIGNS) : null });
      } else if (roll < 0.58) {
        addBuilding(bx + 24, by + 24, 92, 92, {});
        addBuilding(bx + 124, by + 24, 92, 92, {});
        addBuilding(bx + 24, by + 124, 92, 92, {});
        addBuilding(bx + 124, by + 124, 92, 92, {});
      } else if (roll < 0.76) {
        addBuilding(bx + 24, by + 30, 192, 80, { sign: rng.chance(0.35) ? rng.pick(SIGNS) : null });
        addBuilding(bx + 24, by + 130, 192, 80, {});
      } else if (roll < 0.9) {
        const spots = [];
        for (let s = 0; s < 5; s += 1) spots.push({ x: bx + 36 + s * 44, y: by + 52, angle: 0 });
        for (let s = 0; s < 5; s += 1) spots.push({ x: bx + 36 + s * 44, y: by + 188, angle: Math.PI });
        lots.push({ x: bx + 10, y: by + 10, w: 220, h: 220, spots });
      } else {
        for (let p = 0; p < 5; p += 1) palms.push({ x: bx + rng.int(30, 210), y: by + rng.int(30, 210) });
      }
    }
  }

  // The beach: a boardwalk line of palms, the beach club, and the marina pier
  // reaching into the water at the height of horizontal road 4.
  for (let y = 60; y < CITY_H - 40; y += rng.int(120, 210)) palms.push({ x: CITY_W + 26, y });
  for (let y = 90; y < CITY_H - 40; y += rng.int(260, 420)) palms.push({ x: CITY_W + SAND - 34, y });
  const pierY = hRoadC(4);
  specials.beachClub = place('beachClub', CITY_W + 130, pierY - 320, 'Club Solstice');
  addBuilding(CITY_W + 70, pierY - 380, 120, 74, { sign: 'CLUB SOLSTICE', height: 13, color: '#ff9a5c', roof: '#c25b7a' });
  specials.pier = { x: CITY_W + SAND - 30, y: pierY - 23, w: WATER * 0.62, h: 46 };
  specials.boat = place('boat', CITY_W + SAND + WATER * 0.55, pierY, 'the Azura Runner');
  specials.boardwalk = place('boardwalk', CITY_W + 60, hRoadC(2), 'the boardwalk');

  // Beach furniture: umbrellas and towels scattered down the sand.
  const beachProps = [];
  const propColors = ['#ff6b9d', '#ffd93d', '#27b6c9', '#ff9a5c', '#95e06b', '#f2f0eb'];
  for (let k = 0; k < 30; k += 1) {
    const y = rng.range(70, CITY_H - 70);
    if (Math.abs(y - pierY) < 64) continue;
    beachProps.push({ x: CITY_W + rng.range(70, SAND - 46), y, color: rng.pick(propColors) });
  }

  // Hidden cash stashes, worth finding on foot or by car.
  const stashSpots = [
    [blockX(1) + 120, blockY(1) + 232], [blockX(4) + 232, blockY(6) + 120],
    [CITY_W + 150, hRoadC(1)], [blockX(9) + 120, blockY(0) + 8],
    [blockX(6) + 8, blockY(2) + 120], [CITY_W + SAND - 60, hRoadC(6)],
    [blockX(3) + 120, blockY(7) + 232], [blockX(8) + 232, blockY(5) + 120],
  ];
  const stashes = stashSpots.map(([x, y], id) => ({ id, x, y, taken: false }));

  return { buildings, palms, lots, specials, stashes, beachProps };
}

/** What kind of ground a point is on: 'road', 'block', 'sand', 'water' or 'pier'. */
export function groundAt(city, x, y) {
  if (x > CITY_W + SAND) {
    const p = city.specials.pier;
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return 'pier';
    return 'water';
  }
  if (x > CITY_W) return 'sand';
  const lx = x % (BLOCK + ROAD);
  const ly = y % (BLOCK + ROAD);
  if (lx < ROAD || ly < ROAD) return 'road';
  return 'block';
}

/** True when the point is on a road (either direction's asphalt). */
export function isRoad(x, y) {
  if (x > CITY_W || y > CITY_H) return false;
  const lx = x % (BLOCK + ROAD);
  const ly = y % (BLOCK + ROAD);
  return lx < ROAD || ly < ROAD;
}

/**
 * Push a circle at (x, y) with radius r out of every building and out of the water,
 * and keep it inside the world. Returns true when it hit something solid.
 */
export function resolveCollisions(city, pos, r) {
  let hit = false;
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(pos.x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(pos.y, b.y + b.h));
    const dx = pos.x - nx;
    const dy = pos.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * r;
        pos.y = ny + (dy / d) * r;
      } else {
        // Centre inside the building: leave by the nearest face.
        const left = pos.x - b.x;
        const right = b.x + b.w - pos.x;
        const top = pos.y - b.y;
        const bottom = b.y + b.h - pos.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = b.x - r;
        else if (m === right) pos.x = b.x + b.w + r;
        else if (m === top) pos.y = b.y - r;
        else pos.y = b.y + b.h + r;
      }
    }
  }
  // The sea is solid to everyone; the pier is a walkway over it for feet, not cars.
  const ground = groundAt(city, pos.x, pos.y);
  if (ground === 'water') {
    pos.x = Math.min(pos.x, CITY_W + SAND + r * 0.4);
    hit = true;
  }
  if (pos.x < r) { pos.x = r; hit = true; }
  if (pos.y < r) { pos.y = r; hit = true; }
  if (pos.x > WORLD_W - r) { pos.x = WORLD_W - r; hit = true; }
  if (pos.y > CITY_H - r) { pos.y = CITY_H - r; hit = true; }
  return hit;
}
