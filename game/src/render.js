// Everything Vice Heat draws: the sunset city from above (buildings lean their
// roofs away from the light, so the streets read with a little height), the cars
// and crowds, and the whole HUD — minimap, wanted stars, cash, mission panel,
// phone messages — plus the title, help and end screens. Pure canvas, no assets.

import { BLOCK, CITY_H, CITY_W, PALETTE, ROAD, SAND, VIEW_H, VIEW_W, WATER, WORLD_W } from './config.js';
import { blockX, blockY, hRoadY, vRoadX } from './city.js';
import { clamp, dist, makeRng } from './random.js';
import { activeCases, currentObjective } from './missions.js';

const FONT = 'system-ui, "Segoe UI", Arial, sans-serif';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function star(ctx, cx, cy, r, filled) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (filled) { ctx.fillStyle = '#ffd93d'; ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// The world

function drawGround(ctx, state) {
  const { camera, city } = state;
  const x0 = Math.max(0, camera.x);
  const y0 = Math.max(0, camera.y);
  // Sea first, over everything the camera can see.
  ctx.fillStyle = PALETTE.waterDeep;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const seaX = CITY_W + SAND - camera.x;
  if (seaX < VIEW_W) {
    const grad = ctx.createLinearGradient(seaX, 0, seaX + WATER, 0);
    grad.addColorStop(0, PALETTE.water);
    grad.addColorStop(1, PALETTE.waterDeep);
    ctx.fillStyle = grad;
    ctx.fillRect(Math.max(0, seaX), 0, VIEW_W, VIEW_H);
    // Foam along the shoreline, breathing with the time.
    ctx.strokeStyle = PALETTE.foam;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let y = -20; y < VIEW_H + 20; y += 14) {
      const wx = seaX + Math.sin(state.time * 0.9 + y * 0.05) * 7;
      if (y === -20) ctx.moveTo(wx, y); else ctx.lineTo(wx, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Sand.
  const sandX = CITY_W - camera.x;
  if (sandX + SAND > 0 && sandX < VIEW_W) {
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(sandX, -camera.y, SAND, CITY_H + camera.y + VIEW_H);
    ctx.fillStyle = PALETTE.sandWet;
    ctx.fillRect(seaX - 26, -camera.y, 26, CITY_H + camera.y + VIEW_H);
    // The boardwalk: a wooden deck along the top of the sand.
    ctx.fillStyle = '#a97c50';
    ctx.fillRect(sandX + 2, -camera.y, 40, CITY_H + camera.y + VIEW_H);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = -(camera.y % 26); y < VIEW_H; y += 26) ctx.fillRect(sandX + 2, y, 40, 2);
  }
  // City base (the blocks' sidewalk concrete), then roads over it.
  ctx.fillStyle = PALETTE.blockBase;
  ctx.fillRect(-camera.x, -camera.y, CITY_W, CITY_H);
  ctx.fillStyle = PALETTE.asphalt;
  for (let i = 0; i <= 10; i += 1) {
    const x = vRoadX(i) - camera.x;
    if (x + ROAD < 0 || x > VIEW_W) continue;
    ctx.fillRect(x, -camera.y, ROAD, CITY_H);
  }
  for (let j = 0; j <= 8; j += 1) {
    const y = hRoadY(j) - camera.y;
    if (y + ROAD < 0 || y > VIEW_H) continue;
    ctx.fillRect(-camera.x, y, CITY_W, ROAD);
  }
  // Lane dashes.
  ctx.fillStyle = PALETTE.laneMark;
  ctx.globalAlpha = 0.65;
  for (let i = 0; i <= 10; i += 1) {
    const x = vRoadX(i) + ROAD / 2 - camera.x;
    if (x < -4 || x > VIEW_W + 4) continue;
    for (let y = -(camera.y % 44); y < VIEW_H; y += 44) ctx.fillRect(x - 2, y, 4, 24);
  }
  for (let j = 0; j <= 8; j += 1) {
    const y = hRoadY(j) + ROAD / 2 - camera.y;
    if (y < -4 || y > VIEW_H + 4) continue;
    for (let x = -(camera.x % 44); x < VIEW_W; x += 44) ctx.fillRect(x, y - 2, 24, 4);
  }
  ctx.globalAlpha = 1;
  // Crosswalks on every visible intersection.
  ctx.fillStyle = 'rgba(240,240,235,0.5)';
  for (let i = 0; i <= 10; i += 1) {
    for (let j = 0; j <= 8; j += 1) {
      const ix = vRoadX(i) - camera.x;
      const iy = hRoadY(j) - camera.y;
      if (ix + ROAD < 0 || iy + ROAD < 0 || ix > VIEW_W || iy > VIEW_H) continue;
      for (let k = 0; k < 4; k += 1) {
        const off = 12 + k * 21;
        ctx.fillRect(ix + off, iy + 4, 11, 5); // north crossing
        ctx.fillRect(ix + off, iy + ROAD - 9, 11, 5); // south crossing
        ctx.fillRect(ix + 4, iy + off, 5, 11); // west crossing
        ctx.fillRect(ix + ROAD - 9, iy + off, 5, 11); // east crossing
      }
    }
  }
  // Beach umbrellas, bright dots on the sand.
  for (const prop of city.beachProps) {
    const x = prop.x - camera.x;
    const y = prop.y - camera.y;
    if (x < -20 || y < -20 || x > VIEW_W + 20 || y > VIEW_H + 20) continue;
    ctx.fillStyle = 'rgba(30,10,40,0.18)';
    ctx.beginPath(); ctx.ellipse(x + 4, y + 5, 11, 4.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = prop.color;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Parking lots.
  for (const lot of city.lots) {
    const x = lot.x - camera.x;
    const y = lot.y - camera.y;
    if (x + lot.w > 0 && y + lot.h > 0 && x < VIEW_W && y < VIEW_H) {
      ctx.fillStyle = PALETTE.asphaltDark;
      ctx.fillRect(x, y, lot.w, lot.h);
      ctx.strokeStyle = 'rgba(240,240,235,0.5)';
      ctx.lineWidth = 2;
      for (const spot of lot.spots) {
        ctx.strokeRect(spot.x - camera.x - 13, spot.y - camera.y - 20, 26, 40);
      }
    }
  }
  // The marina pier.
  const pier = city.specials.pier;
  ctx.fillStyle = '#8a6844';
  ctx.fillRect(pier.x - camera.x, pier.y - camera.y, pier.w, pier.h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = pier.x; x < pier.x + pier.w; x += 30) ctx.fillRect(x - camera.x, pier.y - camera.y, 3, pier.h);
  void x0; void y0;
}

function drawBoat(ctx, state) {
  const b = state.city.specials.boat;
  const x = b.x - state.camera.x;
  const y = b.y - state.camera.y;
  if (x < -140 || x > VIEW_W + 140 || y < -80 || y > VIEW_H + 80) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(6, 10, 74, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2f0eb';
  ctx.beginPath();
  ctx.moveTo(-78, 0); ctx.lineTo(-40, -17); ctx.lineTo(58, -15); ctx.lineTo(80, 0); ctx.lineTo(58, 15); ctx.lineTo(-40, 17);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#27b6c9';
  ctx.fillRect(-38, -11, 62, 22);
  ctx.fillStyle = '#17323e';
  ctx.fillRect(-6, -8, 30, 16);
  ctx.fillStyle = '#ffd93d';
  ctx.font = `bold 9px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('AZURA RUNNER', -8, 3.5);
  ctx.restore();
}

function drawBuildings(ctx, state) {
  const { camera, city } = state;
  for (const b of city.buildings) {
    const x = b.x - camera.x;
    const y = b.y - camera.y;
    if (x + b.w < -80 || y + b.h < -80 || x > VIEW_W + 80 || y > VIEW_H + 80) continue;
    const hgt = b.height;
    // The sunset shadow, thrown long to the south-east.
    ctx.fillStyle = 'rgba(30,10,40,0.30)';
    ctx.fillRect(x + hgt * 0.4, y + hgt * 0.55, b.w, b.h);
    // Walls (the footprint), then the roof leaning away from the light.
    ctx.fillStyle = shade(b.color, -28);
    ctx.fillRect(x, y, b.w, b.h);
    const rx = x - hgt * 0.16;
    const ry = y - hgt * 0.30;
    ctx.fillStyle = b.roof;
    ctx.fillRect(rx, ry, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, b.w, b.h);
    // Roof furniture from the building's own seed: an inset slab, plant boxes.
    const wrng = makeRng(b.seed);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.fillRect(rx + 9, ry + 9, b.w - 18, b.h - 18);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    const boxes = wrng.int(1, 3);
    for (let k = 0; k < boxes; k += 1) {
      ctx.fillRect(rx + 14 + wrng.range(0, Math.max(1, b.w - 52)), ry + 14 + wrng.range(0, Math.max(1, b.h - 52)), wrng.range(13, 24), wrng.range(11, 18));
    }
    // Windows only on the sunlit south wall: the strip the roof leaves showing.
    ctx.fillStyle = 'rgba(255,214,120,0.9)';
    const stripTop = y + b.h - hgt * 0.30 + 3;
    for (let wx = x + 9; wx < x + b.w - 10; wx += 17) {
      for (let wy = stripTop; wy < y + b.h - 7; wy += 11) {
        if (wrng.chance(0.5)) ctx.fillRect(wx, wy, 8, 5.5);
      }
    }
    if (b.sign) {
      ctx.save();
      ctx.font = `bold 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ff4fd8';
      ctx.shadowBlur = 13;
      ctx.fillStyle = '#ffe9fb';
      ctx.fillText(b.sign, rx + b.w / 2, ry + b.h / 2 + 5);
      ctx.restore();
    }
  }
  // Palms: a bent trunk and a star of fronds.
  for (const p of state.city.palms) {
    const x = p.x - camera.x;
    const y = p.y - camera.y;
    if (x < -40 || y < -40 || x > VIEW_W + 40 || y > VIEW_H + 40) continue;
    ctx.fillStyle = 'rgba(30,10,40,0.22)';
    ctx.beginPath(); ctx.ellipse(x + 7, y + 9, 15, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2e7d46';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let f = 0; f < 6; f += 1) {
      const a = (f / 6) * Math.PI * 2 + 0.5;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11 - 4, x + Math.cos(a) * 19, y + Math.sin(a) * 19 + 3);
    }
    ctx.stroke();
    ctx.fillStyle = '#8a6844';
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 0xff) + amt, 0, 255);
  const b = clamp((n & 0xff) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function drawCar(ctx, state, car) {
  const x = car.x - state.camera.x;
  const y = car.y - state.camera.y;
  if (x < -80 || y < -80 || x > VIEW_W + 80 || y > VIEW_H + 80) return;
  const len = car.kind === 'truck' ? 56 : car.kind === 'sports' ? 47 : 43;
  const wid = car.kind === 'truck' ? 24 : 21;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(20,8,30,0.35)';
  ctx.beginPath(); ctx.ellipse(5, 8, len * 0.55, wid * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(car.angle);
  // Body.
  ctx.fillStyle = car.role === 'wrecked' ? '#3a3a3e' : car.color;
  rr(ctx, -len / 2, -wid / 2, len, wid, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (car.kind === 'police') {
    ctx.fillStyle = '#17242e';
    ctx.fillRect(-6, -wid / 2, 15, wid);
    // The light bar, flashing with the chase.
    const phase = Math.floor(state.time * 5 + car.id) % 2 === 0;
    ctx.fillStyle = phase ? '#ff3b30' : '#3b82f6';
    ctx.fillRect(-3, -7, 7, 14);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = phase ? '#ff3b30' : '#3b82f6';
    ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // Glass and roof.
  ctx.fillStyle = 'rgba(16,32,44,0.9)';
  ctx.fillRect(len * 0.08, -wid / 2 + 3, len * 0.16, wid - 6); // windshield
  ctx.fillRect(-len * 0.30, -wid / 2 + 3, len * 0.13, wid - 6); // rear glass
  ctx.fillStyle = shade(car.role === 'wrecked' ? '#3a3a3e' : car.color, 18);
  ctx.fillRect(-len * 0.17, -wid / 2 + 2.5, len * 0.24, wid - 5);
  // Headlights.
  ctx.fillStyle = '#fff6c9';
  ctx.fillRect(len / 2 - 2, -wid / 2 + 2.5, 2.6, 4.5);
  ctx.fillRect(len / 2 - 2, wid / 2 - 7, 2.6, 4.5);
  ctx.fillStyle = '#ff5040';
  ctx.fillRect(-len / 2, -wid / 2 + 2.5, 2.2, 4);
  ctx.fillRect(-len / 2, wid / 2 - 6.5, 2.2, 4);
  ctx.restore();
  // Smoke from a dying engine.
  if (car.hp < 38 && car.role !== 'wrecked') {
    const t = state.time * 2 + car.id * 3;
    ctx.fillStyle = 'rgba(60,60,66,0.4)';
    for (let s = 0; s < 3; s += 1) {
      const ph = (t + s * 0.7) % 2.1;
      ctx.beginPath();
      ctx.arc(x + Math.cos(car.angle) * 18 + Math.sin(ph * 3) * 4, y + Math.sin(car.angle) * 18 - ph * 13, 4 + ph * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (car.gold) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,213,74,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(x, y, 34 + Math.sin(state.time * 3) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function drawPed(ctx, state, ped) {
  const x = ped.x - state.camera.x;
  const y = ped.y - state.camera.y;
  if (x < -30 || y < -30 || x > VIEW_W + 30 || y > VIEW_H + 30) return;
  ctx.fillStyle = 'rgba(20,8,30,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 3, y + 5, 8, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  if (ped.state === 'down') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ped.angle);
    ctx.fillStyle = ped.shirt;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath(); ctx.arc(12, 0, 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const stride = ped.speed > 4 ? Math.sin(state.time * 11 + ped.phase) * 3.4 : 0;
  ctx.strokeStyle = '#2c2c34';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x + stride, y + 8);
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x - stride, y + 8);
  ctx.stroke();
  ctx.fillStyle = ped.shirt;
  ctx.beginPath(); ctx.arc(x, y, 6.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath(); ctx.arc(x, y - 1.5, 3.9, 0, Math.PI * 2); ctx.fill();
  if (ped.state === 'wait') {
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath(); ctx.arc(x, y - 17 + Math.sin(state.time * 4) * 2, 3.2, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawWorld(ctx, state) {
  drawGround(ctx, state);
  drawBoat(ctx, state);
  // Skid marks under everything that moves.
  for (const s of state.skids) {
    const x = s.x - state.camera.x;
    const y = s.y - state.camera.y;
    if (x < -20 || y < -20 || x > VIEW_W + 20 || y > VIEW_H + 20) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(s.angle);
    ctx.fillStyle = `rgba(18,16,22,${0.34 * s.life})`;
    ctx.fillRect(-7, -2.4, 14, 4.8);
    ctx.restore();
  }
  drawBuildings(ctx, state);
  // The objective beacon: a column of light you can see across the city.
  const obj = currentObjective(state);
  if (obj && state.ui.screen === 'play') {
    const x = obj.x - state.camera.x;
    const y = obj.y - state.camera.y;
    const pulse = 0.75 + Math.sin(state.time * 4) * 0.25;
    const grad = ctx.createLinearGradient(0, y - 320, 0, y);
    grad.addColorStop(0, 'rgba(255,217,61,0)');
    grad.addColorStop(1, `rgba(255,217,61,${0.5 * pulse})`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - 13, y - 320, 26, 320);
    ctx.strokeStyle = `rgba(255,217,61,${0.9 * pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 30 + Math.sin(state.time * 4) * 5, 0, Math.PI * 2); ctx.stroke();
  }
  // Cash stashes and mission cases.
  for (const stash of state.city.stashes) {
    if (stash.taken) continue;
    drawCase(ctx, state, stash.x, stash.y, '#3ddc97');
  }
  for (const c of activeCases(state)) drawCase(ctx, state, c.x, c.y, '#ffd93d');
  for (const car of state.cars) drawCar(ctx, state, car);
  for (const ped of state.peds) drawPed(ctx, state, ped);
  drawPlayer(ctx, state);
  // Tracers and particles over the world.
  for (const t of state.tracers) {
    ctx.strokeStyle = `rgba(255,240,180,${t.life * 1.6})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(t.x1 - state.camera.x, t.y1 - state.camera.y);
    ctx.lineTo(t.x2 - state.camera.x, t.y2 - state.camera.y);
    ctx.stroke();
  }
  for (const pt of state.particles) {
    ctx.globalAlpha = clamp(pt.life, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x - state.camera.x, pt.y - state.camera.y, pt.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // The golden hour itself: warm light from the west, soft corners.
  const warm = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  warm.addColorStop(0, 'rgba(255,150,70,0.05)');
  warm.addColorStop(1, 'rgba(120,30,90,0.13)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawCase(ctx, state, wx, wy, color) {
  const x = wx - state.camera.x;
  const y = wy - state.camera.y;
  if (x < -30 || y < -30 || x > VIEW_W + 30 || y > VIEW_H + 30) return;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#20402f';
  rr(ctx, x - 10, y - 7 + Math.sin(state.time * 3 + wx) * 1.6, 20, 14, 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('$', x, y + 4 + Math.sin(state.time * 3 + wx) * 1.6);
  ctx.restore();
}

function drawPlayer(ctx, state) {
  const p = state.player;
  if (p.car) {
    // A chevron over the player's car, so it is never lost in traffic.
    const x = p.car.x - state.camera.x;
    const y = p.car.y - state.camera.y - 40 + Math.sin(state.time * 5) * 3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x - 7, y - 4);
    ctx.lineTo(x + 7, y - 4);
    ctx.closePath();
    ctx.fill();
    return;
  }
  const x = p.x - state.camera.x;
  const y = p.y - state.camera.y;
  ctx.fillStyle = 'rgba(20,8,30,0.35)';
  ctx.beginPath(); ctx.ellipse(x + 3, y + 6, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
  const stride = p.moving ? Math.sin(state.time * 12) * 3.6 : 0;
  ctx.strokeStyle = '#1d2b33';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x + stride, y + 9);
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x - stride, y + 9);
  ctx.stroke();
  ctx.fillStyle = '#12b5a5';
  ctx.beginPath(); ctx.arc(x, y, 7.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0a3d38';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = '#f2c79b';
  ctx.beginPath(); ctx.arc(x, y - 1.5, 4.3, 0, Math.PI * 2); ctx.fill();
  // The pistol, toward the aim.
  ctx.strokeStyle = '#14181d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(p.aimAngle) * 13, y + Math.sin(p.aimAngle) * 13);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// The HUD

function drawMinimap(ctx, state) {
  const W = 204;
  const H = 158;
  const X = 14;
  const Y = VIEW_H - H - 14;
  ctx.save();
  ctx.fillStyle = 'rgba(10,22,30,0.82)';
  rr(ctx, X, Y, W, H, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  rr(ctx, X, Y, W, H, 10);
  ctx.clip();
  const sx = W / WORLD_W;
  const sy = H / CITY_H;
  ctx.fillStyle = '#27505e';
  ctx.fillRect(X + CITY_W * sx, Y, (SAND + WATER) * sx, H);
  ctx.fillStyle = '#d9bd7f';
  ctx.fillRect(X + CITY_W * sx, Y, SAND * sx, H);
  ctx.fillStyle = '#4c5548';
  ctx.fillRect(X, Y, CITY_W * sx, CITY_H * sy);
  ctx.fillStyle = '#6d7a68';
  for (let i = 0; i < 10; i += 1) {
    for (let j = 0; j < 8; j += 1) ctx.fillRect(X + blockX(i) * sx + 1, Y + blockY(j) * sy + 1, BLOCK * sx - 2, BLOCK * sy - 2);
  }
  const dot = (wx, wy, color, r) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(X + wx * sx, Y + wy * sy, r, 0, Math.PI * 2); ctx.fill();
  };
  for (const c of activeCases(state)) dot(c.x, c.y, '#3ddc97', 3);
  const gold = state.cars.find((c) => c.gold);
  if (gold) dot(gold.x, gold.y, '#ffb52e', 3);
  for (const car of state.cars) {
    if (car.role === 'police') dot(car.x, car.y, Math.floor(state.time * 4) % 2 ? '#ff5040' : '#4a9eff', 2.6);
  }
  const obj = currentObjective(state);
  if (obj) {
    const pulse = 3 + Math.sin(state.time * 5) * 1.2;
    dot(obj.x, obj.y, '#ffd93d', pulse + 1.6);
  }
  // The player: a white arrow that turns with them.
  const p = state.player;
  const px = X + p.x * sx;
  const py = Y + p.y * sy;
  const ang = p.car ? p.car.angle : p.angle;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(6, 0); ctx.lineTo(-4.4, -3.8); ctx.lineTo(-4.4, 3.8);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `bold 10px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('N', X + W - 13, Y + 13);
  ctx.restore();
}

export function drawHUD(ctx, state) {
  const p = state.player;
  drawMinimap(ctx, state);
  // Wanted stars and money, top right.
  for (let i = 0; i < 5; i += 1) {
    star(ctx, VIEW_W - 168 + i * 33, 30, 14, i < state.wanted.stars);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#3ddc97';
  ctx.font = `bold 27px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText(`$${state.cash.toLocaleString('en-US')}`, VIEW_W - 18, 76);
  ctx.shadowBlur = 0;
  // Health, and the car's health while driving.
  const bar = (x, y, w, frac, color) => {
    ctx.fillStyle = 'rgba(8,12,16,0.72)';
    rr(ctx, x, y, w, 11, 5);
    ctx.fill();
    ctx.fillStyle = color;
    if (frac > 0.01) { rr(ctx, x + 1.5, y + 1.5, (w - 3) * clamp(frac, 0, 1), 8, 4); ctx.fill(); }
  };
  bar(VIEW_W - 168, 88, 150, p.hp / 100, p.hp > 30 ? '#53d769' : '#ff5040');
  if (p.car) {
    bar(VIEW_W - 168, 104, 150, p.car.hp / 100, '#7ab5d9');
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 21px ${FONT}`;
    const mph = Math.round(Math.abs(Math.hypot(p.car.vx, p.car.vy)) * 0.19);
    ctx.fillText(`${mph} MPH`, VIEW_W - 18, 140);
  }
  // The mission panel, top left.
  const obj = currentObjective(state);
  const hud = state.missionHud;
  if (hud || obj) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(8,12,20,0.66)';
    const label = obj ? obj.label : '';
    const wdt = Math.max(238, ctx.measureText(label).width + 130);
    rr(ctx, 14, 14, Math.min(wdt, 470), hud && hud.timeLeft > 0 ? 76 : 58, 9);
    ctx.fill();
    ctx.fillStyle = '#ffd93d';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText((hud ? hud.title : 'Free roam').toUpperCase(), 26, 38);
    ctx.fillStyle = '#ffffff';
    ctx.font = `15px ${FONT}`;
    if (obj) {
      const metres = Math.round(dist(p.x, p.y, obj.x, obj.y) / 9);
      ctx.fillText(`${label}  ·  ${metres} m`, 26, 60);
    }
    if (hud && hud.timeLeft > 0) {
      ctx.fillStyle = hud.timeLeft < 15 ? '#ff5040' : '#ffd93d';
      ctx.font = `bold 14px ${FONT}`;
      ctx.fillText(`${Math.ceil(hud.timeLeft)}s left`, 26, 80);
    }
  }
  // The banner: mission titles and completions, top centre.
  if (state.banner && state.time < state.banner.until) {
    const b = state.banner;
    const fade = clamp((b.until - state.time) / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.font = `bold 27px ${FONT}`;
    const wdt = Math.max(ctx.measureText(b.title).width, ctx.measureText(b.text).width) + 56;
    ctx.fillStyle = 'rgba(10,10,18,0.72)';
    rr(ctx, VIEW_W / 2 - wdt / 2, 16, wdt, 64, 12);
    ctx.fill();
    ctx.fillStyle = '#ffd93d';
    ctx.fillText(b.title, VIEW_W / 2, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = `16px ${FONT}`;
    ctx.fillText(b.text, VIEW_W / 2, 68);
    ctx.restore();
  }
  // Phone messages stacked over the minimap, newest at the bottom, each in a
  // bubble sized to its wrapped lines.
  ctx.textAlign = 'left';
  const visible = state.messages.filter((msg) => state.time <= msg.until);
  let bottomEdge = VIEW_H - 188;
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    const msg = visible[i];
    ctx.font = `13.5px ${FONT}`;
    const lines = splitLines(ctx, msg.text, 330, 2);
    const bubbleH = 30 + lines.length * 15.5;
    const top = bottomEdge - bubbleH;
    ctx.fillStyle = 'rgba(8,14,20,0.80)';
    rr(ctx, 14, top, 356, bubbleH, 9);
    ctx.fill();
    ctx.fillStyle = '#6bcbff';
    ctx.font = `bold 11.5px ${FONT}`;
    ctx.fillText(msg.from.toUpperCase(), 24, top + 16);
    ctx.fillStyle = '#f2f2f2';
    ctx.font = `13.5px ${FONT}`;
    lines.forEach((line, li) => ctx.fillText(line, 24, top + 33 + li * 15.5));
    bottomEdge = top - 7;
  }
  // The context prompt, bottom centre.
  if (state.prompt) {
    ctx.textAlign = 'center';
    ctx.font = `bold 16.5px ${FONT}`;
    const wdt = ctx.measureText(state.prompt).width + 36;
    ctx.fillStyle = 'rgba(8,12,20,0.75)';
    rr(ctx, VIEW_W / 2 - wdt / 2, VIEW_H - 52, wdt, 32, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(state.prompt, VIEW_W / 2, VIEW_H - 31);
  }
  if (state.ui.muted) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `12px ${FONT}`;
    ctx.fillText('MUTED (M)', VIEW_W - 18, VIEW_H - 16);
  }
}

/** Split text into at most maxLines lines that fit maxW, the last one ellipsised. */
function splitLines(ctx, text, maxW, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    const joined = lines.join(' ');
    if (joined.length < text.length) {
      while (ctx.measureText(`${last}…`).width > maxW && last.length) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Screens

function backdrop(ctx, state) {
  drawWorld(ctx, state);
  ctx.fillStyle = 'rgba(16,6,24,0.45)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

export function drawTitleScreen(ctx, state) {
  backdrop(ctx, state);
  ctx.textAlign = 'center';
  ctx.save();
  ctx.shadowColor = '#ff4fd8';
  ctx.shadowBlur = 34;
  ctx.fillStyle = '#ffe9fb';
  ctx.font = `900 92px ${FONT}`;
  ctx.fillText('VICE HEAT', VIEW_W / 2, 196);
  ctx.restore();
  ctx.fillStyle = '#ffd93d';
  ctx.font = `bold 25px ${FONT}`;
  ctx.fillText('P O R T   A Z U R A', VIEW_W / 2, 240);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `16.5px ${FONT}`;
  ctx.fillText('One driver. One city. Every cop in the bay. Rook is back — and Viv has work.', VIEW_W / 2, 282);
  const items = state.ui.menu;
  ctx.font = `bold 21px ${FONT}`;
  items.forEach((item, i) => {
    const y = 348 + i * 44;
    if (i === state.ui.menuIndex) {
      ctx.fillStyle = 'rgba(255,217,61,0.92)';
      rr(ctx, VIEW_W / 2 - 168, y - 27, 336, 36, 18);
      ctx.fill();
      ctx.fillStyle = '#22162a';
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillText(item, VIEW_W / 2, y);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.66)';
  ctx.font = `13.5px ${FONT}`;
  ctx.fillText('WASD drive & walk · E enter car · mouse aim, click shoot · F punch · Shift sprint · Space handbrake · P pause · M mute', VIEW_W / 2, VIEW_H - 26);
}

export function drawHelpScreen(ctx, state) {
  backdrop(ctx, state);
  ctx.fillStyle = 'rgba(10,8,18,0.88)';
  rr(ctx, VIEW_W / 2 - 330, 92, 660, 500, 16);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd93d';
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillText('HOW TO PLAY', VIEW_W / 2, 148);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f2f2f2';
  ctx.font = `16.5px ${FONT}`;
  const lines = [
    'WASD / arrows — walk and drive        Shift — sprint on foot',
    'E — get in / out of a car (any car…)   Space — handbrake',
    'Mouse — aim · Click — shoot            F — punch / shove',
    'P — pause · M — mute · Enter — confirm',
    '',
    'Follow the yellow beacon: Viv\'s jobs pay the rent. Crimes raise',
    'your stars; more stars, more police. Lose them by breaking sight,',
    'or visit the Shine Shop to cool off and repair. If they corner you',
    'on foot you are BUSTED; if your health goes, you wake up WASTED',
    'at St Azura Medical. Progress saves itself as you play.',
  ];
  lines.forEach((line, i) => ctx.fillText(line, VIEW_W / 2 - 292, 196 + i * 30));
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd93d';
  ctx.font = `bold 17px ${FONT}`;
  ctx.fillText('Press Enter or Esc to go back', VIEW_W / 2, 560);
}

export function drawPauseScreen(ctx, state) {
  backdrop(ctx, state);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 54px ${FONT}`;
  ctx.fillText('PAUSED', VIEW_W / 2, 300);
  ctx.font = `17px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('P or Esc to keep driving · progress is saved', VIEW_W / 2, 344);
}

export function drawEndScreen(ctx, state) {
  backdrop(ctx, state);
  ctx.textAlign = 'center';
  const kind = state.ui.screen;
  if (kind === 'busted') {
    ctx.fillStyle = '#4a9eff';
    ctx.font = `900 84px ${FONT}`;
    ctx.fillText('BUSTED', VIEW_W / 2, 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = `18px ${FONT}`;
    ctx.fillText('Azura PD takes its cut. You walk out of the station lighter — press Enter.', VIEW_W / 2, 350);
  } else if (kind === 'wasted') {
    ctx.fillStyle = '#ff5040';
    ctx.font = `900 84px ${FONT}`;
    ctx.fillText('WASTED', VIEW_W / 2, 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = `18px ${FONT}`;
    ctx.fillText('You wake up at St Azura Medical with a bill and a headache — press Enter.', VIEW_W / 2, 350);
  } else {
    ctx.save();
    ctx.shadowColor = '#ffd93d';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#fff3c4';
    ctx.font = `900 62px ${FONT}`;
    ctx.fillText('PORT AZURA IS YOURS', VIEW_W / 2, 268);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = `18.5px ${FONT}`;
    ctx.fillText('Every job done, every debt paid. The city is yours now, Rook — keep roaming,', VIEW_W / 2, 322);
    ctx.fillText('the fares never stop. Press Enter to stay in the city.', VIEW_W / 2, 348);
    ctx.fillStyle = '#3ddc97';
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText(`Final take: $${state.cash.toLocaleString('en-US')}`, VIEW_W / 2, 396);
  }
}

export { FONT };
