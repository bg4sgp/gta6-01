// cops.js — the Port Azura Police Department. Interceptors roll out in
// proportion to the wanted stars, hunt the player across the grid, and fill
// the bust meter when they pin a slow or cornered player. Out of sight long
// enough and the heat cools on its own.

import { dist } from './seeded-random.js';
import { COP_KIND, makeCar, stepChaseCar } from './vehicles.js';
import { nearestRoadPoint } from './worldmap.js';

export class Police {
  constructor() {
    this.cars = [];
    this.bustMeter = 0; // 0..1; full means busted
    this.spawnClock = 0;
  }

  reset() {
    this.cars = [];
    this.bustMeter = 0;
    this.spawnClock = 0;
  }

  desiredCount(stars) {
    return stars <= 0 ? 0 : Math.min(2 + stars * 2, 11);
  }

  update(dt, game) {
    const { player, stars } = game;
    const px = game.playerX();
    const py = game.playerY();
    this.spawnClock -= dt;

    // Roll out fresh units at road points just off-screen until we match the
    // wanted level; surplus units peel away and despawn.
    const want = this.desiredCount(stars);
    if (this.cars.length < want && this.spawnClock <= 0) {
      this.spawnClock = 0.7;
      const ang = game.rng.range(0, Math.PI * 2);
      const sx = px + Math.cos(ang) * 620;
      const sy = py + Math.sin(ang) * 620;
      const spot = nearestRoadPoint(sx, sy);
      const cop = makeCar(COP_KIND, spot.x, spot.y, Math.atan2(py - spot.y, px - spot.x), '#f4f6f8');
      cop.driver = 'cop';
      this.cars.push(cop);
    }
    if (this.cars.length > want) {
      const extra = this.cars[this.cars.length - 1];
      if (dist(extra.x, extra.y, px, py) > 700) this.cars.pop();
    }

    let pinning = false;
    for (const cop of this.cars) {
      cop.flash += dt * 2.4;
      // Aim at where the player is heading, not just where they are.
      const lead = player.inCar ? 0.55 : 0.25;
      const tx = px + game.playerVX() * lead;
      const ty = py + game.playerVY() * lead;
      stepChaseCar(cop, tx, ty, dt, game.city);
      const d = dist(cop.x, cop.y, px, py);
      if (d < 58 && game.playerSpeed() < 55) pinning = true;
      // A cop car that falls far behind gives up the chase.
      if (d > 1500) cop.stale = true;
    }
    this.cars = this.cars.filter((c) => !c.stale);

    // The bust meter only fills while a unit has the player pinned.
    if (pinning && stars > 0) this.bustMeter = Math.min(1, this.bustMeter + dt / 2.6);
    else this.bustMeter = Math.max(0, this.bustMeter - dt / 3.2);
    return pinning;
  }
}

// Wanted heat: crimes add up, stars step at fixed thresholds, and heat
// bleeds away while no police unit can see the player.
export const HEAT_THRESHOLDS = [6, 18, 36, 60, 90];

export function starsForHeat(heat) {
  let stars = 0;
  for (const t of HEAT_THRESHOLDS) if (heat >= t) stars++;
  return stars;
}
