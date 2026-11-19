// hud.js — everything drawn over the world: the cash and health readouts,
// the wanted stars, the live minimap, the objective banner, Viv's phone
// messages, and the full-screen title / pause / busted / wasted / finale
// panels.

import { WORLD_W, WORLD_H, WATER_X, LANDMARKS } from './worldmap.js';
import { clamp } from './seeded-random.js';

export function drawHud(ctx, g, W, H) {
  const p = g.player;
  // Cash and health, top-left.
  ctx.fillStyle = 'rgba(10,14,24,0.55)';
  ctx.fillRect(14, 14, 218, 64);
  ctx.fillStyle = '#3fd68f';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('$' + p.cash.toLocaleString('en-US'), 26, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('PORT AZURA', 27, 68);
  // Health bar.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(140, 56, 82, 9);
  ctx.fillStyle = p.hp > 30 ? '#3fd68f' : '#ef476f';
  ctx.fillRect(140, 56, 82 * clamp(p.hp / 100, 0, 1), 9);
  if (p.inCar) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(140, 38, 82, 7);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(140, 38, 82 * clamp(p.car.health / 100, 0, 1), 7);
  }

  // Wanted stars, top-right. They flash while the heat is fresh.
  const flash = g.heatFresh > 0 && Math.floor(g.time * 6) % 2 === 0;
  ctx.font = '30px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i < 5; i++) {
    const on = i < g.stars;
    ctx.fillStyle = on ? (flash ? '#ffffff' : '#ffd23f') : 'rgba(255,255,255,0.22)';
    ctx.fillText('★', W - 24 - (4 - i) * 34, 48);
  }
  if (g.cops.bustMeter > 0.02 && g.stars > 0) {
    ctx.fillStyle = 'rgba(10,14,24,0.55)';
    ctx.fillRect(W - 196, 60, 172, 12);
    ctx.fillStyle = '#ef476f';
    ctx.fillRect(W - 194, 62, 168 * g.cops.bustMeter, 8);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('BUSTED?', W - 24, 58);
  }

  drawMinimap(ctx, g, W, H);
  drawObjective(ctx, g, W);
  drawPhone(ctx, g, H);
  drawBanner(ctx, g, W, H);

  if (p.inCar) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(Math.abs(p.car.speed) * 0.36) + ' km/h', W - 24, H - 178);
  }
}

function drawMinimap(ctx, g, W, H) {
  const mw = 196;
  const mh = 142;
  const mx = W - mw - 16;
  const my = H - mh - 16;
  const sx = mw / WORLD_W;
  const sy = mh / WORLD_H;
  ctx.save();
  ctx.fillStyle = '#274156';
  ctx.fillRect(mx, my, mw, mh);
  ctx.fillStyle = '#2ec4e6';
  ctx.fillRect(mx + WATER_X * sx, my, mw - WATER_X * sx, mh);
  ctx.fillStyle = '#e8d8a8';
  ctx.fillRect(mx + 3050 * sx, my, (WATER_X - 3050) * sx, mh);
  ctx.fillStyle = 'rgba(240,240,230,0.5)';
  for (const b of g.city.buildings) ctx.fillRect(mx + b.x * sx, my + b.y * sy, Math.max(1.6, b.w * sx), Math.max(1.6, b.h * sy));
  // Landmark dots worth knowing.
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(mx + LANDMARKS.spa.x * sx - 2, my + LANDMARKS.spa.y * sy - 2, 4, 4);
  // Police blips.
  for (const cop of g.cops.cars) {
    ctx.fillStyle = Math.floor(g.time * 3) % 2 ? '#ff3b30' : '#0a84ff';
    ctx.fillRect(mx + cop.x * sx - 2, my + cop.y * sy - 2, 4, 4);
  }
  // Objective blip.
  const obj = g.story.objective();
  if (obj) {
    ctx.fillStyle = obj.color;
    const r = 3.4 + Math.sin(g.time * 5) * 1.1;
    ctx.beginPath();
    ctx.arc(mx + obj.x * sx, my + obj.y * sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  const px = mx + g.playerX() * sx;
  const py = my + g.playerY() * sy;
  const ang = g.player.inCar ? g.player.car.angle : g.player.angle;
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -4);
  ctx.lineTo(-4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(mx, my, mw, mh);
}

function drawObjective(ctx, g, W) {
  const obj = g.story.objective();
  if (!obj || g.screen !== 'playing') return;
  const m = g.story.currentMission();
  const d = Math.round(Math.hypot(g.playerX() - obj.x, g.playerY() - obj.y) / 10);
  ctx.fillStyle = 'rgba(10,14,24,0.55)';
  const title = m ? m.title : g.story.phase === 'fares' ? 'Cab work' : 'Free roam';
  const text = obj.label + '  ·  ' + d + 'm';
  ctx.font = 'bold 15px system-ui, sans-serif';
  const w = Math.max(ctx.measureText(text).width, ctx.measureText(title).width) + 36;
  ctx.fillRect(W / 2 - w / 2, 14, w, 52);
  ctx.fillStyle = '#ffd23f';
  ctx.textAlign = 'center';
  ctx.fillText(title, W / 2, 36);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(text, W / 2, 57);
  const step = g.story.currentStep();
  if (step && step.time && g.story.stepTimer !== null) {
    ctx.fillStyle = g.story.stepTimer < 20 ? '#ef476f' : '#3fd68f';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(Math.ceil(g.story.stepTimer) + 's', W / 2, 84);
  }
}

function drawPhone(ctx, g, H) {
  if (!g.phoneMsg || g.time - g.phoneMsg.at > 6) return;
  const { from, text } = g.phoneMsg;
  ctx.save();
  ctx.globalAlpha = clamp(6 - (g.time - g.phoneMsg.at), 0, 1);
  ctx.fillStyle = 'rgba(12,16,26,0.88)';
  const lines = wrapText(ctx, text, 250);
  const h = 44 + lines.length * 17;
  roundRectPath(ctx, 16, H - h - 16, 282, h, 12);
  ctx.fill();
  ctx.fillStyle = '#3fd68f';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('📱 ' + from.toUpperCase(), 30, H - h + 8);
  ctx.fillStyle = '#f2f2f2';
  ctx.font = '13px system-ui, sans-serif';
  lines.forEach((line, i) => ctx.fillText(line, 30, H - h + 28 + i * 17));
  ctx.restore();
}

function drawBanner(ctx, g, W, H) {
  if (!g.bannerMsg || g.time - g.bannerMsg.at > 3.2) return;
  const a = clamp(3.2 - (g.time - g.bannerMsg.at), 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(g.bannerMsg.title, W / 2, H * 0.3);
  ctx.fillStyle = '#ffffff';
  ctx.font = '17px system-ui, sans-serif';
  ctx.fillText(g.bannerMsg.sub, W / 2, H * 0.3 + 30);
  ctx.restore();
}

export function wrapText(ctx, text, maxWidth) {
  ctx.font = '13px system-ui, sans-serif';
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- Full-screen panels -------------------------------------------------

function panel(ctx, W, H, alpha = 0.45) {
  ctx.fillStyle = `rgba(8,10,20,${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

export function drawTitleScreen(ctx, g, W, H) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(20,8,40,0.25)');
  grad.addColorStop(1, 'rgba(20,8,40,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText('V I C E   H E A T', W / 2, H * 0.3);
  ctx.fillStyle = '#ff5e8a';
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.fillText('PORT AZURA', W / 2, H * 0.3 + 82);
  ctx.fillStyle = '#ffffff';
  ctx.font = '17px system-ui, sans-serif';
  ctx.fillText('An open-world crime story in a city that never cools down.', W / 2, H * 0.3 + 122);
  ctx.font = 'bold 19px system-ui, sans-serif';
  ctx.fillStyle = '#3fd68f';
  ctx.fillText(g.hasSave() ? 'Press ENTER for a new game · C to continue' : 'Press ENTER to start', W / 2, H * 0.62);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('WASD drive & walk · E enter car · F punch · mouse aim, click to shoot · Shift sprint / handbrake · P pause · M mute', W / 2, H * 0.62 + 34);
  ctx.fillText('Steal cars. Run jobs for Viv. Mind the stars.', W / 2, H * 0.62 + 58);
}

export function drawPauseScreen(ctx, g, W, H) {
  panel(ctx, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText('PAUSED', W / 2, H * 0.42);
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText('P to resume · your progress saves itself as you play', W / 2, H * 0.42 + 36);
}

export function drawBustedScreen(ctx, g, W, H) {
  panel(ctx, W, H, 0.55);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0a84ff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText('BUSTED', W / 2, H * 0.42);
  ctx.fillStyle = '#ffffff';
  ctx.font = '17px system-ui, sans-serif';
  ctx.fillText('The PAPD impounds your ride and fines you $' + g.lastFine + '.', W / 2, H * 0.42 + 40);
  ctx.fillText('Press ENTER to walk out of the station', W / 2, H * 0.42 + 68);
}

export function drawWastedScreen(ctx, g, W, H) {
  panel(ctx, W, H, 0.55);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ef476f';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText('WASTED', W / 2, H * 0.42);
  ctx.fillStyle = '#ffffff';
  ctx.font = '17px system-ui, sans-serif';
  ctx.fillText('Azura General patches you up for $' + g.lastFine + '.', W / 2, H * 0.42 + 40);
  ctx.fillText('Press ENTER to leave the hospital', W / 2, H * 0.42 + 68);
}

export function drawFinaleScreen(ctx, g, W, H) {
  panel(ctx, W, H, 0.5);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.fillText('SUNSET GETAWAY', W / 2, H * 0.34);
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText('Viv is wheels-up over the bay. Port Azura is yours now.', W / 2, H * 0.34 + 44);
  ctx.fillText('Total earned: $' + g.player.totalEarned.toLocaleString('en-US') + ' · Jobs done: 5 of 5', W / 2, H * 0.34 + 76);
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillStyle = '#3fd68f';
  ctx.fillText('Press ENTER to keep roaming — the cab radio never sleeps', W / 2, H * 0.34 + 116);
}
