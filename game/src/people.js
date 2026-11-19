// people.js — the pedestrians of Port Azura. They stroll the sidewalks,
// mind their own business, and run when the day takes a turn: a gunshot, a
// punch, or a car mounting the pavement near them.

import { clamp, dist } from './seeded-random.js';
import { onRoad, passable, avenueCentres, streetCentres } from './worldmap.js';

const SHIRTS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#c77dff', '#f1fa8c', '#8ecae6'];
const SKIN = ['#f2c09a', '#c68863', '#8d5a3b', '#6e442a', '#ffd9b3'];

export function seedCrowd(city, rng, count = 64) {
  const peds = [];
  const avenues = avenueCentres();
  const streets = streetCentres();
  for (let i = 0; i < count; i++) {
    // Spawn on a sidewalk: just off a road centre line.
    let x, y;
    if (rng.chance(0.5)) {
      x = avenues[rng.int(0, avenues.length - 1)] + rng.pick([-52, 52]);
      y = rng.range(60, 2540);
    } else {
      x = rng.range(60, 3000);
      y = streets[rng.int(0, streets.length - 1)] + rng.pick([-46, 46]);
    }
    if (!passable(city, x, y)) continue;
    peds.push({
      x, y,
      tx: x, ty: y,
      angle: rng.range(0, Math.PI * 2),
      speed: rng.range(26, 44),
      panic: 0,
      shirt: rng.pick(SHIRTS),
      skin: rng.pick(SKIN),
      bob: rng.range(0, 6),
      retarget: rng.range(0, 4),
    });
  }
  return peds;
}

function pickStrollTarget(ped, rng) {
  // Wander to another sidewalk point a block or two away.
  for (let tries = 0; tries < 6; tries++) {
    const nx = ped.x + rng.range(-320, 320);
    const ny = ped.y + rng.range(-320, 320);
    if (onRoad(nx, ny)) continue;
    ped.tx = clamp(nx, 30, 3030);
    ped.ty = clamp(ny, 30, 2570);
    return;
  }
}

export function stepPed(ped, dt, city, rng, threats) {
  ped.bob += dt * (ped.panic > 0 ? 11 : 6);
  ped.retarget -= dt;

  // Flee the nearest threat: run directly away for a couple of seconds.
  let fleeing = false;
  for (const t of threats) {
    const d = dist(ped.x, ped.y, t.x, t.y);
    if (d < t.radius) {
      ped.panic = Math.max(ped.panic, 1.6);
      ped.tx = ped.x + (ped.x - t.x) * 2.2;
      ped.ty = ped.y + (ped.y - t.y) * 2.2;
      fleeing = true;
    }
  }
  if (ped.panic > 0) ped.panic -= dt;

  if (!fleeing && ped.retarget <= 0) {
    pickStrollTarget(ped, rng);
    ped.retarget = rng.range(3, 8);
  }

  const dx = ped.tx - ped.x;
  const dy = ped.ty - ped.y;
  const d = Math.hypot(dx, dy);
  if (d > 4) {
    const sp = ped.speed * (ped.panic > 0 ? 2.6 : 1);
    const nx = ped.x + (dx / d) * sp * dt;
    const ny = ped.y + (dy / d) * sp * dt;
    if (passable(city, nx, ny)) {
      ped.x = nx;
      ped.y = ny;
    } else {
      ped.retarget = 0;
    }
    ped.angle = Math.atan2(dy, dx);
  }
}

export function drawPed(ctx, ped) {
  const bobY = Math.sin(ped.bob) * 1.6;
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.fillStyle = 'rgba(20,16,40,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 5, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Legs scissor as they walk.
  ctx.strokeStyle = '#2d3142';
  ctx.lineWidth = 3;
  const stride = Math.sin(ped.bob) * 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(stride, 7);
  ctx.moveTo(0, 0);
  ctx.lineTo(-stride, 7);
  ctx.stroke();
  // Torso and head.
  ctx.fillStyle = ped.shirt;
  ctx.fillRect(-4.5, -6 + bobY * 0.3, 9, 9);
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(0, -9 + bobY * 0.3, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
