// story.js — Viv Marchetti's five jobs, and the endless cab fares that
// follow them. A mission is a list of steps (reach a place, drive a place,
// steal one particular car, shake the police); the runner walks the steps,
// talks through the phone UI, and pays out when the last step lands.

import { LANDMARKS } from './worldmap.js';
import { dist } from './seeded-random.js';

const M = LANDMARKS;

export const STORY = [
  {
    title: 'First Fare',
    pay: 150,
    intro: [
      'Viv: My cousin Lola lands at Sunset Marina in ten. Pick her up, take her to the Hotel Miramar.',
      'Viv: Drive like the bay is watching, love. It usually is.',
    ],
    steps: [
      { kind: 'passenger', x: M.marina.x, y: M.marina.y, r: 90, label: 'Pick up Lola at Sunset Marina' },
      { kind: 'drive', x: M.hotel.x, y: M.hotel.y, r: 95, label: 'Take Lola to the Hotel Miramar', time: 150 },
    ],
  },
  {
    title: 'Parcel Run',
    pay: 220,
    intro: [
      'Viv: A parcel waits at the docks, berth four. No names, no questions.',
      'Viv: Drop it at the Seabreeze Mall loading bay. Someone is always watching the docks.',
    ],
    steps: [
      { kind: 'goto', x: M.docks.x, y: M.docks.y, r: 85, label: 'Collect the parcel at the docks', heat: 14 },
      { kind: 'drive', x: 940, y: 1900, r: 95, label: 'Drop the parcel at Seabreeze Mall', time: 170 },
    ],
  },
  {
    title: 'Borrowed Wheels',
    pay: 300,
    intro: [
      'Viv: A teal Viper GT sits by the marina, keys in, owner asleep upstairs.',
      'Viv: Bring it to Azura Customs. Every dent comes out of your cut.',
    ],
    steps: [
      { kind: 'steal', label: 'Steal the teal Viper GT at the marina' },
      { kind: 'drive', x: M.chopGarage.x, y: M.chopGarage.y, r: 110, label: 'Deliver the Viper to Azura Customs', car: 'marked' },
    ],
  },
  {
    title: 'Hot Dock',
    pay: 380,
    intro: [
      'Viv: The docks again, and this time the cargo is loud. The PAPD will notice.',
      'Viv: Lose them or outrun them — just reach the Canal Street hideout.',
    ],
    steps: [
      { kind: 'goto', x: M.docks.x, y: M.docks.y, r: 85, label: 'Load the cargo at the docks', heat: 40 },
      { kind: 'escape', x: M.hideout.x, y: M.hideout.y, r: 100, label: 'Reach the Canal Street hideout' },
    ],
  },
  {
    title: 'Sunset Getaway',
    pay: 600,
    intro: [
      'Viv: Last job, love. I am done with Port Azura, and Port Azura is done with me.',
      'Viv: Pick me up at the diner. Drive me to North Point. Do not stop for anyone.',
    ],
    steps: [
      { kind: 'passenger', x: M.diner.x, y: M.diner.y, r: 85, label: 'Pick up Viv at the diner', heat: 62 },
      { kind: 'drive', x: M.airstrip.x, y: M.airstrip.y, r: 110, label: 'Get Viv to North Point Airstrip', time: 200 },
    ],
  },
];

export class StoryRunner {
  constructor(game) {
    this.game = game;
    this.missionIndex = 0; // next story mission to offer
    this.phase = 'offer'; // offer | active | fares
    this.stepIndex = 0;
    this.stepTimer = null;
    this.dwell = 0;
    this.fare = null;
    this.storyDone = false;
  }

  restore(saved) {
    if (!saved) return;
    this.missionIndex = Math.min(saved.missionIndex ?? 0, STORY.length);
    this.storyDone = !!saved.storyDone;
    if (this.storyDone || this.missionIndex >= STORY.length) {
      this.phase = 'fares';
      this.storyDone = true;
    }
  }

  saveData() {
    return { missionIndex: this.missionIndex, storyDone: this.storyDone };
  }

  currentMission() {
    return this.phase === 'active' ? STORY[this.missionIndex] : null;
  }

  currentStep() {
    const m = this.currentMission();
    return m ? m.steps[this.stepIndex] : null;
  }

  objective() {
    if (this.phase === 'offer') {
      return { x: M.diner.x, y: M.diner.y, label: `See Viv at the diner — job ${this.missionIndex + 1} of ${STORY.length}`, color: '#ffd23f' };
    }
    if (this.phase === 'active') {
      const s = this.currentStep();
      if (!s) return null;
      if (s.kind === 'steal') {
        const car = this.game.markedCar();
        return car ? { x: car.x, y: car.y, label: s.label, color: '#ffd23f' } : null;
      }
      return { x: s.x, y: s.y, label: s.label, color: '#ffd23f' };
    }
    if (this.phase === 'fares' && this.fare) {
      const t = this.fare.stage === 'pickup' ? this.fare.from : this.fare.to;
      return { x: t.x, y: t.y, label: this.fare.stage === 'pickup' ? 'Pick up the fare' : 'Drop off the fare', color: '#3fd68f' };
    }
    return null;
  }

  beginMission() {
    const m = STORY[this.missionIndex];
    this.phase = 'active';
    this.stepIndex = 0;
    this.dwell = 0;
    for (const line of m.intro) this.game.phone('Viv', line.replace(/^Viv: /, ''));
    this.game.banner(m.title, 'Job ' + (this.missionIndex + 1) + ' of ' + STORY.length);
    this.onStepStart();
  }

  onStepStart() {
    const s = this.currentStep();
    if (!s) return;
    this.stepTimer = s.time ?? null;
    this.dwell = 0;
    if (s.heat) this.game.addHeat(s.heat);
  }

  completeStep() {
    const m = this.currentMission();
    this.stepIndex++;
    this.game.sound.cash();
    if (this.stepIndex >= m.steps.length) this.completeMission();
    else this.onStepStart();
  }

  completeMission() {
    const m = this.currentMission();
    let pay = m.pay;
    if (m.title === 'Borrowed Wheels') {
      const car = this.game.markedCar();
      if (car) pay += Math.round((car.health / 100) * 150);
    }
    this.game.earn(pay, m.title);
    this.game.phone('Viv', `Done and dusted. $${pay} wired to you, love.`);
    this.missionIndex++;
    if (this.missionIndex >= STORY.length) {
      this.storyDone = true;
      this.phase = 'fares';
      this.game.onStoryComplete();
    } else {
      this.phase = 'offer';
    }
    this.game.saveGame();
  }

  newFare() {
    const g = this.game;
    const from = g.randomRoadPointNear(g.playerX(), g.playerY(), 500, 1100);
    const to = g.randomRoadPointNear(from.x, from.y, 700, 1600);
    this.fare = { from, to, stage: 'pickup', pay: Math.round(45 + dist(from.x, from.y, to.x, to.y) * 0.055) };
    g.phone('Dispatch', `Fare waiting. $${this.fare.pay} on the meter.`);
  }

  update(dt) {
    const g = this.game;
    if (g.screen !== 'playing') return;

    if (this.phase === 'offer') {
      if (dist(g.playerX(), g.playerY(), M.diner.x, M.diner.y) < 70 && !g.player.inCar) {
        this.beginMission();
      }
      return;
    }

    if (this.phase === 'fares') {
      if (!this.fare) this.newFare();
      const t = this.fare.stage === 'pickup' ? this.fare.from : this.fare.to;
      if (g.player.inCar && dist(g.playerX(), g.playerY(), t.x, t.y) < 80) {
        this.dwell += dt;
        if (this.dwell > 0.8) {
          this.dwell = 0;
          if (this.fare.stage === 'pickup') {
            this.fare.stage = 'drop';
            g.phone('Passenger', 'Hotel? No — surprise me. Just drive.');
          } else {
            g.earn(this.fare.pay, 'Cab fare');
            this.fare = null;
          }
        }
      } else this.dwell = 0;
      return;
    }

    // Active story mission.
    const s = this.currentStep();
    if (!s) return;
    if (this.stepTimer !== null) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.game.phone('Viv', 'Too slow, love. The clock restarts — keep moving.');
        this.stepTimer = s.time;
      }
    }
    const px = g.playerX();
    const py = g.playerY();
    switch (s.kind) {
      case 'goto':
        if (dist(px, py, s.x, s.y) < s.r) this.completeStep();
        break;
      case 'drive':
        if (g.player.inCar && dist(px, py, s.x, s.y) < s.r) {
          if (s.car === 'marked' && g.player.car !== g.markedCar()) break;
          this.completeStep();
        }
        break;
      case 'passenger':
        if (g.player.inCar && dist(px, py, s.x, s.y) < s.r) {
          this.dwell += dt;
          if (this.dwell > 0.8) {
            this.dwell = 0;
            this.completeStep();
          }
        } else this.dwell = 0;
        break;
      case 'steal': {
        const car = g.markedCar();
        if (car && g.player.inCar && g.player.car === car) {
          g.addHeat(16);
          g.phone('Viv', 'That is the one. Azura Customs, and mind the paint.');
          this.completeStep();
        }
        break;
      }
      case 'escape':
        if (dist(px, py, s.x, s.y) < s.r) {
          g.setHeat(0);
          this.completeStep();
        }
        break;
    }
  }
}
