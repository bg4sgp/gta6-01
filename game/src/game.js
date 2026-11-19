// game.js — Vice Heat: Port Azura. The core of the game: the player on foot
// and behind the wheel, traffic and crowds, the wanted heat that brings the
// PAPD down, Viv's jobs, gunfire and fists, the camera, the save file, and
// the render pass that draws the whole sun-soaked city every frame.

import { createRng, clamp, dist, angleTo, pushOutOfRect } from './seeded-random.js';
import {
  buildCity, WORLD_W, WORLD_H, BEACH_X, WATER_X, passable, buildingAt, LANDMARKS, nearestRoadPoint,
} from './worldmap.js';
import { seedParkedCars, spawnTrafficCar, stepTrafficCar, stepPlayerCar, drawCar } from './vehicles.js';
import { seedCrowd, stepPed, drawPed } from './people.js';
import { Police, starsForHeat } from './cops.js';
import { SoundBank } from './sound.js';
import { StoryRunner } from './story.js';
import {
  drawHud, drawTitleScreen, drawPauseScreen, drawBustedScreen, drawWastedScreen, drawFinaleScreen,
} from './hud.js';
import { installStaging } from './staging.js';

const SAVE_KEY = 'vice-heat-port-azura-save-v1';
const VIEW_W = 1280;
const VIEW_H = 720;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.city = buildCity();
    this.rng = createRng(1123);
    this.sound = new SoundBank();
    this.cops = new Police();
    this.story = new StoryRunner(this);
    this.screen = 'title';
    this.time = 0;
    this.keys = new Set();
    this.mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false };
    this.bullets = [];
    this.particles = [];
    this.traffic = [];
    this.parked = seedParkedCars(this.city, this.rng);
    this.peds = seedCrowd(this.city, this.rng);
    this.heat = 0;
    this.stars = 0;
    this.heatFresh = 0;
    this.lastShotAt = -10;
    this.lastFine = 0;
    this.phoneMsg = null;
    this.bannerMsg = null;
    this.saveClock = 0;
    this.camera = { x: 430, y: 430 };
    this.resetPlayer();
    this.bindInput();
    installStaging(this);
    this.lastTs = performance.now();
    requestAnimationFrame((ts) => this.frame(ts));
  }

  resetPlayer() {
    this.player = {
      x: 470, y: 500, angle: Math.PI / 2,
      hp: 100, cash: 60, totalEarned: 0,
      inCar: false, car: null, vx: 0, vy: 0,
    };
  }

  // ---- Accessors other modules use --------------------------------------
  playerX() { return this.player.inCar ? this.player.car.x : this.player.x; }
  playerY() { return this.player.inCar ? this.player.car.y : this.player.y; }
  playerVX() { return this.player.inCar ? Math.cos(this.player.car.angle) * this.player.car.speed : this.player.vx; }
  playerVY() { return this.player.inCar ? Math.sin(this.player.car.angle) * this.player.car.speed : this.player.vy; }
  playerSpeed() { return this.player.inCar ? Math.abs(this.player.car.speed) : Math.hypot(this.player.vx, this.player.vy); }
  markedCar() { return this.parked.find((c) => c.marked) ?? null; }

  addHeat(n) {
    this.heat = Math.min(120, this.heat + n);
    this.heatFresh = 2.5;
  }

  setHeat(n) {
    this.heat = n;
    this.heatFresh = 0;
  }

  // A crime the world may or may not see: witnesses make it count in full.
  crime(amount) {
    const px = this.playerX();
    const py = this.playerY();
    let witnessed = false;
    for (const ped of this.peds) if (dist(ped.x, ped.y, px, py) < 250) { witnessed = true; break; }
    if (!witnessed) for (const cop of this.cops.cars) if (dist(cop.x, cop.y, px, py) < 430) { witnessed = true; break; }
    this.addHeat(witnessed ? amount : amount * 0.4);
  }

  earn(n, why) {
    this.player.cash += n;
    this.player.totalEarned += n;
    this.sound.cash();
    this.banner(why, '+$' + n);
  }

  phone(from, text) {
    this.phoneMsg = { from, text, at: this.time };
    this.sound.phoneBuzz();
  }

  banner(title, sub) {
    this.bannerMsg = { title, sub, at: this.time };
  }

  hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch { return false; }
  }

  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: this.player.cash,
        totalEarned: this.player.totalEarned,
        ...this.story.saveData(),
      }));
    } catch { /* private mode: play on without a save */ }
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  onStoryComplete() {
    this.screen = 'finale';
    this.sound.jobDone();
    this.saveGame();
  }

  randomRoadPointNear(x, y, minD, maxD) {
    for (let i = 0; i < 12; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(minD, maxD);
      const p = nearestRoadPoint(x + Math.cos(a) * d, y + Math.sin(a) * d);
      if (p.x < 3000) return p;
    }
    return nearestRoadPoint(x + 400, y);
  }

  // ---- Input -------------------------------------------------------------
  bindInput() {
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.sound.ensure();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyM') this.sound.setMuted(!this.sound.muted);
      if (this.screen === 'title') {
        if (e.code === 'Enter') this.startGame(false);
        if (e.code === 'KeyC' && this.hasSave()) this.startGame(true);
      } else if (this.screen === 'busted' || this.screen === 'wasted' || this.screen === 'finale') {
        if (e.code === 'Enter') this.screen = 'playing';
      } else if (e.code === 'KeyP') {
        if (this.screen === 'playing') this.screen = 'paused';
        else if (this.screen === 'paused') this.screen = 'playing';
      }
      if (this.screen === 'playing' && e.code === 'KeyE') this.toggleCar();
      if (this.screen === 'playing' && e.code === 'KeyF') this.punch();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
      this.mouse.y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.sound.ensure();
      this.mouse.down = true;
      if (this.screen === 'playing' && !this.player.inCar && e.button === 0) this.shoot();
    });
    addEventListener('mouseup', () => { this.mouse.down = false; });
  }

  startGame(continued) {
    this.resetPlayer();
    this.cops.reset();
    this.setHeat(0);
    this.story = new StoryRunner(this);
    if (continued) {
      const saved = this.loadSave();
      if (saved) {
        this.player.cash = saved.cash ?? 60;
        this.player.totalEarned = saved.totalEarned ?? 0;
        this.story.restore(saved);
        if (this.story.phase === 'fares') this.phone('Viv', 'Back in the bay, love. The cab radio missed you.');
      }
    }
    this.screen = 'playing';
    this.sound.ensure();
  }

  toggleCar() {
    const p = this.player;
    if (p.inCar) {
      const car = p.car;
      p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 34;
      p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 34;
      if (!passable(this.city, p.x, p.y)) { p.x = car.x; p.y = car.y; }
      car.driver = null;
      car.speed = 0;
      p.inCar = false;
      p.car = null;
      return;
    }
    let best = null;
    let bestD = 58;
    for (const car of [...this.parked, ...this.traffic]) {
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < bestD) { best = car; bestD = d; }
    }
    if (!best) return;
    if (best.driver === 'traffic') {
      this.traffic = this.traffic.filter((c) => c !== best);
      this.parked.push(best);
      this.crime(6); // yanked a driver out of their seat
    } else {
      this.crime(10); // grand theft auto, Port Azura style
    }
    best.driver = 'player';
    p.inCar = true;
    p.car = best;
    this.sound.crash(0.3);
  }

  punch() {
    const p = this.player;
    this.sound.punch();
    let hit = false;
    for (const ped of this.peds) {
      if (dist(p.x, p.y, ped.x, ped.y) < 36) {
        ped.panic = 2.2;
        ped.hp = (ped.hp ?? 100) - 45;
        hit = true;
        this.burst(ped.x, ped.y, '#ef476f', 6);
      }
    }
    // Punching a car dents it and angers everyone nearby.
    for (const car of [...this.parked, ...this.traffic, ...this.cops.cars]) {
      if (dist(p.x, p.y, car.x, car.y) < 44) {
        car.health -= 4;
        hit = true;
      }
    }
    if (hit) this.crime(8);
  }

  shoot() {
    const p = this.player;
    const wx = this.camera.x + this.mouse.x;
    const wy = this.camera.y + this.mouse.y;
    const ang = angleTo(p.x, p.y, wx, wy);
    p.angle = ang;
    this.bullets.push({ x: p.x, y: p.y, vx: Math.cos(ang) * 950, vy: Math.sin(ang) * 950, life: 0.45 });
    this.lastShotAt = this.time;
    this.sound.shot();
    this.crime(7);
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(20, 120);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: this.rng.range(0.25, 0.6), color, size: this.rng.range(2, 4.5) });
    }
  }

  // ---- Simulation ----------------------------------------------------------
  frame(ts) {
    const dt = Math.min(0.033, (ts - this.lastTs) / 1000 || 0.016);
    this.lastTs = ts;
    this.time += dt;
    this.update(dt);
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    if (this.screen === 'paused') return;
    if (this.screen === 'title') {
      // The city lives behind the title: slow pan, ambient traffic and crowd.
      // A staging lock (cover screenshot) pins the camera to one scenic spot.
      if (this.coverLock) {
        this.camera.x = this.coverLock.x;
        this.camera.y = this.coverLock.y;
      } else {
        this.camera.x = clamp(1500 + Math.sin(this.time * 0.05) * 900 - VIEW_W / 2, 0, WORLD_W - VIEW_W);
        this.camera.y = clamp(1200 + Math.cos(this.time * 0.037) * 600 - VIEW_H / 2, 0, WORLD_H - VIEW_H);
      }
      this.stepAmbient(dt, this.camera.x + VIEW_W / 2, this.camera.y + VIEW_H / 2);
      return;
    }
    if (this.screen !== 'playing') return;

    const p = this.player;
    this.heatFresh = Math.max(0, this.heatFresh - dt);
    this.stars = starsForHeat(this.heat);

    if (p.inCar) this.stepDriving(dt);
    else this.stepWalking(dt);

    this.stepAmbient(dt, this.playerX(), this.playerY());
    this.stepBullets(dt);
    this.cops.update(dt, this);
    this.story.update(dt);
    this.stepSpa(dt);
    this.stepParticles(dt);

    // Heat cools while no unit has eyes on the player.
    const px = this.playerX();
    const py = this.playerY();
    const seen = this.cops.cars.some((c) => dist(c.x, c.y, px, py) < 540);
    if (!seen && this.heat > 0) this.heat = Math.max(0, this.heat - dt * 1.15);
    this.stars = starsForHeat(this.heat);

    // Sirens and engine follow the action.
    this.sound.siren(this.stars > 0 && this.cops.cars.length > 0, this.stars >= 3);
    this.sound.engine(p.inCar ? Math.abs(p.car.speed) / p.car.kind.top : null);

    if (this.cops.bustMeter >= 1) this.doBusted();
    if (p.hp <= 0) this.doWasted();

    // Camera follows, clamped to the world.
    this.camera.x = clamp(px - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    this.camera.y = clamp(py - VIEW_H / 2, 0, WORLD_H - VIEW_H);

    this.saveClock += dt;
    if (this.saveClock > 10) {
      this.saveClock = 0;
      this.saveGame();
    }
  }

  stepWalking(dt) {
    const p = this.player;
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    const len = Math.hypot(mx, my) || 1;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = sprint ? 218 : 138;
    p.vx = (mx / len) * speed * (mx || my ? 1 : 0);
    p.vy = (my / len) * speed * (mx || my ? 1 : 0);
    if (mx || my) p.angle = Math.atan2(my, mx);
    let nx = clamp(p.x + p.vx * dt, 16, WORLD_W - 16);
    let ny = clamp(p.y + p.vy * dt, 16, WORLD_H - 16);
    const b = buildingAt(this.city, nx, ny);
    if (b) [nx, ny] = pushOutOfRect(nx, ny, 10, b);
    if (nx < 3160 || !this.inWaterAt(nx, ny)) { p.x = nx; p.y = ny; }
  }

  inWaterAt(x, y) {
    return x > 3190;
  }

  stepDriving(dt) {
    const p = this.player;
    const car = p.car;
    const input = {
      throttle: 0,
      steer: 0,
      brake: false,
      handbrake: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Space'),
    };
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) input.throttle = 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.throttle = -0.7;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) input.steer = -1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) input.steer = 1;
    if (this.keys.has('Space')) input.brake = true;
    const before = Math.abs(car.speed);
    car.bumped = false;
    stepPlayerCar(car, input, dt, this.city);
    if (car.bumped && before > 90) {
      car.health -= 3.5;
      this.sound.crash(0.7);
      this.burst(car.x, car.y, '#ffd23f', 7);
    }
    // Running someone down is the loudest crime in Port Azura.
    if (Math.abs(car.speed) > 45) {
      for (const ped of this.peds) {
        if (!ped.struck && dist(car.x, car.y, ped.x, ped.y) < 26) {
          ped.struck = true;
          ped.hp = (ped.hp ?? 100) - 70;
          ped.panic = 3;
          this.burst(ped.x, ped.y, '#ef476f', 10);
          this.sound.crash(0.5);
          this.crime(17);
        }
      }
    }
    // Shunting traffic: damage both, sparks, and a little heat.
    for (const other of [...this.traffic, ...this.cops.cars]) {
      if (dist(car.x, car.y, other.x, other.y) < 40 && Math.abs(car.speed) > 60) {
        if (!car.shuntAt || this.time - car.shuntAt > 0.5) {
          car.shuntAt = this.time;
          car.health -= 2.5;
          other.health -= 5;
          this.sound.crash(0.8);
          this.burst((car.x + other.x) / 2, (car.y + other.y) / 2, '#ffd23f', 8);
          this.crime(other.driver === 'cop' ? 15 : 6);
        }
      }
    }
    if (car.health <= 0) {
      car.health = 0;
      car.speed = 0;
      this.phone('Viv', 'That car is done, love. Find another.');
      this.toggleCar();
    }
  }

  stepAmbient(dt, cx, cy) {
    // Traffic: keep a living ring of cars around the focus point.
    if (this.traffic.length < 14 && this.rng.chance(0.3)) {
      const car = spawnTrafficCar(this.rng, cx, cy);
      if (dist(car.x, car.y, cx, cy) > 420) this.traffic.push(car);
    }
    this.traffic = this.traffic.filter((car) => {
      const gone = stepTrafficCarSafe(car, dt, this.rng, this.city);
      return !gone && dist(car.x, car.y, cx, cy) < 1500;
    });
    // Crowds stroll; threats are gunfire and fast cars.
    const threats = [];
    if (this.time - this.lastShotAt < 1.4 && this.screen === 'playing') {
      threats.push({ x: this.playerX(), y: this.playerY(), radius: 300 });
    }
    if (this.screen === 'playing' && this.player.inCar && Math.abs(this.player.car.speed) > 130) {
      threats.push({ x: this.playerX(), y: this.playerY(), radius: 95 });
    }
    for (const ped of this.peds) {
      if (ped.hp !== undefined && ped.hp <= 0) {
        ped.downAt = ped.downAt ?? this.time;
        continue;
      }
      stepPed(ped, dt, this.city, this.rng, threats);
    }
    // The fallen get up after a while, somewhere else — this is a game, not a morgue.
    for (const ped of this.peds) {
      if (ped.downAt && this.time - ped.downAt > 6) {
        ped.hp = 100;
        ped.struck = false;
        ped.downAt = null;
        ped.x = cx + this.rng.range(-700, 700);
        ped.y = cy + this.rng.range(-500, 500);
        if (!passable(this.city, ped.x, ped.y)) { ped.x = 470; ped.y = 520; }
      }
    }
  }

  stepBullets(dt) {
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (buildingAt(this.city, b.x, b.y)) { b.life = 0; this.burst(b.x, b.y, '#cccccc', 3); }
      for (const ped of this.peds) {
        if (b.life > 0 && dist(b.x, b.y, ped.x, ped.y) < 12) {
          ped.hp = (ped.hp ?? 100) - 55;
          ped.panic = 3;
          b.life = 0;
          this.burst(b.x, b.y, '#ef476f', 6);
          this.crime(13);
        }
      }
      for (const car of [...this.parked, ...this.traffic, ...this.cops.cars]) {
        if (b.life > 0 && dist(b.x, b.y, car.x, car.y) < 30) {
          car.health -= 9;
          b.life = 0;
          this.burst(b.x, b.y, '#ffd23f', 4);
          this.crime(car.driver === 'cop' ? 20 : 6);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  stepParticles(dt) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
  }

  stepSpa(dt) {
    const spa = LANDMARKS.spa;
    const p = this.player;
    if (!p.inCar || this.stars === 0) return;
    const inside = p.car.x > spa.x && p.car.x < spa.x + spa.w && p.car.y > spa.y && p.car.y < spa.y + spa.h;
    if (inside && Math.abs(p.car.speed) < 12) {
      if (p.cash >= 150) {
        p.cash -= 150;
        this.setHeat(0);
        this.cops.reset();
        p.car.health = Math.min(100, p.car.health + 45);
        this.phone('Shine & Go', 'Fresh paint, clean plates. The PAPD never saw you. (-$150)');
        this.sound.jobDone();
      } else if (!this.spaWarnedAt || this.time - this.spaWarnedAt > 6) {
        this.spaWarnedAt = this.time;
        this.phone('Shine & Go', 'A respray is $150, friend. Come back richer.');
      }
    }
  }

  doBusted() {
    const fine = Math.min(this.player.cash, 100 + this.stars * 45);
    this.lastFine = fine;
    this.player.cash -= fine;
    if (this.player.inCar) this.toggleCar();
    this.player.x = LANDMARKS.station.x;
    this.player.y = LANDMARKS.station.y + 60;
    this.setHeat(0);
    this.cops.reset();
    this.screen = 'busted';
    this.sound.bustedSting();
    this.sound.siren(false, false);
    this.saveGame();
  }

  doWasted() {
    const fine = Math.min(this.player.cash, 120);
    this.lastFine = fine;
    this.player.cash -= fine;
    if (this.player.inCar) this.toggleCar();
    this.player.hp = 100;
    this.player.x = LANDMARKS.hospital.x;
    this.player.y = LANDMARKS.hospital.y + 60;
    this.setHeat(0);
    this.cops.reset();
    this.screen = 'wasted';
    this.sound.wastedSting();
    this.sound.siren(false, false);
    this.saveGame();
  }

  // ---- Rendering -----------------------------------------------------------
  render() {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.fillStyle = '#0b0e1a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    this.drawWorld(ctx, cam);
    for (const car of this.parked) if (this.inView(car.x, car.y, 120)) drawCar(ctx, car);
    for (const car of this.traffic) if (this.inView(car.x, car.y, 120)) drawCar(ctx, car);
    for (const cop of this.cops.cars) if (this.inView(cop.x, cop.y, 120)) drawCar(ctx, cop);
    for (const ped of this.peds) {
      if (!this.inView(ped.x, ped.y, 40)) continue;
      if (ped.hp !== undefined && ped.hp <= 0) this.drawDownedPed(ctx, ped);
      else drawPed(ctx, ped);
    }
    if (this.screen !== 'title') this.drawPlayer(ctx);
    this.drawObjectiveBeacon(ctx);
    for (const b of this.bullets) {
      ctx.fillStyle = '#ffe66d';
      ctx.fillRect(b.x - 3, b.y - 1.5, 6, 3);
    }
    for (const pt of this.particles) {
      ctx.globalAlpha = clamp(pt.life * 2, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (this.screen !== 'title') drawHud(ctx, this, VIEW_W, VIEW_H);
    if (this.screen === 'title') drawTitleScreen(ctx, this, VIEW_W, VIEW_H);
    else if (this.screen === 'paused') drawPauseScreen(ctx, this, VIEW_W, VIEW_H);
    else if (this.screen === 'busted') drawBustedScreen(ctx, this, VIEW_W, VIEW_H);
    else if (this.screen === 'wasted') drawWastedScreen(ctx, this, VIEW_W, VIEW_H);
    else if (this.screen === 'finale') drawFinaleScreen(ctx, this, VIEW_W, VIEW_H);
  }

  inView(x, y, pad) {
    return x > this.camera.x - pad && x < this.camera.x + VIEW_W + pad && y > this.camera.y - pad && y < this.camera.y + VIEW_H + pad;
  }

  drawPlayer(ctx) {
    const p = this.player;
    if (p.inCar) return; // the car itself is drawn in the car pass
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(20,16,40,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 5, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.angle);
    ctx.fillStyle = '#12212e';
    ctx.fillRect(-2, -8, 6, 16); // legs in stride
    ctx.fillStyle = '#ff5e8a';
    ctx.fillRect(-5, -6, 11, 12); // the famous pink jacket
    ctx.fillStyle = '#f2c09a';
    ctx.beginPath();
    ctx.arc(1, 0, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#12212e';
    ctx.fillRect(6, -2, 9, 3.4); // arm / gun line toward aim
    ctx.restore();
    // Bust ring while the meter climbs.
    if (this.cops.bustMeter > 0.02 && this.stars > 0) {
      ctx.strokeStyle = '#ef476f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, -Math.PI / 2, -Math.PI / 2 + this.cops.bustMeter * Math.PI * 2);
      ctx.stroke();
    }
  }

  drawDownedPed(ctx, ped) {
    ctx.save();
    ctx.translate(ped.x, ped.y);
    ctx.rotate(1.2);
    ctx.fillStyle = ped.shirt;
    ctx.fillRect(-8, -3, 16, 6);
    ctx.fillStyle = ped.skin;
    ctx.beginPath();
    ctx.arc(11, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawObjectiveBeacon(ctx) {
    if (this.screen !== 'playing') return;
    const obj = this.story.objective();
    if (!obj) return;
    const pulse = 0.55 + Math.sin(this.time * 4) * 0.2;
    ctx.save();
    ctx.globalAlpha = pulse * 0.35;
    ctx.fillStyle = obj.color;
    ctx.fillRect(obj.x - 16, obj.y - 320, 32, 320);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, 26 + Math.sin(this.time * 4) * 4, 0, Math.PI * 2);
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.translate(obj.x, obj.y - 52 - Math.sin(this.time * 3) * 5);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = obj.color;
    ctx.fillRect(-8, -8, 16, 16);
    ctx.restore();
  }

  drawWorld(ctx, cam) {
    // Base ground: dry city pavement.
    ctx.fillStyle = '#b9bfae';
    ctx.fillRect(cam.x - 20, cam.y - 20, VIEW_W + 40, VIEW_H + 40);
    // Beach and bay.
    ctx.fillStyle = '#ecd9a0';
    ctx.fillRect(BEACH_X, 0, WATER_X - BEACH_X, WORLD_H);
    const seaGrad = ctx.createLinearGradient(WATER_X, 0, WORLD_W, 0);
    seaGrad.addColorStop(0, '#35b6dd');
    seaGrad.addColorStop(1, '#1668a8');
    ctx.fillStyle = seaGrad;
    ctx.fillRect(WATER_X, 0, WORLD_W - WATER_X, WORLD_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let y = 60 + (Math.floor(this.time * 12) % 40); y < WORLD_H; y += 90) {
      ctx.beginPath();
      ctx.moveTo(WATER_X + 26, y);
      ctx.lineTo(WATER_X + 120, y);
      ctx.stroke();
    }
    // Roads.
    ctx.fillStyle = '#3c414b';
    for (const ax of [300, 790, 1280, 1770, 2260, 2750]) ctx.fillRect(ax - 62, 0, 124, WORLD_H);
    for (const sy of [290, 730, 1170, 1610, 2050, 2420]) ctx.fillRect(0, sy - 56, BEACH_X + 140, 112);
    // Centre dashes.
    ctx.fillStyle = '#f5d76e';
    for (const ax of [300, 790, 1280, 1770, 2260, 2750]) {
      for (let y = 12; y < WORLD_H; y += 56) ctx.fillRect(ax - 2, y, 4, 30);
    }
    for (const sy of [290, 730, 1170, 1610, 2050, 2420]) {
      for (let x = 12; x < BEACH_X + 120; x += 56) ctx.fillRect(x, sy - 2, 30, 4);
    }
    // The airstrip at North Point.
    ctx.fillStyle = '#2f333c';
    ctx.fillRect(230, 92, 660, 76);
    ctx.fillStyle = '#f2f2f2';
    for (let x = 250; x < 870; x += 60) ctx.fillRect(x, 126, 32, 6);
    ctx.fillStyle = '#d8dee9';
    ctx.beginPath(); // a little charter plane waiting at the east end
    ctx.ellipse(838, 130, 30, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(806, 108, 10, 44);
    // Marina boats bobbing in the bay.
    for (let i = 0; i < 6; i++) {
      const bx = 3260 + (i % 3) * 110;
      const by = 1020 + Math.floor(i / 3) * 190 + Math.sin(this.time + i) * 3;
      ctx.fillStyle = i % 2 ? '#f2f2f2' : '#ff8c42';
      ctx.beginPath();
      ctx.moveTo(bx - 26, by);
      ctx.lineTo(bx + 26, by);
      ctx.lineTo(bx + 16, by + 12);
      ctx.lineTo(bx - 16, by + 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(bx - 2, by - 18, 4, 18);
    }
    // Buildings with shadows, roofs and window grids.
    for (const b of this.city.buildings) {
      if (!this.inView(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
      ctx.fillStyle = 'rgba(20,16,40,0.18)';
      ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);
      ctx.fillStyle = b.fill;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
      ctx.fillStyle = 'rgba(255,244,190,0.5)';
      const cols = Math.floor(b.w / 22);
      const rows = Math.floor(b.h / 22);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          if ((i * 7 + j * 13 + b.floors) % 3 === 0) ctx.fillRect(b.x + 12 + i * 22, b.y + 12 + j * 22, 7, 7);
        }
      }
    }
    // Trees and palms.
    for (const t of this.city.trees) {
      if (!this.inView(t.x, t.y, 40)) continue;
      ctx.fillStyle = 'rgba(20,16,40,0.15)';
      ctx.beginPath();
      ctx.ellipse(t.x + 3, t.y + 4, 10 * t.s, 5 * t.s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.palm ? '#2fae5f' : '#3f9e4d';
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + t.x;
        ctx.beginPath();
        ctx.ellipse(t.x + Math.cos(a) * 7 * t.s, t.y + Math.sin(a) * 5 * t.s, 9 * t.s, 4 * t.s, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Landmarks: signs and the spa's drive-in pad.
    const spa = LANDMARKS.spa;
    ctx.fillStyle = '#274156';
    ctx.fillRect(spa.x, spa.y, spa.w, spa.h);
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SHINE & GO', spa.x + spa.w / 2, spa.y + 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('respray $150 · lose the stars', spa.x + spa.w / 2, spa.y + 56);
    this.drawSign(ctx, LANDMARKS.diner.x, LANDMARKS.diner.y, "VIV'S DINER", '#ff5e8a');
    this.drawSign(ctx, LANDMARKS.hotel.x, LANDMARKS.hotel.y, 'HOTEL MIRAMAR', '#3fa7d6');
    this.drawSign(ctx, LANDMARKS.station.x, LANDMARKS.station.y, 'PAPD', '#0a84ff');
    this.drawSign(ctx, LANDMARKS.hospital.x, LANDMARKS.hospital.y, 'HOSPITAL +', '#ef476f');
    this.drawSign(ctx, LANDMARKS.docks.x, LANDMARKS.docks.y, 'DOCKS', '#f5d76e');
    this.drawSign(ctx, LANDMARKS.chopGarage.x, LANDMARKS.chopGarage.y, 'AZURA CUSTOMS', '#9b5de5');
  }

  drawSign(ctx, x, y, text, color) {
    if (!this.inView(x, y, 200)) return;
    ctx.fillStyle = 'rgba(10,14,24,0.72)';
    const w = ctx.measureText(text).width + 22;
    ctx.font = 'bold 13px system-ui, sans-serif';
    const w2 = ctx.measureText(text).width + 22;
    ctx.fillRect(x - w2 / 2, y - 14, w2, 24);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 3);
    void w;
  }
}

// Traffic cars use the same building collision as everyone else; wrapped so
// vehicles.js stays free of the city type.
function stepTrafficCarSafe(car, dt, rng, city) {
  const beforeX = car.x;
  const beforeY = car.y;
  const gone = stepTrafficCar(car, dt, rng);
  if (buildingAt(city, car.x, car.y)) {
    car.x = beforeX;
    car.y = beforeY;
  }
  return gone;
}

// Boot: the page has exactly one canvas, #game.
const canvas = document.getElementById('game');
if (canvas) new Game(canvas);
