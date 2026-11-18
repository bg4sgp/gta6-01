// The staged scenes behind ?shot=cover|onfoot|chase|finale&seed=N, named by
// shots.json. Each one starts the real game, arranges its people and cars, and
// then plays the real rules forward under a simple pilot for a couple of
// seconds, so the frame the screenshot takes is a moment the game itself made.

import { CITY_W, SAND } from './config.js';
import { hRoadC, hRoadY, laneEast, laneWest, vRoadC } from './city.js';
import { createCar } from './entities.js';
import { clamp, dist } from './random.js';

const WARM = 1 / 30;

/** A pilot that holds a car in one lane of one road, fast. */
function lanePilot(state, roadJ, laneY, dirAngle) {
  return () => {
    const car = state.player.car;
    if (!car) return;
    const steer = clamp((laneY - car.y) * 0.02, -0.7, 0.7) + clamp((dirAngle - car.angle) * 1.4, -0.8, 0.8);
    state.drive = { throttle: 0.92, steer, handbrake: false };
    void roadJ;
  };
}

function clearTrafficNear(state, x, y, r) {
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    const c = state.cars[i];
    if (c.role === 'traffic' && dist(c.x, c.y, x, y) < r) state.cars.splice(i, 1);
  }
}

/** Clear traffic out of a whole road corridor, so a staged drive stays a drive. */
function clearCorridor(state, laneY, xFrom, xTo) {
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    const c = state.cars[i];
    if (c.role === 'traffic' && Math.abs(c.y - laneY) < 130 && c.x > xFrom && c.x < xTo) state.cars.splice(i, 1);
  }
}

function addCop(state, x, y, angle) {
  const cop = createCar(x, y, angle, 'police', 'police', state.rng);
  state.cars.push(cop);
  return cop;
}

function warm(state, help, seconds) {
  const steps = Math.round(seconds / WARM);
  for (let i = 0; i < steps; i += 1) help.step(WARM);
}

/**
 * Stage the named scene on a fresh play state. `help` is the game's own verbs:
 * step(dt), enterCar(car), heat(n), banner(title, text, seconds),
 * phone(from, text), beginMissionAt(index).
 */
export function stageShot(name, state, help) {
  const p = state.player;
  if (name === 'onfoot') {
    // Rook on the sand south of Club Solstice, a red sports car waiting, the city behind.
    p.x = CITY_W + 138;
    p.y = hRoadC(3) + 128;
    p.angle = Math.PI;
    p.aimAngle = Math.PI;
    const car = createCar(CITY_W + 182, hRoadC(3) + 106, -0.35, 'sports', 'parked', state.rng);
    car.color = '#e33f4e';
    car.driver = false;
    state.cars.push(car);
    help.beginMissionAt(0);
    warm(state, help, 1.6);
    return;
  }
  if (name === 'chase') {
    // Four stars on the westbound avenue: three cruisers stacked up behind.
    const y = laneWest(hRoadY(5));
    const car = createCar(vRoadC(7), y, Math.PI, 'sports', 'parked', state.rng);
    car.color = '#e33f4e';
    car.driver = false;
    state.cars.push(car);
    clearCorridor(state, y, car.x - 1750, car.x + 260);
    help.enterCar(car);
    help.heat(11);
    addCop(state, car.x + 165, y - 8, Math.PI);
    addCop(state, car.x + 275, y + 30, Math.PI);
    addCop(state, car.x + 395, y - 34, Math.PI);
    help.beginMissionAt(4);
    state.pilotFn = lanePilot(state, 5, y, Math.PI);
    warm(state, help, 2.2);
    return;
  }
  if (name === 'finale') {
    // The last job done: Rook at the boat, the law watching from the sand.
    state.missions.done = true;
    state.missions.index = state.missions.defs.length;
    state.cash = 4150;
    const boat = state.city.specials.boat;
    p.x = boat.x - 118;
    p.y = boat.y + 4;
    p.angle = 0;
    p.aimAngle = 0;
    const pierY = state.city.specials.pier.y + state.city.specials.pier.h / 2;
    const copA = createCar(CITY_W + SAND - 96, pierY - 34, 0.4, 'police', 'parked', state.rng);
    const copB = createCar(CITY_W + SAND - 130, pierY + 36, -0.3, 'police', 'parked', state.rng);
    copA.driver = false;
    copB.driver = false;
    state.cars.push(copA, copB);
    help.banner('Last Boat Out — complete', '+$1,500 · The bay is yours', 30);
    help.phone('Viv', 'It\'s done. Port Azura is yours, Rook.');
    warm(state, help, 0.9);
    return;
  }
  // cover (and the default): mid-job downtown, two stars, traffic all around.
  const y = laneEast(hRoadY(4));
  const car = createCar(vRoadC(4), y, 0, 'sports', 'parked', state.rng);
  car.color = '#e33f4e';
  car.driver = false;
  state.cars.push(car);
  clearTrafficNear(state, car.x, car.y, 300);
  help.enterCar(car);
  help.heat(3.4);
  addCop(state, car.x - 175, y + 6, 0);
  addCop(state, car.x - 300, y - 26, 0);
  help.beginMissionAt(1);
  state.pilotFn = lanePilot(state, 4, y, 0);
  warm(state, help, 2.3);
}
