// The living traffic of Port Azura: parked cars waiting to be borrowed, traffic
// driving the grid by its lanes, police who hunt the player, and pedestrians who
// stroll the sidewalks and dive out of the way. Cars share one arcade physics
// step (throttle along the heading, lateral grip, a handbrake that loosens it);
// the three kinds of driver differ only in how they steer.

import { BLOCK, CAR_KINDS, CITY_H, CITY_W, COLS, ROAD, ROWS, SAND } from './config.js';
import { angleDelta, clamp, dist } from './random.js';
import { blockX, blockY, groundAt, hRoadC, hRoadY, laneEast, laneNorth, laneSouth, laneWest, resolveCollisions, vRoadC, vRoadX } from './city.js';

let nextId = 1;

export function createCar(x, y, angle, kind, role, rng) {
  const spec = CAR_KINDS[kind];
  return {
    id: nextId++, x, y, angle, vx: 0, vy: 0,
    kind, role, color: rng.pick(spec.colors),
    hp: 100, driver: role === 'traffic' || role === 'police',
    axis: 'h', road: 0, next: 0, targetSpeed: 0, stuckT: 0, reverseT: 0,
    honkT: 0, gold: false, missionCar: false, smokeT: 0,
  };
}

/** Collision radius of a car, by kind. */
export const carRadius = (car) => (car.kind === 'truck' ? 23 : 19);

/** Speed along the car's own heading (negative in reverse). */
export const forwardSpeed = (car) => car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);

/**
 * One physics step for any car. steer is -1..1 (or a desired angle when
 * opts.aimAt is set), throttle -1..1, handbrake loosens the grip so the car slides.
 */
export function stepCarPhysics(city, car, dt, steer, throttle, opts = {}) {
  const spec = CAR_KINDS[car.kind];
  const fwd = forwardSpeed(car);
  const turnRate = 2.4 * clamp(Math.abs(fwd) / 90, 0, 1) * (fwd < 0 ? -1 : 1);
  if (opts.aimAt !== undefined) {
    const want = clamp(angleDelta(car.angle, opts.aimAt), -1, 1);
    car.angle += clamp(want * 3.2, -turnRate, turnRate) * dt * 2.2;
  } else {
    car.angle += steer * turnRate * dt;
  }
  const accel = throttle >= 0 ? spec.accel * throttle : spec.accel * 0.7 * throttle;
  car.vx += Math.cos(car.angle) * accel * dt;
  car.vy += Math.sin(car.angle) * accel * dt;
  // Rolling drag and the top speed.
  const drag = Math.exp(-0.55 * dt);
  car.vx *= drag;
  car.vy *= drag;
  const speed = Math.hypot(car.vx, car.vy);
  const ground = groundAt(city, car.x, car.y);
  const topHere = spec.top * (ground === 'sand' ? 0.55 : 1);
  if (speed > topHere) {
    car.vx *= topHere / speed;
    car.vy *= topHere / speed;
  }
  // Grip: kill the sideways part of the velocity, less of it on the handbrake.
  const grip = opts.handbrake ? 1.6 : spec.grip;
  const latX = -Math.sin(car.angle);
  const latY = Math.cos(car.angle);
  const lat = car.vx * latX + car.vy * latY;
  const kill = Math.min(1, grip * dt);
  car.vx -= latX * lat * kill;
  car.vy -= latY * lat * kill;
  if (opts.handbrake) {
    car.vx *= Math.exp(-1.4 * dt);
    car.vy *= Math.exp(-1.4 * dt);
  }
  const before = { x: car.x, y: car.y };
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  const hit = resolveCollisions(city, car, carRadius(car));
  if (hit) {
    const impact = speed;
    // Slide along the wall: keep the velocity component the move actually made.
    car.vx = (car.x - before.x) / Math.max(dt, 0.001) * 0.4;
    car.vy = (car.y - before.y) / Math.max(dt, 0.001) * 0.4;
    return impact > 60 ? impact : 0;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Traffic: cars that follow the lanes from intersection to intersection.

function laneWaypoint(car) {
  if (car.axis === 'h') {
    const y = Math.cos(car.angle) > 0 ? laneEast(hRoadY(car.road)) : laneWest(hRoadY(car.road));
    return { x: vRoadC(car.next), y };
  }
  const x = Math.sin(car.angle) > 0 ? laneSouth(vRoadX(car.road)) : laneNorth(vRoadX(car.road));
  return { x, y: hRoadC(car.next) };
}

const HEADING_ANGLE = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };
const RIGHT_OF = { E: 'S', S: 'W', W: 'N', N: 'E' };
const LEFT_OF = { E: 'N', N: 'W', W: 'S', S: 'E' };

function carHeading(car) {
  if (car.axis === 'h') return Math.cos(car.angle) > 0 ? 'E' : 'W';
  return Math.sin(car.angle) > 0 ? 'S' : 'N';
}

/** Put the car on the leg that leaves intersection (atI, atJ) in the given heading. */
function setLeg(car, heading, atI, atJ) {
  car.angle = HEADING_ANGLE[heading];
  if (heading === 'E' || heading === 'W') {
    car.axis = 'h';
    car.road = atJ;
    car.next = atI + (heading === 'E' ? 1 : -1);
  } else {
    car.axis = 'v';
    car.road = atI;
    car.next = atJ + (heading === 'S' ? 1 : -1);
  }
}

function chooseNextLeg(rng, car) {
  // At an intersection: pick a new leg (straight, left or right) among the ones
  // the grid still offers, never a U-turn.
  const heading = carHeading(car);
  const atI = car.axis === 'h' ? car.next : car.road;
  const atJ = car.axis === 'h' ? car.road : car.next;
  const can = { E: atI < COLS, W: atI > 0, S: atJ < ROWS, N: atJ > 0 };
  const options = [];
  if (can[heading]) options.push(heading);
  if (can[RIGHT_OF[heading]]) options.push(RIGHT_OF[heading]);
  if (can[LEFT_OF[heading]]) options.push(LEFT_OF[heading]);
  setLeg(car, options.length ? rng.pick(options) : heading, atI, atJ);
}

/** Snap a car that was driving freely (a leaving police car) onto its nearest leg. */
export function adoptNearestLeg(car) {
  const step = BLOCK + ROAD;
  const i = clamp(Math.round((car.x - ROAD / 2) / step), 0, COLS);
  const j = clamp(Math.round((car.y - ROAD / 2) / step), 0, ROWS);
  const heading = Math.abs(car.vx) > Math.abs(car.vy) ? (car.vx > 0 ? 'E' : 'W') : (car.vy > 0 ? 'S' : 'N');
  if (heading === 'E' || heading === 'W') setLeg(car, heading, i, j);
  else setLeg(car, heading, i, j);
  car.targetSpeed = CAR_KINDS[car.kind].top * 0.5;
}

export function spawnTrafficCar(state, rng) {
  const i = rng.int(0, COLS);
  const j = rng.int(0, ROWS);
  const axisH = rng.chance(0.5);
  const kind = rng.pick(['sedan', 'sedan', 'hatch', 'hatch', 'sports', 'truck']);
  let car;
  if (axisH) {
    const east = rng.chance(0.5);
    car = createCar(vRoadC(i), east ? laneEast(hRoadY(j)) : laneWest(hRoadY(j)), east ? 0 : Math.PI, kind, 'traffic', rng);
    car.axis = 'h';
    car.road = j;
    car.next = clamp(i + (east ? 1 : -1), 0, COLS);
  } else {
    const south = rng.chance(0.5);
    car = createCar(south ? laneSouth(vRoadX(i)) : laneNorth(vRoadX(i)), hRoadC(j), south ? Math.PI / 2 : -Math.PI / 2, kind, 'traffic', rng);
    car.axis = 'v';
    car.road = i;
    car.next = clamp(j + (south ? 1 : -1), 0, ROWS);
  }
  car.targetSpeed = CAR_KINDS[kind].top * rng.range(0.42, 0.6);
  return car;
}

function stepTrafficCar(state, car, dt) {
  const wp = laneWaypoint(car);
  const d = dist(car.x, car.y, wp.x, wp.y);
  if (d < 42) chooseNextLeg(state.rng, car);
  // Something ahead? Brake for cars, the player and pedestrians in the lane.
  let blocked = false;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  for (const other of state.cars) {
    if (other === car) continue;
    const rel = (other.x - car.x) * fx + (other.y - car.y) * fy;
    const side = Math.abs((other.x - car.x) * -fy + (other.y - car.y) * fx);
    if (rel > 0 && rel < 64 && side < 20) { blocked = true; break; }
  }
  if (!blocked) {
    const p = state.player;
    const rel = (p.x - car.x) * fx + (p.y - car.y) * fy;
    const side = Math.abs((p.x - car.x) * -fy + (p.y - car.y) * fx);
    if (rel > 0 && rel < 52 && side < 18) blocked = true;
  }
  if (!blocked) {
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const rel = (ped.x - car.x) * fx + (ped.y - car.y) * fy;
      const side = Math.abs((ped.x - car.x) * -fy + (ped.y - car.y) * fx);
      if (rel > 0 && rel < 46 && side < 16) { blocked = true; break; }
    }
  }
  const aim = Math.atan2(wp.y - car.y, wp.x - car.x);
  const fwd = forwardSpeed(car);
  const throttle = blocked ? (fwd > 12 ? -1 : 0) : (fwd < car.targetSpeed ? 0.75 : 0);
  stepCarPhysics(state.city, car, dt, 0, throttle, { aimAt: aim });
}

// ---------------------------------------------------------------------------
// Police: they do not bother with lanes. They hunt.

export function spawnPoliceCar(state, rng) {
  // Appear at an intersection most of a screen away from the player.
  const p = state.player;
  let best = null;
  for (let tries = 0; tries < 12; tries += 1) {
    const i = rng.int(0, COLS);
    const j = rng.int(0, ROWS);
    const x = vRoadC(i);
    const y = hRoadC(j);
    const d = dist(x, y, p.x, p.y);
    if (d > 640 && d < 1150) { best = { x, y }; break; }
    if (!best || d > dist(best.x, best.y, p.x, p.y)) best = { x, y };
  }
  const car = createCar(best.x, best.y, Math.atan2(p.y - best.y, p.x - best.x), 'police', 'police', rng);
  car.color = '#f4f6f8';
  return car;
}

function stepPoliceCar(state, car, dt) {
  const p = state.player;
  const targetX = p.x + (p.car ? p.car.vx * 0.35 : 0);
  const targetY = p.y + (p.car ? p.car.vy * 0.35 : 0);
  const d = dist(car.x, car.y, p.x, p.y);
  const aim = Math.atan2(targetY - car.y, targetX - car.x);
  const fwd = forwardSpeed(car);
  const top = CAR_KINDS.police.top * (d > 520 ? 1.04 : 0.94);
  // If the hunt stalls against a wall, back out and come again.
  if (Math.abs(fwd) < 14 && d > 90) car.stuckT += dt; else car.stuckT = 0;
  if (car.stuckT > 1.1) { car.reverseT = 0.55; car.stuckT = 0; }
  let throttle;
  if (car.reverseT > 0) {
    car.reverseT -= dt;
    throttle = -1;
    stepCarPhysics(state.city, car, dt, 0, throttle, { aimAt: car.angle + Math.PI });
    return;
  }
  throttle = fwd < top ? 1 : 0;
  // On foot and close, they stop to make the arrest instead of running you down.
  if (!p.car && d < 58) throttle = fwd > 8 ? -1 : 0;
  stepCarPhysics(state.city, car, dt, 0, throttle, { aimAt: aim });
}

// ---------------------------------------------------------------------------
// Pedestrians: a stroll around their block, a sprint away from trouble.

const SHIRTS = ['#ff6b9d', '#ffd93d', '#6bcbff', '#95e06b', '#f2f0eb', '#ff9a5c', '#c39bff', '#4ad8c2'];
const SKINS = ['#f2c79b', '#c68863', '#8c5a3c', '#6e4230', '#ffd9b3'];

export function createPed(x, y, rng, block) {
  return {
    x, y, angle: rng.range(0, Math.PI * 2), speed: 0,
    walkSpeed: rng.range(48, 82), block: block ?? null,
    corner: rng.int(0, 3), state: 'walk', downT: 0, fleeT: 0,
    threatX: 0, threatY: 0, shirt: rng.pick(SHIRTS), skin: rng.pick(SKINS),
    phase: rng.range(0, Math.PI * 2), beach: !block,
  };
}

export function spawnPeds(state, rng) {
  const peds = [];
  for (let i = 0; i < COLS; i += 1) {
    for (let j = 0; j < ROWS; j += 1) {
      const n = rng.int(1, 2);
      for (let k = 0; k < n; k += 1) {
        const bx = blockX(i) + 16;
        const by = blockY(j) + 16;
        peds.push(createPed(bx + rng.range(0, BLOCK - 32), by, rng, { i, j }));
      }
    }
  }
  for (let k = 0; k < 10; k += 1) {
    peds.push(createPed(CITY_W + rng.range(36, SAND - 50), rng.range(80, CITY_H - 80), rng, null));
  }
  return peds;
}

function blockCorner(ped) {
  const bx = blockX(ped.block.i) + 16;
  const by = blockY(ped.block.j) + 16;
  const s = BLOCK - 32;
  const corners = [[bx, by], [bx + s, by], [bx + s, by + s], [bx, by + s]];
  return corners[ped.corner % 4];
}

function stepPed(state, ped, dt) {
  if (ped.state === 'wait' || ped.state === 'toCar') return; // a mission is moving this one
  if (ped.state === 'down') {
    ped.downT -= dt;
    if (ped.downT <= 0) { ped.state = 'flee'; ped.fleeT = 3; ped.threatX = state.player.x; ped.threatY = state.player.y; }
    return;
  }
  let tx;
  let ty;
  let speed = ped.walkSpeed;
  if (ped.state === 'flee') {
    ped.fleeT -= dt;
    if (ped.fleeT <= 0) ped.state = 'walk';
    const away = Math.atan2(ped.y - ped.threatY, ped.x - ped.threatX);
    tx = ped.x + Math.cos(away) * 90;
    ty = ped.y + Math.sin(away) * 90;
    speed = 178;
  } else if (ped.beach) {
    // Beach strollers wander up and down the sand.
    tx = ped.x;
    ty = ped.y + Math.sin(state.time * 0.11 + ped.phase) * 120;
    if (dist(ped.x, ped.y, tx, ty) < 8) ped.phase += Math.PI;
  } else {
    const c = blockCorner(ped);
    tx = c[0];
    ty = c[1];
    if (dist(ped.x, ped.y, tx, ty) < 7) ped.corner = (ped.corner + 1) % 4;
  }
  const want = Math.atan2(ty - ped.y, tx - ped.x);
  ped.angle += clamp(angleDelta(ped.angle, want), -6 * dt, 6 * dt);
  ped.speed = speed;
  ped.x += Math.cos(ped.angle) * speed * dt;
  ped.y += Math.sin(ped.angle) * speed * dt;
  resolveCollisions(state.city, ped, 9);
}

// ---------------------------------------------------------------------------
// The per-frame entity update and the collisions between them.

/** Events the caller turns into crimes, sounds and score. */
export function stepEntities(state, dt) {
  const events = [];
  const rng = state.rng;
  const p = state.player;

  // Traffic population: keep the streets alive near the player.
  const traffic = state.cars.filter((c) => c.role === 'traffic');
  if (traffic.length < 13) {
    const car = spawnTrafficCar(state, rng);
    if (dist(car.x, car.y, p.x, p.y) > 420) state.cars.push(car);
  }
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    const car = state.cars[i];
    if ((car.role === 'traffic' || car.role === 'police') && dist(car.x, car.y, p.x, p.y) > 1500 && car.role === 'traffic') {
      state.cars.splice(i, 1);
    }
  }

  // Police population follows the wanted stars.
  const want = state.wanted.stars;
  const cops = state.cars.filter((c) => c.role === 'police');
  const copTarget = state.mode === 'play' ? Math.min(want + 1, 6) : 0;
  if (want > 0 && cops.length < copTarget) {
    state.policeSpawnT -= dt;
    if (state.policeSpawnT <= 0) {
      state.cars.push(spawnPoliceCar(state, rng));
      state.policeSpawnT = 1.6;
    }
  } else if (want === 0) {
    for (const cop of cops) {
      cop.role = 'leaving';
      adoptNearestLeg(cop);
    }
  }

  for (const car of state.cars) {
    if (car === p.car || car.role === 'parked' || car.role === 'wrecked') continue;
    if (car.role === 'traffic') stepTrafficCar(state, car, dt);
    else if (car.role === 'police') stepPoliceCar(state, car, dt);
    else if (car.role === 'leaving') {
      stepTrafficCar(state, car, dt);
      if (dist(car.x, car.y, p.x, p.y) > 900) car.role = 'gone';
    }
    if (car.hp <= 0 && car.role !== 'wrecked') {
      car.role = 'wrecked';
      car.driver = false;
      events.push({ type: 'wrecked', car });
    }
  }
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    if (state.cars[i].role === 'gone') state.cars.splice(i, 1);
  }

  // Car against car: shove apart, trade paint, report the hard hits.
  const cars = state.cars;
  for (let a = 0; a < cars.length; a += 1) {
    for (let b = a + 1; b < cars.length; b += 1) {
      const A = cars[a];
      const B = cars[b];
      const rr = carRadius(A) + carRadius(B) - 4;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      const rel = Math.abs((A.vx - B.vx) * nx + (A.vy - B.vy) * ny);
      if (A.role !== 'parked') { A.x -= nx * push; A.y -= ny * push; }
      if (B.role !== 'parked') { B.x += nx * push; B.y += ny * push; }
      const swap = 0.35;
      const avn = A.vx * nx + A.vy * ny;
      const bvn = B.vx * nx + B.vy * ny;
      if (A.role !== 'parked') { A.vx += (bvn - avn) * swap * nx; A.vy += (bvn - avn) * swap * ny; }
      if (B.role !== 'parked') { B.vx += (avn - bvn) * swap * nx; B.vy += (avn - bvn) * swap * ny; }
      if (rel > 55) {
        const dmg = (rel - 40) * 0.14;
        if (A.role !== 'parked') A.hp -= dmg;
        if (B.role !== 'parked') B.hp -= dmg;
        events.push({ type: 'carHit', a: A, b: B, impact: rel, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
      }
    }
  }

  // Cars against pedestrians: most dive clear; the rest go down.
  for (const car of cars) {
    const speed = Math.hypot(car.vx, car.vy);
    if (speed < 55) continue;
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      if (dist(car.x, car.y, ped.x, ped.y) < carRadius(car) + 8) {
        if (rng.chance(0.62)) {
          ped.state = 'flee';
          ped.fleeT = 2.5;
          ped.threatX = car.x;
          ped.threatY = car.y;
          events.push({ type: 'pedDive', ped, car });
        } else {
          ped.state = 'down';
          ped.downT = speed > 300 ? 9 : 4.5;
          events.push({ type: 'pedHit', ped, car, speed });
        }
      }
    }
  }

  for (const ped of state.peds) stepPed(state, ped, dt);
  return events;
}

/** Parked cars for the lots and the kerbs, placed once at world creation. */
export function fillParkedCars(state, rng) {
  const goldSpot = { x: blockX(8) + 120, y: blockY(2) + 204 };
  for (const lot of state.city.lots) {
    for (const spot of lot.spots) {
      if (dist(spot.x, spot.y, goldSpot.x, goldSpot.y) < 30) continue; // the story's car parks here
      if (!rng.chance(lot.dealer ? 0.85 : 0.6)) continue;
      const kind = rng.pick(['sedan', 'hatch', 'hatch', 'sedan', 'truck', 'sports']);
      const car = createCar(spot.x, spot.y, spot.angle, kind, 'parked', rng);
      car.driver = false;
      state.cars.push(car);
    }
  }
  // Kerbside parking on the sidewalk strips beside a few avenues, clear of the lanes.
  for (let k = 0; k < 12; k += 1) {
    const i = rng.int(0, COLS - 1);
    const j = rng.int(1, ROWS);
    const northSide = rng.chance(0.5);
    const car = createCar(
      blockX(i) + rng.range(30, BLOCK - 30),
      hRoadY(j) + (northSide ? -14 : ROAD + 14),
      0, rng.pick(['sedan', 'hatch', 'truck']), 'parked', rng,
    );
    car.driver = false;
    state.cars.push(car);
  }
  // The car Rook arrives with, parked by the boardwalk.
  const start = createCar(CITY_W - 66, hRoadC(2) + 52, -Math.PI / 2, 'hatch', 'parked', rng);
  start.color = '#27b6c9';
  start.driver = false;
  state.cars.push(start);
}
