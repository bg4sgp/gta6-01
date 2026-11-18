// Vice Heat — Port Azura: the game itself. This module owns the state and the
// frame: it reads the player's hands (or the screenshot pilot's), drives Rook on
// foot and behind the wheel, runs the traffic, the police and Viv's missions,
// applies the wanted heat, and draws it all. Everything else is a library for
// this file: city.js the map, entities.js the crowds, missions.js the story,
// render.js the pictures, audio.js the noise.

import { FOOT_RADIUS, FOOT_SPEED, FOOT_SPRINT, HEAT, HEAT_DECAY, HEAT_SIGHT, PLAYER_HP, STAR_THRESHOLDS, VIEW_H, VIEW_W, WORLD_W, CITY_H } from './config.js';
import { angleDelta, clamp, dist, makeRng } from './random.js';
import { createCity, groundAt, resolveCollisions } from './city.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createPed, fillParkedCars, forwardSpeed, spawnPeds, stepCarPhysics, stepEntities } from './entities.js';
import { beginMission, createMissions, missionHud, stepMissions } from './missions.js';
import { drawEndScreen, drawHUD, drawHelpScreen, drawPauseScreen, drawTitleScreen, drawWorld } from './render.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d');
const input = createInput(canvas);
const audio = createAudio();
const SAVE_KEY = 'viceheat-save-v1';
const CAR_NAMES = { sedan: 'Sedan', hatch: 'Hatchback', sports: 'Sports car', truck: 'Pickup', police: 'Police cruiser' };

// ---------------------------------------------------------------------------
// State

function createGame(seed) {
  const rng = makeRng(seed);
  const city = createCity(rng);
  const state = {
    rng, city, time: 0, seed,
    mode: 'title',
    ui: { screen: 'title', menuIndex: 0, menu: ['New Game'], muted: false },
    player: {
      x: city.specials.boardwalk.x + 16, y: city.specials.boardwalk.y + 26,
      angle: -Math.PI / 2, aimAngle: Math.PI, hp: PLAYER_HP,
      car: null, moving: false, bustMeter: 0, fireT: 0, punchT: 0, hurtT: 0,
    },
    cars: [], peds: [],
    wanted: { heat: 0, stars: 0, lastCrimeT: -99, seen: false },
    cash: 60,
    camera: { x: 0, y: 0 },
    skids: [], particles: [], tracers: [], messages: [], banner: null, prompt: null,
    missions: createMissions(city),
    missionHud: null,
    policeSpawnT: 0, crimeT: {}, shineT: 0, pendingEnding: 0,
    drive: { throttle: 0, steer: 0, handbrake: false },
    move: { x: 0, y: 0, sprint: false },
    pilotFn: null, shotMode: false,
    stats: { crimes: 0, shotsFired: 0 },
  };
  state.peds = spawnPeds(state, rng);
  fillParkedCars(state, rng);
  return state;
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: state.cash,
      missionIndex: state.missions.index,
      done: state.missions.done,
      stashes: state.city.stashes.filter((s) => s.taken).map((s) => s.id),
    }));
  } catch { /* a browser that refuses storage just plays session to session */ }
}

// ---------------------------------------------------------------------------
// Small verbs the rest of the game (and the screenshot scenes) share.

function phone(state, from, text) {
  state.messages.push({ from, text, until: state.time + 7.5 });
  if (state.messages.length > 3) state.messages.shift();
}

function banner(state, title, text, seconds = 3.6) {
  state.banner = { title, text, until: state.time + seconds };
}

function addHeat(state, amount, kind = 'crime') {
  const now = state.time;
  if (kind !== 'crime' && state.crimeT[kind] && now - state.crimeT[kind] < 1.4) return;
  state.crimeT[kind] = now;
  state.wanted.heat += amount;
  state.wanted.lastCrimeT = now;
  state.stats.crimes += 1;
}

function setStars(state, n) {
  state.wanted.heat = Math.max(state.wanted.heat, STAR_THRESHOLDS[n - 1] + 0.05);
  state.wanted.lastCrimeT = state.time;
}

function sparks(state, x, y, n, color = '#ffd76a') {
  for (let i = 0; i < n; i += 1) {
    const a = state.rng.range(0, Math.PI * 2);
    const sp = state.rng.range(30, 190);
    state.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: state.rng.range(0.25, 0.7), color, size: state.rng.range(1.4, 3),
    });
  }
}

function enterCar(state, car) {
  const p = state.player;
  if (car.role === 'traffic' && car.driver) {
    // The driver is pulled out and runs: a witness, if anyone is watching.
    car.driver = false;
    const ped = createPed(car.x + 14, car.y + 10, state.rng, null);
    ped.state = 'flee';
    ped.fleeT = 4;
    ped.threatX = p.x;
    ped.threatY = p.y;
    state.peds.push(ped);
    const witnessed = state.peds.some((w) => w !== ped && dist(w.x, w.y, car.x, car.y) < 300)
      || state.cars.some((c) => c.role === 'police' && dist(c.x, c.y, car.x, car.y) < HEAT_SIGHT);
    addHeat(state, witnessed ? HEAT.stealCar : HEAT.stealCar * 0.5);
    banner(state, 'Stolen', car.gold ? 'The Aurelia GT is yours. Run.' : 'Somebody is calling that in…', 2.2);
  }
  if (car.kind === 'police' && car.role === 'police') addHeat(state, 3);
  car.role = 'player';
  p.car = car;
  p.x = car.x;
  p.y = car.y;
  audio.door();
}

function exitCar(state) {
  const p = state.player;
  const car = p.car;
  if (!car) return;
  car.role = 'parked';
  car.driver = false;
  p.car = null;
  p.x = car.x + Math.cos(car.angle - Math.PI / 2) * 27;
  p.y = car.y + Math.sin(car.angle - Math.PI / 2) * 27;
  resolveCollisions(state.city, p, FOOT_RADIUS);
  audio.door();
  audio.engine(null);
}

// ---------------------------------------------------------------------------
// Events from the entities and the missions become cash, heat, sound and story.

function applyEvents(state, events) {
  for (const ev of events) {
    if (ev.type === 'phone') { phone(state, ev.from, ev.text); audio.phone(); }
    else if (ev.type === 'banner') banner(state, ev.title, ev.text);
    else if (ev.type === 'cash') { state.cash += ev.amount; audio.cash(); saveGame(state); }
    else if (ev.type === 'setStars') setStars(state, ev.n);
    else if (ev.type === 'sting') audio.sting();
    else if (ev.type === 'fail') audio.fail();
    else if (ev.type === 'pickup') audio.pickup();
    else if (ev.type === 'storyComplete') { state.pendingEnding = 2.4; saveGame(state); }
    else if (ev.type === 'wrecked') {
      sparks(state, ev.car.x, ev.car.y, 22, '#ff9a5c');
      if (dist(ev.car.x, ev.car.y, state.player.x, state.player.y) < 700) audio.crash(true);
    } else if (ev.type === 'carHit') {
      const p = state.player;
      const mine = ev.a === p.car || ev.b === p.car;
      if (mine || dist(ev.x, ev.y, p.x, p.y) < 260) {
        audio.crash(ev.impact > 150);
        sparks(state, ev.x, ev.y, ev.impact > 150 ? 14 : 6);
      }
      if (mine && (ev.a.kind === 'police' || ev.b.kind === 'police')) addHeat(state, HEAT.ramCop, 'ramCop');
    } else if (ev.type === 'pedHit') {
      if (ev.car === state.player.car) {
        addHeat(state, HEAT.hitPed, 'pedHit');
        audio.crash(false);
        state.player.hp -= 2;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The player's frame: hands, feet, wheels, gun.

function readHands(state) {
  const p = state.player;
  if (state.pilotFn) { state.pilotFn(state); return; }
  if (state.shotMode) return;
  if (p.car) {
    state.drive = {
      throttle: (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) + (input.down('KeyS') || input.down('ArrowDown') ? -1 : 0),
      steer: (input.down('KeyA') || input.down('ArrowLeft') ? -1 : 0) + (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0),
      handbrake: input.down('Space'),
    };
  } else {
    const x = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) + (input.down('KeyA') || input.down('ArrowLeft') ? -1 : 0);
    const y = (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0) + (input.down('KeyW') || input.down('ArrowUp') ? -1 : 0);
    const len = Math.hypot(x, y) || 1;
    state.move = { x: x / len, y: y / len, sprint: input.down('ShiftLeft') || input.down('ShiftRight') };
    const wx = state.camera.x + input.mouseX;
    const wy = state.camera.y + input.mouseY;
    p.aimAngle = Math.atan2(wy - p.y, wx - p.x);
  }
}

function stepPlayer(state, dt) {
  const p = state.player;
  p.fireT -= dt;
  p.punchT -= dt;
  p.hurtT -= dt;
  state.prompt = null;

  if (p.car) {
    const car = p.car;
    const impact = stepCarPhysics(state.city, car, dt, state.drive.steer, state.drive.throttle, { handbrake: state.drive.handbrake });
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    const speed = Math.hypot(car.vx, car.vy);
    audio.engine(clamp(speed / 460, 0, 1));
    // Tyres complain: handbrake slides and hard cornering lay rubber down.
    const lat = Math.abs(car.vx * -Math.sin(car.angle) + car.vy * Math.cos(car.angle));
    if ((state.drive.handbrake && speed > 110) || (lat > 95 && speed > 170)) {
      if (state.skids.length < 500) {
        state.skids.push({ x: car.x - Math.cos(car.angle) * 14, y: car.y - Math.sin(car.angle) * 14, angle: car.angle, life: 1 });
      }
      if (state.rng.chance(0.3)) sparks(state, car.x, car.y + 6, 1, 'rgba(200,200,200,0.5)');
    }
    if (impact > 0) {
      car.hp -= Math.max(0, (impact - 55)) * 0.13;
      audio.crash(impact > 160);
      sparks(state, car.x, car.y, impact > 160 ? 12 : 5);
      const copNear = state.cars.some((c) => c.role === 'police' && dist(c.x, c.y, car.x, car.y) < HEAT_SIGHT + 90);
      if (copNear) addHeat(state, HEAT.crashProperty, 'property');
      if (car.hp <= 0) {
        car.hp = 0;
        car.role = 'wrecked';
        p.hp -= 26;
        exitCar(state);
        banner(state, 'Wrecked', 'The car is done. On your feet, Rook.', 2.6);
      }
    }
    if (input.hit('KeyE') && Math.abs(forwardSpeed(car)) < 26) exitCar(state);
    else if (Math.abs(forwardSpeed(car)) < 26) state.prompt = 'E — Get out';
    stepShineShop(state, dt);
    return;
  }

  // On foot.
  audio.engine(null);
  const speed = (state.move.sprint ? FOOT_SPRINT : FOOT_SPEED) * (Math.hypot(state.move.x, state.move.y) > 0 ? 1 : 0);
  p.moving = speed > 0;
  if (p.moving) {
    p.x += state.move.x * speed * dt;
    p.y += state.move.y * speed * dt;
    p.angle = Math.atan2(state.move.y, state.move.x);
    resolveCollisions(state.city, p, FOOT_RADIUS);
    if (groundAt(state.city, p.x, p.y) === 'sand') { /* soft feet, same pace */ }
  }

  // The nearest car is an invitation.
  let nearest = null;
  let nearestD = 58;
  for (const car of state.cars) {
    if (car.role === 'wrecked') continue;
    const d = dist(p.x, p.y, car.x, car.y);
    if (d < nearestD) { nearestD = d; nearest = car; }
  }
  if (nearest) {
    const name = nearest.gold ? 'Aurelia GT' : CAR_NAMES[nearest.kind];
    state.prompt = nearest.driver ? `E — Steal the ${name}` : `E — Enter the ${name}`;
    if (input.hit('KeyE')) enterCar(state, nearest);
  }

  // The gun and the fist.
  if ((input.mouseDown || state.pilotShooting) && p.fireT <= 0) shoot(state);
  if (input.hit('KeyF') && p.punchT <= 0) punch(state);

  // Traffic is heavy and careless: getting clipped hurts.
  if (p.hurtT <= 0) {
    for (const car of state.cars) {
      if (car.role === 'parked' || car.role === 'wrecked') continue;
      const cs = Math.hypot(car.vx, car.vy);
      if (cs > 70 && dist(p.x, p.y, car.x, car.y) < 26) {
        p.hp -= cs * 0.07;
        p.hurtT = 0.7;
        p.x += (car.vx / cs) * 16;
        p.y += (car.vy / cs) * 16;
        resolveCollisions(state.city, p, FOOT_RADIUS);
        audio.crash(false);
        banner(state, 'Clipped', 'Watch the traffic, Rook.', 1.6);
        break;
      }
    }
  }

  // The arrest: cornered on foot, out of breath, out of luck.
  if (state.wanted.stars > 0) {
    const cornered = state.cars.some((c) => c.role === 'police' && dist(c.x, c.y, p.x, p.y) < 60);
    if (cornered && speed < 46) {
      p.bustMeter += dt;
      state.prompt = 'They are on you — RUN!';
      if (p.bustMeter > 2.0) return setScreen(state, 'busted');
    } else {
      p.bustMeter = Math.max(0, p.bustMeter - dt * 1.6);
    }
  }
  if (p.hp <= 0) return setScreen(state, 'wasted');
  return null;
}

function shoot(state) {
  const p = state.player;
  p.fireT = 0.23;
  state.stats.shotsFired += 1;
  audio.shot();
  const gx = p.x + Math.cos(p.aimAngle) * 14;
  const gy = p.y + Math.sin(p.aimAngle) * 14;
  let bestD = 560;
  let hitKind = null;
  let hitObj = null;
  for (const ped of state.peds) {
    if (ped.state === 'down') continue;
    const d = dist(p.x, p.y, ped.x, ped.y);
    if (d > bestD) continue;
    const off = Math.abs(Math.sin(Math.atan2(ped.y - p.y, ped.x - p.x) - p.aimAngle)) * d;
    if (off < 13) { bestD = d; hitKind = 'ped'; hitObj = ped; }
  }
  for (const car of state.cars) {
    const d = dist(p.x, p.y, car.x, car.y);
    if (d > bestD) continue;
    const off = Math.abs(Math.sin(Math.atan2(car.y - p.y, car.x - p.x) - p.aimAngle)) * d;
    if (off < 21) { bestD = d; hitKind = 'car'; hitObj = car; }
  }
  const ex = p.x + Math.cos(p.aimAngle) * bestD;
  const ey = p.y + Math.sin(p.aimAngle) * bestD;
  state.tracers.push({ x1: gx, y1: gy, x2: ex, y2: ey, life: 0.14 });
  sparks(state, gx, gy, 2, '#ffe9a8');
  // Gunfire empties the street around it.
  for (const ped of state.peds) {
    if (dist(ped.x, ped.y, p.x, p.y) < 170 && ped.state !== 'down') {
      ped.state = 'flee';
      ped.fleeT = 3.4;
      ped.threatX = p.x;
      ped.threatY = p.y;
    }
  }
  const copNear = state.cars.some((c) => c.role === 'police' && dist(c.x, c.y, p.x, p.y) < HEAT_SIGHT + 60);
  if (hitKind === 'ped') {
    hitObj.state = 'down';
    hitObj.downT = 6;
    addHeat(state, copNear ? HEAT.downPed : 1.5);
    sparks(state, hitObj.x, hitObj.y, 5, '#e8e3d8');
  } else if (hitKind === 'car') {
    hitObj.hp -= 9;
    sparks(state, ex, ey, 6);
    if (hitObj.kind === 'police') addHeat(state, 2, 'copShot');
    else if (copNear) addHeat(state, HEAT.shootNearCop, 'shots');
  } else if (copNear) {
    addHeat(state, HEAT.shootNearCop, 'shots');
  }
}

function punch(state) {
  const p = state.player;
  p.punchT = 0.38;
  audio.punch();
  for (const ped of state.peds) {
    if (ped.state !== 'down' && dist(p.x, p.y, ped.x, ped.y) < 34) {
      ped.state = 'down';
      ped.downT = 3;
      const witnessed = state.cars.some((c) => c.role === 'police' && dist(c.x, c.y, p.x, p.y) < HEAT_SIGHT);
      addHeat(state, witnessed ? HEAT.hitPed : 0.8);
      return;
    }
  }
  for (const car of state.cars) {
    if (dist(p.x, p.y, car.x, car.y) < 40) {
      car.hp -= 3;
      sparks(state, car.x, car.y, 3);
      return;
    }
  }
}

function stepShineShop(state, dt) {
  const bay = state.city.specials.shineBay;
  const p = state.player;
  if (!bay || !p.car) { state.shineT = 0; return; }
  const inside = p.x > bay.x && p.x < bay.x + bay.w && p.y > bay.y && p.y < bay.y + bay.h;
  if (!inside || Math.abs(forwardSpeed(p.car)) > 12) {
    state.shineT = Math.min(state.shineT, 0);
    if (inside) state.prompt = 'Shine Shop — stop in the bay';
    return;
  }
  if (state.cash < 100 && (p.car.hp < 100 || state.wanted.heat > 0)) {
    state.prompt = 'Shine Shop needs $100';
    return;
  }
  if (p.car.hp >= 100 && state.wanted.heat <= 0) {
    state.prompt = 'Shine Shop — you are already shining';
    return;
  }
  state.shineT += dt;
  state.prompt = 'Shine Shop — working…';
  if (state.shineT > 2.2) {
    state.cash -= 100;
    p.car.hp = 100;
    state.wanted.heat = Math.max(0, state.wanted.heat - 3);
    state.shineT = -8;
    banner(state, 'Shine Shop', 'Good as new — and the heat is off. Mostly.', 2.6);
    audio.sting();
    saveGame(state);
  }
}

// ---------------------------------------------------------------------------
// Wanted, effects, camera: the per-frame bookkeeping.

function stepWanted(state, dt) {
  const w = state.wanted;
  const p = state.player;
  w.seen = state.cars.some((c) => c.role === 'police' && dist(c.x, c.y, p.x, p.y) < HEAT_SIGHT);
  if (!w.seen && state.time - w.lastCrimeT > 5) {
    w.heat = Math.max(0, w.heat - HEAT_DECAY * dt);
  }
  w.stars = STAR_THRESHOLDS.filter((t) => w.heat >= t).length;
  audio.siren(w.seen && w.stars > 0 && state.mode === 'play');
}

function stepEffects(state, dt) {
  for (let i = state.skids.length - 1; i >= 0; i -= 1) {
    state.skids[i].life -= dt * 0.045;
    if (state.skids[i].life <= 0) state.skids.splice(i, 1);
  }
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const pt = state.particles[i];
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.92;
    pt.vy *= 0.92;
    if (pt.life <= 0) state.particles.splice(i, 1);
  }
  for (let i = state.tracers.length - 1; i >= 0; i -= 1) {
    state.tracers[i].life -= dt * 2.4;
    if (state.tracers[i].life <= 0) state.tracers.splice(i, 1);
  }
  // Cash stashes glitter for whoever walks into them.
  const p = state.player;
  for (const stash of state.city.stashes) {
    if (!stash.taken && dist(p.x, p.y, stash.x, stash.y) < 36) {
      stash.taken = true;
      state.cash += 75;
      audio.cash();
      sparks(state, stash.x, stash.y, 10, '#3ddc97');
      banner(state, 'Stash found', '+$75 — somebody\'s rainy day, spent.', 2);
      saveGame(state);
    }
  }
}

function stepCamera(state, dt) {
  if (state.mode === 'title' || state.mode === 'help') {
    const t = state.time * 0.045;
    state.camera.x = (Math.sin(t) * 0.5 + 0.5) * (WORLD_W - VIEW_W);
    state.camera.y = (Math.cos(t * 0.8) * 0.5 + 0.5) * (CITY_H - VIEW_H);
    return;
  }
  const p = state.player;
  const look = p.car ? 0.22 : 0;
  const tx = p.x + (p.car ? p.car.vx * look : 0) - VIEW_W / 2;
  const ty = p.y + (p.car ? p.car.vy * look : 0) - VIEW_H / 2;
  const k = Math.min(1, dt * 5);
  state.camera.x += (clamp(tx, 0, WORLD_W - VIEW_W) - state.camera.x) * k;
  state.camera.y += (clamp(ty, 0, CITY_H - VIEW_H) - state.camera.y) * k;
}

// ---------------------------------------------------------------------------
// Screens and the frame loop.

function setScreen(state, screen) {
  state.mode = screen;
  state.ui.screen = screen;
  audio.siren(false);
  if (screen === 'title') refreshMenu(state);
}

function refreshMenu(state) {
  const save = loadSave();
  state.ui.menu = save && (save.missionIndex > 0 || save.done) ? ['New Game', 'Continue', 'How to Play'] : ['New Game', 'How to Play'];
  state.ui.menuIndex = 0;
}

function startRun(state, useSave) {
  const save = useSave ? loadSave() : null;
  const fresh = createGame(state.seed);
  fresh.mode = 'play';
  fresh.ui.screen = 'play';
  fresh.shotMode = state.shotMode;
  if (save) {
    fresh.cash = save.cash ?? fresh.cash;
    fresh.missions.index = save.missionIndex ?? 0;
    fresh.missions.done = !!save.done;
    for (const id of save.stashes ?? []) {
      const stash = fresh.city.stashes.find((s) => s.id === id);
      if (stash) stash.taken = true;
    }
  }
  Object.assign(state, fresh);
  state.camera.x = clamp(state.player.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  state.camera.y = clamp(state.player.y - VIEW_H / 2, 0, CITY_H - VIEW_H);
  if (!state.missions.done) applyEvents(state, beginMission(state));
  else banner(state, 'Free roam', 'Port Azura is yours. The fares never stop.', 3);
}

function respawn(state, where) {
  const p = state.player;
  if (p.car) exitCar(state);
  const spot = where === 'hospital' ? state.city.specials.hospital : state.city.specials.police;
  p.x = spot.x;
  p.y = spot.y;
  p.hp = PLAYER_HP;
  p.bustMeter = 0;
  state.wanted.heat = 0;
  state.wanted.stars = 0;
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    if (state.cars[i].role === 'police') state.cars.splice(i, 1);
  }
  setScreen(state, 'play');
}

function stepGame(state, dt) {
  state.time += dt;
  if (state.mode === 'title' || state.mode === 'help' || state.mode === 'ending') {
    applyEvents(state, stepEntities(state, dt));
    stepEffects(state, dt);
    stepCamera(state, dt);
    return;
  }
  if (state.mode !== 'play') return;
  readHands(state);
  stepPlayer(state, dt);
  if (state.mode !== 'play') return; // busted or wasted mid-frame
  applyEvents(state, stepEntities(state, dt));
  applyEvents(state, stepMissions(state, dt));
  stepWanted(state, dt);
  stepEffects(state, dt);
  stepCamera(state, dt);
  state.missionHud = missionHud(state);
  if (state.pendingEnding > 0) {
    state.pendingEnding -= dt;
    if (state.pendingEnding <= 0) setScreen(state, 'ending');
  }
}

function draw(state) {
  if (state.mode === 'title') drawTitleScreen(ctx, state);
  else if (state.mode === 'help') drawHelpScreen(ctx, state);
  else if (state.mode === 'pause') drawPauseScreen(ctx, state);
  else if (state.mode === 'busted' || state.mode === 'wasted' || state.mode === 'ending') drawEndScreen(ctx, state);
  else {
    drawWorld(ctx, state);
    drawHUD(ctx, state);
  }
}

function frame(state, dt) {
  // One-shot menu and screen keys are read here, before the world steps.
  audio.wakeOnKey = input.pressed.size > 0 || input.clicked;
  if (audio.wakeOnKey) audio.wake();
  if (input.hit('KeyM')) state.ui.muted = audio.toggleMute();

  if (state.mode === 'title') {
    if (input.hit('ArrowDown') || input.hit('KeyS')) state.ui.menuIndex = (state.ui.menuIndex + 1) % state.ui.menu.length;
    if (input.hit('ArrowUp') || input.hit('KeyW')) state.ui.menuIndex = (state.ui.menuIndex + state.ui.menu.length - 1) % state.ui.menu.length;
    if (input.hit('Enter') || input.clicked) {
      const choice = state.ui.menu[state.ui.menuIndex];
      if (choice === 'New Game') startRun(state, false);
      else if (choice === 'Continue') startRun(state, true);
      else if (choice === 'How to Play') setScreen(state, 'help');
    }
  } else if (state.mode === 'help') {
    if (input.hit('Enter') || input.hit('Escape') || input.clicked) setScreen(state, 'title');
  } else if (state.mode === 'pause') {
    if (input.hit('KeyP') || input.hit('Escape') || input.hit('Enter')) setScreen(state, 'play');
  } else if (state.mode === 'busted') {
    if (input.hit('Enter') || input.clicked) {
      state.cash = Math.max(0, state.cash - 200);
      respawn(state, 'police');
    }
  } else if (state.mode === 'wasted') {
    if (input.hit('Enter') || input.clicked) {
      state.cash = Math.floor(state.cash * 0.9);
      respawn(state, 'hospital');
    }
  } else if (state.mode === 'ending') {
    if (input.hit('Enter') || input.clicked) setScreen(state, 'play');
  } else if (state.mode === 'play') {
    if (input.hit('KeyP') || input.hit('Escape')) setScreen(state, 'pause');
  }

  stepGame(state, dt);
  draw(state);
  input.endFrame();
}

// ---------------------------------------------------------------------------
// Boot: a fixed city (seed 7) so Port Azura is the same town for everyone;
// ?shot=<scene>&seed=N stages a screenshot scene instead of the title.

const params = new URLSearchParams(window.location.search);
const seedParam = Number(params.get('seed'));
let state = createGame(Number.isFinite(seedParam) && seedParam > 0 ? seedParam : 7);
refreshMenu(state);

const shotName = params.get('shot');
if (shotName) {
  state.shotMode = true;
  setScreen(state, 'play');
  const help = {
    step: (dt) => stepGame(state, dt),
    enterCar: (car) => enterCar(state, car),
    heat: (n) => {
      state.wanted.heat = n;
      state.wanted.stars = STAR_THRESHOLDS.filter((t) => n >= t).length;
      state.wanted.lastCrimeT = state.time;
    },
    banner: (title, text, seconds) => banner(state, title, text, seconds),
    phone: (from, text) => phone(state, from, text),
    beginMissionAt: (index) => {
      state.missions.index = index;
      applyEvents(state, beginMission(state));
    },
  };
  stageShot(shotName, state, help);
  state.missionHud = missionHud(state);
  window.__shotReady = true;
}

// A handle for the scripted playtest: read the world, start a run, stage crimes.
window.VICEHEAT = {
  get state() { return state; },
  startRun: (useSave) => startRun(state, !!useSave),
  enterNearestCar: () => {
    const p = state.player;
    let best = null;
    let bd = 1e9;
    for (const car of state.cars) {
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < bd) { bd = d; best = car; }
    }
    if (best) { p.x = best.x + 20; p.y = best.y; enterCar(state, best); }
    return !!best;
  },
  crime: () => addHeat(state, 6),
  teleport: (x, y) => {
    state.player.x = x;
    state.player.y = y;
    if (state.player.car) { state.player.car.x = x; state.player.car.y = y; state.player.car.vx = 0; state.player.car.vy = 0; }
  },
};

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(state, dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
