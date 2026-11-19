// vehicles.js — every car in Port Azura: the kinds that spawn, the parked
// cars waiting to be borrowed, the traffic that follows the avenues, the
// arcade driving physics for whoever is behind the wheel, and the drawing.

import { clamp, turnToward, angleTo, pushOutOfRect } from './seeded-random.js';
import { onRoad, passable, avenueCentres, streetCentres, WORLD_W, WORLD_H } from './worldmap.js';

export const CAR_KINDS = [
  { name: 'Solana Coupe', w: 34, l: 62, top: 265, accel: 210, grip: 3.4, colors: ['#e84a5f', '#f5d76e', '#3fa7d6', '#f2f2f2'] },
  { name: 'Miramar Sedan', w: 36, l: 68, top: 235, accel: 175, grip: 3.1, colors: ['#8892a0', '#274156', '#7fb069', '#e0c097'] },
  { name: 'Dune Buggy', w: 36, l: 60, top: 250, accel: 225, grip: 2.7, colors: ['#ff8c42', '#2ec4b6', '#ffd23f'] },
  { name: 'Azura Taxi', w: 36, l: 68, top: 240, accel: 185, grip: 3.1, colors: ['#ffc914'], taxi: true },
  { name: 'Cargo Van', w: 40, l: 78, top: 195, accel: 140, grip: 2.6, colors: ['#d8dee9', '#5e6b7a', '#a3b18a'] },
  { name: 'Viper GT', w: 36, l: 66, top: 330, accel: 265, grip: 3.8, colors: ['#9b5de5', '#00f5d4', '#ef476f'] },
];

export const COP_KIND = { name: 'PAPD Interceptor', w: 36, l: 68, top: 292, accel: 215, grip: 3.4, colors: ['#f4f6f8'] };

let nextCarId = 1;

export function makeCar(kind, x, y, angle, color) {
  return {
    id: nextCarId++,
    kind,
    x, y, angle,
    speed: 0,
    color: color ?? kind.colors[0],
    health: 100,
    driver: null, // 'player' | 'traffic' | 'cop' | null (parked)
    flash: 0, // police light phase
  };
}

export function seedParkedCars(city, rng) {
  const cars = [];
  const avenues = avenueCentres();
  const streets = streetCentres();
  for (let i = 0; i < 46; i++) {
    const kind = CAR_KINDS[rng.int(0, CAR_KINDS.length - 1)];
    let x, y, angle;
    if (rng.chance(0.55)) {
      const ax = avenues[rng.int(0, avenues.length - 1)];
      const side = rng.sign();
      x = ax + side * 44;
      y = rng.range(80, WORLD_H - 80);
      angle = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const sy = streets[rng.int(0, streets.length - 1)];
      const side = rng.sign();
      x = rng.range(80, WORLD_W - 500);
      y = sy + side * 40;
      angle = side > 0 ? 0 : Math.PI;
    }
    if (!passable(city, x, y)) continue;
    cars.push(makeCar(kind, x, y, angle, rng.pick(kind.colors)));
  }
  // The marked Viper GT that Viv's third job is about, parked by the marina.
  const viper = makeCar(CAR_KINDS[5], 2960, 1090, -Math.PI / 2, '#00f5d4');
  viper.marked = true;
  cars.push(viper);
  return cars;
}

export function spawnTrafficCar(rng, nearX, nearY) {
  const kind = CAR_KINDS[rng.int(0, CAR_KINDS.length - 1)];
  const avenues = avenueCentres();
  const streets = streetCentres();
  let x, y, angle, axis, fixed, dir;
  if (rng.chance(0.5)) {
    axis = 'v';
    fixed = avenues[rng.int(0, avenues.length - 1)];
    dir = rng.sign();
    x = fixed + (dir > 0 ? -24 : 24);
    y = nearY + dir * -rng.range(500, 900);
    angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    axis = 'h';
    fixed = streets[rng.int(0, streets.length - 1)];
    dir = rng.sign();
    x = nearX + dir * -rng.range(500, 900);
    y = fixed + (dir > 0 ? 24 : -24);
    angle = dir > 0 ? 0 : Math.PI;
  }
  const car = makeCar(kind, x, y, angle, rng.pick(kind.colors));
  car.driver = 'traffic';
  car.axis = axis;
  car.fixed = fixed;
  car.dir = dir;
  car.cruise = rng.range(0.45, 0.7) * kind.top;
  return car;
}

// Traffic drives its avenue or street, turning at intersections now and then.
export function stepTrafficCar(car, dt, rng) {
  car.speed = car.cruise;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  const cross = car.axis === 'v' ? streetCentres() : avenueCentres();
  const along = car.axis === 'v' ? car.y : car.x;
  for (const c of cross) {
    if (Math.abs(along - c) < 8 && rng.chance(0.35)) {
      // Turn onto the crossing road.
      const dir = rng.sign();
      if (car.axis === 'v') {
        car.axis = 'h';
        car.fixed = c;
        car.dir = dir;
        car.y = c + (dir > 0 ? 24 : -24);
        car.angle = dir > 0 ? 0 : Math.PI;
      } else {
        car.axis = 'v';
        car.fixed = c;
        car.dir = dir;
        car.x = c + (dir > 0 ? -24 : 24);
        car.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      break;
    }
  }
  // Keep the lane offset honest after turns and drifts.
  if (car.axis === 'v') car.x += (car.fixed + (car.dir > 0 ? -24 : 24) - car.x) * Math.min(1, dt * 2);
  else car.y += (car.fixed + (car.dir > 0 ? 24 : -24) - car.y) * Math.min(1, dt * 2);
  return car.x < -120 || car.x > WORLD_W + 120 || car.y < -120 || car.y > WORLD_H + 120;
}

// Arcade driving for the player's car. input: {throttle -1..1, steer -1..1, brake bool}
export function stepPlayerCar(car, input, dt, city) {
  const k = car.kind;
  const accel = input.throttle * k.accel;
  car.speed += accel * dt;
  // Rolling drag and braking.
  car.speed -= car.speed * 0.55 * dt;
  if (input.brake) car.speed -= Math.sign(car.speed) * 320 * dt;
  car.speed = clamp(car.speed, -k.top * 0.38, k.top);
  if (Math.abs(car.speed) < 2 && input.throttle === 0) car.speed = 0;
  const steerAuthority = clamp(Math.abs(car.speed) / 60, 0, 1) * (input.handbrake ? 1.5 : 1);
  car.angle += input.steer * k.grip * 0.42 * steerAuthority * Math.sign(car.speed) * dt;
  const vx = Math.cos(car.angle) * car.speed;
  const vy = Math.sin(car.angle) * car.speed;
  car.x += vx * dt;
  car.y += vy * dt;
  car.x = clamp(car.x, 24, WORLD_W - 24);
  car.y = clamp(car.y, 24, WORLD_H - 24);
  // Buildings are solid: slide out and scrub speed.
  for (const b of city.buildings) {
    const [nx, ny] = pushOutOfRect(car.x, car.y, 26, b);
    if (nx !== car.x || ny !== car.y) {
      car.x = nx;
      car.y = ny;
      car.speed *= 0.55;
      car.bumped = true;
    }
  }
  return car;
}

// Simple pursuit steering shared by police cars: aim at a point ahead of the
// target, full throttle, no reverse unless stuck.
export function stepChaseCar(car, tx, ty, dt, city) {
  const k = car.kind;
  const targetAngle = angleTo(car.x, car.y, tx, ty);
  car.angle = turnToward(car.angle, targetAngle, k.grip * 0.5 * dt);
  car.speed += k.accel * dt;
  car.speed -= car.speed * 0.5 * dt;
  car.speed = clamp(car.speed, 0, k.top);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.x = clamp(car.x, 24, WORLD_W - 24);
  car.y = clamp(car.y, 24, WORLD_H - 24);
  for (const b of city.buildings) {
    const [nx, ny] = pushOutOfRect(car.x, car.y, 26, b);
    if (nx !== car.x || ny !== car.y) {
      car.x = nx;
      car.y = ny;
      car.speed *= 0.4;
    }
  }
}

export function drawCar(ctx, car) {
  const { w, l } = car.kind;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow
  ctx.fillStyle = 'rgba(20,16,40,0.25)';
  ctx.fillRect(-l / 2 + 3, -w / 2 + 4, l, w);
  // Body
  ctx.fillStyle = car.color;
  roundRect(ctx, -l / 2, -w / 2, l, w, 9);
  ctx.fill();
  // Cabin and glass
  ctx.fillStyle = 'rgba(24,32,48,0.9)';
  roundRect(ctx, -l * 0.08, -w * 0.36, l * 0.34, w * 0.72, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,220,255,0.55)';
  roundRect(ctx, l * 0.2, -w * 0.33, l * 0.09, w * 0.66, 4);
  ctx.fill();
  // Wheels
  ctx.fillStyle = '#16181d';
  const ww = 9, wl = 16;
  ctx.fillRect(-l / 2 + 6, -w / 2 - 3, wl, ww);
  ctx.fillRect(l / 2 - 22, -w / 2 - 3, wl, ww);
  ctx.fillRect(-l / 2 + 6, w / 2 - 6, wl, ww);
  ctx.fillRect(l / 2 - 22, w / 2 - 6, wl, ww);
  if (car.kind.taxi) {
    ctx.fillStyle = '#16181d';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, 3);
  }
  if (car.driver === 'cop') {
    ctx.fillStyle = '#274156';
    roundRect(ctx, -l / 2 + 6, -w * 0.22, l - 12, w * 0.44, 5);
    ctx.fill();
    // Light bar: red/blue halves that alternate with car.flash.
    const on = car.flash % 1 < 0.5;
    ctx.fillStyle = on ? '#ff3b30' : '#5e2b97';
    ctx.fillRect(-8, -w / 2 + 3, 16, 6);
    ctx.fillStyle = on ? '#0a84ff' : '#7a1f1f';
    ctx.fillRect(-8, w / 2 - 9, 16, 6);
  }
  if (car.health < 55) {
    ctx.fillStyle = `rgba(60,60,60,${0.25 + (55 - car.health) / 90})`;
    roundRect(ctx, -l / 2, -w / 2, l * 0.3, w, 8);
    ctx.fill();
  }
  if (car.marked) {
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2.5;
    roundRect(ctx, -l / 2 - 4, -w / 2 - 4, l + 8, w + 8, 11);
    ctx.stroke();
  }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
