// staging.js — the hooks the screenshot script and the scripted playtest
// drive the game through: window.ViceHeat. A human never sees this file's
// effects; it poses scenes (?shot=cover|onfoot|chase|finale) and exposes a
// small, honest control surface over the real game state.

import { COP_KIND, makeCar } from './vehicles.js';

export function installStaging(game) {
  const api = {
    game,
    ready: false,

    state() {
      return {
        screen: game.screen,
        cash: game.player.cash,
        totalEarned: game.player.totalEarned,
        hp: game.player.hp,
        stars: game.stars,
        heat: Math.round(game.heat),
        inCar: game.player.inCar,
        playerX: Math.round(game.playerX()),
        playerY: Math.round(game.playerY()),
        speed: Math.round(game.playerSpeed()),
        cops: game.cops.cars.length,
        bustMeter: Number(game.cops.bustMeter.toFixed(2)),
        phase: game.story.phase,
        missionIndex: game.story.missionIndex,
        stepIndex: game.story.stepIndex,
        storyDone: game.story.storyDone,
        traffic: game.traffic.length,
        peds: game.peds.length,
      };
    },

    start(continued = false) {
      game.startGame(continued);
    },

    warp(x, y) {
      if (game.player.inCar) {
        game.player.car.x = x;
        game.player.car.y = y;
      } else {
        game.player.x = x;
        game.player.y = y;
      }
    },

    warpNearCar() {
      let best = null;
      let bestD = Infinity;
      for (const car of game.parked) {
        const d = Math.hypot(car.x - game.player.x, car.y - game.player.y);
        if (d < bestD) { best = car; bestD = d; }
      }
      if (best) {
        game.player.x = best.x + 30;
        game.player.y = best.y + 10;
      }
      return best ? { x: best.x, y: best.y, kind: best.kind.name } : null;
    },

    toggleCar() {
      game.toggleCar();
    },

    crime(n) {
      game.addHeat(n);
    },

    setHeat(n) {
      game.setHeat(n);
    },

    beginMission() {
      game.story.beginMission();
    },

    stage(name) {
      if (name === 'cover') {
        // Title screen over the Ocean Drive promenade, bay on the right.
        game.coverLock = { x: 2750 - 640, y: 1170 - 360 };
      } else if (name === 'onfoot') {
        game.startGame(false);
        game.player.x = 2790;
        game.player.y = 1108;
        game.player.angle = -Math.PI / 2;
        game.story.beginMission();
        game.phone('Viv', 'Lola is at the marina gates, pink suitcase. Do not keep her waiting.');
      } else if (name === 'chase') {
        game.startGame(false);
        const car = game.parked.find((c) => !c.marked) ?? game.parked[0];
        car.x = 1770;
        car.y = 1560;
        car.angle = -Math.PI / 2;
        car.speed = 215;
        car.driver = 'player';
        game.player.inCar = true;
        game.player.car = car;
        game.player.x = car.x;
        game.player.y = car.y;
        game.addHeat(40); // three stars
        for (let i = 0; i < 3; i++) {
          const cop = makeCar(COP_KIND, 1770 + (i - 1) * 26, 1560 + 110 + i * 85, -Math.PI / 2, '#f4f6f8');
          cop.driver = 'cop';
          cop.speed = 205;
          game.cops.cars.push(cop);
        }
        game.cops.bustMeter = 0.3;
        game.story.beginMission();
        game.phone('Viv', 'Half the PAPD is behind you. The diner — lose them first!');
      } else if (name === 'finale') {
        game.startGame(false);
        const car = game.parked.find((c) => !c.marked) ?? game.parked[0];
        car.x = 700;
        car.y = 130;
        car.angle = 0;
        car.driver = 'player';
        game.player.inCar = true;
        game.player.car = car;
        game.player.cash = 2210;
        game.player.totalEarned = 2150;
        game.story.missionIndex = 5;
        game.story.storyDone = true;
        game.story.phase = 'fares';
        game.onStoryComplete();
        // The finale panel freezes the simulation, so pose the camera on the
        // runway by hand: the charter plane waits in the backdrop.
        game.camera.x = 60;
        game.camera.y = 0;
      }
      api.ready = true;
    },
  };

  window.ViceHeat = api;
  const shot = new URLSearchParams(location.search).get('shot');
  if (shot) {
    // Let the first frames render, then pose the scene.
    setTimeout(() => api.stage(shot), 120);
  } else {
    api.ready = true;
  }
}
