// The story of Vice Heat, told as missions from the fixer Vivian "Viv" Cross to
// the driver Rook, plus the endless taxi fares of the free roam that follows.
// A mission is a list of steps (go somewhere, pick someone up, steal one marked
// car, collect the cases); this module runs the steps against the world and
// reports events — phone calls, cash, police attention — for the game to apply.

import { blockX, blockY } from './city.js';
import { createCar, createPed } from './entities.js';
import { dist } from './random.js';

function buildDefs(city) {
  const s = city.specials;
  return [
    {
      id: 'homecoming', title: 'Homecoming', reward: 150,
      intro: [
        ['Viv', 'Rook. You made it back to Port Azura. Your car is by the boardwalk — teal hatch, you can\'t miss it.'],
        ['Viv', 'Drive to your garage across town. Then we talk business.'],
      ],
      steps: [
        { kind: 'goto', x: s.garage.x, y: s.garage.y, label: 'Get to Rook\'s Garage', radius: 95 },
      ],
      outro: 'The garage smells of salt and gasoline. Home.',
    },
    {
      id: 'fare-play', title: 'Fare Play', reward: 300,
      intro: [
        ['Viv', 'Marisol needs a ride from the boardwalk to Hotel Lumina. She is late for her own art show.'],
        ['Viv', 'Pick her up, keep the paint on, and the tip is yours.'],
      ],
      steps: [
        { kind: 'pickupPerson', x: s.boardwalk.x + 30, y: s.boardwalk.y + 90, label: 'Pick up Marisol at the boardwalk', who: 'Marisol' },
        { kind: 'deliverPerson', x: s.hotel.x, y: s.hotel.y, label: 'Take Marisol to Hotel Lumina', radius: 95, timer: 105 },
      ],
      outro: 'Marisol: "Five stars, handsome. Tell Viv I owe her."',
    },
    {
      id: 'warm-package', title: 'Warm Package', reward: 500,
      intro: [
        ['Viv', 'Pick up a package at Marlowe\'s Diner and take it to Port Freight.'],
        ['Viv', 'And Rook — do not look inside.'],
      ],
      steps: [
        { kind: 'pickupItem', x: s.diner.x, y: s.diner.y, label: 'Pick up the package at Marlowe\'s Diner', radius: 80, alarm: 2 },
        { kind: 'goto', x: s.warehouse.x, y: s.warehouse.y, label: 'Deliver to Port Freight', radius: 100, timer: 135 },
      ],
      outro: 'The warehouseman signs without looking up. Clean.',
    },
    {
      id: 'repo-star', title: 'Repo Star', reward: 800,
      intro: [
        ['Viv', 'Azura Motors is showing a gold Aurelia GT that is mine on paper.'],
        ['Viv', 'Bring it home to your garage. Mind the alarm — and everything it brings.'],
      ],
      steps: [
        { kind: 'stealCar', label: 'Steal the gold Aurelia GT from Azura Motors', alarm: 3 },
        { kind: 'deliverCar', x: s.garage.x, y: s.garage.y, label: 'Deliver the Aurelia GT to Rook\'s Garage', radius: 100 },
      ],
      outro: 'Viv, in person: "She\'s beautiful. So is the money."',
    },
    {
      id: 'last-boat', title: 'Last Boat Out', reward: 1500,
      intro: [
        ['Viv', 'Last job, then you are made. Two cases: Club Solstice, and Port Freight.'],
        ['Viv', 'Then the Azura Runner at the marina pier. Do not stop for anyone.'],
      ],
      steps: [
        {
          kind: 'collect', label: 'Collect the two cases', alarmOnLast: 4,
          points: [
            { x: s.beachClub.x, y: s.beachClub.y + 40 },
            { x: s.warehouse.x, y: s.warehouse.y - 30 },
          ],
        },
        { kind: 'goto', x: s.boat.x, y: s.boat.y, label: 'Reach the Azura Runner at the pier', radius: 60, needFoot: true },
      ],
      outro: 'The Runner\'s engine turns over. The bay is yours.',
    },
  ];
}

export function createMissions(city) {
  return {
    defs: buildDefs(city),
    index: 0, // next story mission to run
    active: null, // the running mission's working state
    done: false, // story finished: free roam
    fare: null,
    fareCooldown: 14,
    restartT: 0,
  };
}

function phoneAll(events, lines) {
  for (const [from, text] of lines) events.push({ type: 'phone', from, text });
}

/** Start the current story mission (or restart it after a failure). */
export function beginMission(state) {
  const m = state.missions;
  const events = [];
  if (m.done) return events;
  const def = m.defs[m.index];
  m.active = { def, step: 0, timeLeft: 0, passenger: null, goldCar: null, collect: null, failed: false };
  phoneAll(events, def.intro);
  events.push({ type: 'banner', title: def.title, text: def.steps[0].label });
  setupStep(state, events);
  return events;
}

function setupStep(state, events) {
  const m = state.missions;
  const a = m.active;
  if (!a) return;
  const step = a.def.steps[a.step];
  if (!step) return;
  a.timeLeft = step.timer ?? 0;
  if (step.kind === 'pickupPerson') {
    const ped = createPed(step.x, step.y, state.rng, null);
    ped.role = 'passenger';
    ped.state = 'wait';
    ped.shirt = '#ffd93d';
    state.peds.push(ped);
    a.passenger = ped;
  }
  if (step.kind === 'stealCar') {
    // The gold Aurelia GT, on the dealer's front row, unless it already exists.
    let gold = state.cars.find((c) => c.gold);
    if (!gold || gold.role === 'wrecked') {
      if (gold) state.cars.splice(state.cars.indexOf(gold), 1);
      gold = createCar(blockX(8) + 120, blockY(2) + 204, 0, 'sports', 'parked', state.rng);
      gold.color = '#ffb52e';
      gold.gold = true;
      gold.missionCar = true;
      gold.driver = false;
      state.cars.push(gold);
    }
    a.goldCar = gold;
  }
  if (step.kind === 'collect') {
    a.collect = step.points.map((pt) => ({ x: pt.x, y: pt.y, taken: false }));
  }
  // A step's alarm is not sounded here: it fires when the step is done (the
  // package grabbed, the car started), in stepMissions.
}

/** The point the HUD marker and minimap blip point at, or null between jobs. */
export function currentObjective(state) {
  const m = state.missions;
  if (m.fare && !m.fare.pickedUp) return { x: m.fare.x, y: m.fare.y, label: 'Fare pickup' };
  if (m.fare) return { x: m.fare.dx, y: m.fare.dy, label: 'Fare drop-off' };
  const a = m.active;
  if (!a) return null;
  const step = a.def.steps[a.step];
  if (!step) return null;
  if (step.kind === 'stealCar') {
    return a.goldCar ? { x: a.goldCar.x, y: a.goldCar.y, label: step.label } : null;
  }
  if (step.kind === 'collect') {
    const left = a.collect.filter((c) => !c.taken);
    if (!left.length) return null;
    const p = state.player;
    left.sort((c1, c2) => dist(p.x, p.y, c1.x, c1.y) - dist(p.x, p.y, c2.x, c2.y));
    return { x: left[0].x, y: left[0].y, label: `${step.label} (${a.collect.length - left.length}/${a.collect.length})` };
  }
  return { x: step.x, y: step.y, label: step.label };
}

function completeMission(state, events) {
  const m = state.missions;
  const def = m.active.def;
  events.push({ type: 'cash', amount: def.reward });
  events.push({ type: 'banner', title: `${def.title} — complete`, text: `+$${def.reward}` });
  events.push({ type: 'phone', from: 'Viv', text: def.outro });
  events.push({ type: 'sting' });
  m.index += 1;
  m.active = null;
  if (m.index >= m.defs.length) {
    m.done = true;
    events.push({ type: 'storyComplete' });
  } else {
    m.restartT = 5; // a breath, then the phone rings again
  }
}

function failMission(state, events, why) {
  const m = state.missions;
  events.push({ type: 'banner', title: `${m.active.def.title} — failed`, text: why });
  events.push({ type: 'phone', from: 'Viv', text: 'We lost them. Shake it off — we go again.' });
  events.push({ type: 'fail' });
  // Clean up the step's actors; the mission restarts shortly.
  if (m.active.passenger) {
    const i = state.peds.indexOf(m.active.passenger);
    if (i >= 0) state.peds.splice(i, 1);
  }
  m.active = null;
  m.restartT = 4;
}

/** Advance the story and the fares by one frame; returns events for the game. */
export function stepMissions(state, dt) {
  const events = [];
  const m = state.missions;
  const p = state.player;

  if (!m.active && !m.done) {
    m.restartT -= dt;
    if (m.restartT <= 0) events.push(...beginMission(state));
  }

  const a = m.active;
  if (a) {
    const step = a.def.steps[a.step];
    if (!step) {
      completeMission(state, events);
    } else {
      if (step.timer) {
        a.timeLeft -= dt;
        if (a.timeLeft <= 0) failMission(state, events, 'Out of time.');
      }
      if (m.active === a) { // not failed by the timer this frame
        let advance = false;
        if (step.kind === 'goto') {
          if (dist(p.x, p.y, step.x, step.y) < (step.radius ?? 90) && (!step.needFoot || !p.car)) advance = true;
        } else if (step.kind === 'pickupItem') {
          if (dist(p.x, p.y, step.x, step.y) < step.radius) {
            advance = true;
            if (step.alarm) events.push({ type: 'setStars', n: step.alarm });
            events.push({ type: 'phone', from: 'Viv', text: 'You have it. The drop was watched — MOVE.' });
          }
        } else if (step.kind === 'pickupPerson') {
          const ped = a.passenger;
          if (ped && p.car && (ped.state === 'wait' || ped.state === 'toCar') && dist(p.x, p.y, ped.x, ped.y) < 130) {
            ped.state = 'toCar';
            const d = dist(ped.x, ped.y, p.car.x, p.car.y);
            if (d > 26) {
              ped.x += ((p.car.x - ped.x) / d) * 150 * dt;
              ped.y += ((p.car.y - ped.y) / d) * 150 * dt;
              ped.angle = Math.atan2(p.car.y - ped.y, p.car.x - ped.x);
            } else {
              const i = state.peds.indexOf(ped);
              if (i >= 0) state.peds.splice(i, 1);
              a.passenger = null;
              advance = true;
              events.push({ type: 'phone', from: step.who, text: 'Thanks for stopping! Hotel Lumina, and step on it.' });
            }
          }
        } else if (step.kind === 'deliverPerson') {
          if (p.car && dist(p.x, p.y, step.x, step.y) < step.radius) advance = true;
        } else if (step.kind === 'stealCar') {
          if (a.goldCar && p.car === a.goldCar) {
            advance = true;
            if (step.alarm) events.push({ type: 'setStars', n: step.alarm });
          }
        } else if (step.kind === 'deliverCar') {
          if (p.car === a.goldCar && dist(p.x, p.y, step.x, step.y) < step.radius) advance = true;
        } else if (step.kind === 'collect') {
          for (const c of a.collect) {
            if (!c.taken && dist(p.x, p.y, c.x, c.y) < 55) {
              c.taken = true;
              events.push({ type: 'pickup' });
              const left = a.collect.filter((k) => !k.taken).length;
              if (left === 0 && step.alarmOnLast) events.push({ type: 'setStars', n: step.alarmOnLast });
              else if (left > 0) events.push({ type: 'phone', from: 'Viv', text: `One case down. ${left} to go.` });
            }
          }
          if (a.collect.every((c) => c.taken)) advance = true;
        }
        if (advance && m.active === a) {
          a.step += 1;
          if (a.step >= a.def.steps.length) completeMission(state, events);
          else {
            events.push({ type: 'banner', title: a.def.title, text: a.def.steps[a.step].label });
            setupStep(state, events);
          }
        }
      }
    }
  }

  // Free-roam fares, once the story is done: Port Azura always needs a driver.
  if (m.done) {
    if (!m.fare) {
      m.fareCooldown -= dt;
      if (m.fareCooldown <= 0) {
        const spots = [state.city.specials.hotel, state.city.specials.diner, state.city.specials.beachClub, state.city.specials.boardwalk, state.city.specials.warehouse];
        const from = state.rng.pick(spots);
        let to = state.rng.pick(spots);
        if (to === from) to = spots[(spots.indexOf(from) + 2) % spots.length];
        m.fare = { x: from.x, y: from.y, dx: to.x, dy: to.y, pickedUp: false, pay: Math.round(70 + dist(from.x, from.y, to.x, to.y) * 0.09) };
        const ped = createPed(from.x, from.y, state.rng, null);
        ped.role = 'passenger';
        ped.state = 'wait';
        ped.shirt = '#6bcbff';
        state.peds.push(ped);
        m.fare.ped = ped;
        events.push({ type: 'phone', from: 'Dispatch', text: `Fare waiting at ${from.sign}. $${m.fare.pay} to ${to.sign}.` });
      }
    } else {
      const f = m.fare;
      if (!f.pickedUp && f.ped && p.car && (f.ped.state === 'wait' || f.ped.state === 'toCar') && dist(p.x, p.y, f.ped.x, f.ped.y) < 130) {
        f.ped.state = 'toCar';
        const d = dist(f.ped.x, f.ped.y, p.car.x, p.car.y);
        if (d > 26) {
          f.ped.x += ((p.car.x - f.ped.x) / d) * 150 * dt;
          f.ped.y += ((p.car.y - f.ped.y) / d) * 150 * dt;
        } else {
          const i = state.peds.indexOf(f.ped);
          if (i >= 0) state.peds.splice(i, 1);
          f.pickedUp = true;
          events.push({ type: 'phone', from: 'Passenger', text: 'Thanks! Address is on your map.' });
        }
      } else if (f.pickedUp && p.car && dist(p.x, p.y, f.dx, f.dy) < 95) {
        events.push({ type: 'cash', amount: f.pay });
        events.push({ type: 'banner', title: 'Fare complete', text: `+$${f.pay}` });
        events.push({ type: 'pickup' });
        m.fare = null;
        m.fareCooldown = state.rng.range(18, 34);
      }
    }
  }

  return events;
}

/** A short line for the HUD: the running mission and its clock, if any. */
export function missionHud(state) {
  const m = state.missions;
  if (m.fare) return { title: 'Taxi fare', timeLeft: 0 };
  if (!m.active) return null;
  return { title: m.active.def.title, timeLeft: m.active.timeLeft };
}

/** Where the story's briefcases lie right now (for the renderer). */
export function activeCases(state) {
  const a = state.missions.active;
  if (!a || !a.collect) return [];
  return a.collect.filter((c) => !c.taken);
}
