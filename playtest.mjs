// playtest.mjs — a scripted drive through Vice Heat in headless Chrome:
// title → start → walk → steal a car → drive → Viv's first job end to end →
// wanted stars and a police response. Also proves the game makes zero
// network requests and throws zero page errors. Exits non-zero on failure.
//
//   CHROME_BIN=<chrome-headless-shell> node playtest.mjs

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/makefun/shot-tools/package.json');
const puppeteer = require('puppeteer-core');

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const gameDir = join(repoDir, 'game');
const CHROME = process.env.CHROME_BIN
  ?? '/home/hatch/.cache/puppeteer/chrome-headless-shell/linux-157.0.8103.78/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 8138;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  try {
    const body = readFileSync(join(gameDir, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const pageErrors = [];
  const externalRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('request', (req) => {
    if (!req.url().startsWith(`http://127.0.0.1:${PORT}`) && !req.url().startsWith('data:')) {
      externalRequests.push(req.url());
    }
  });
  const state = () => page.evaluate(() => window.ViceHeat.state());
  const call = (fn, ...args) => page.evaluate(fn, ...args);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ViceHeat && window.ViceHeat.ready, { timeout: 15000 });

  let s = await state();
  check('title screen shows', s.screen === 'title', `screen=${s.screen}`);

  await page.keyboard.press('Enter');
  await sleep(300);
  s = await state();
  check('Enter starts the game', s.screen === 'playing', `screen=${s.screen}`);

  const startPos = { x: s.playerX, y: s.playerY };
  await page.keyboard.down('KeyW');
  await sleep(650);
  await page.keyboard.up('KeyW');
  s = await state();
  check('walking moves the player', Math.hypot(s.playerX - startPos.x, s.playerY - startPos.y) > 25,
    `moved to ${s.playerX},${s.playerY}`);

  // Walk up to Viv's diner: job 1 should offer itself and start.
  await call(() => window.ViceHeat.warp(430, 482));
  await sleep(400);
  s = await state();
  check('first job starts at the diner', s.phase === 'active' && s.missionIndex === 0, `phase=${s.phase}`);

  // Steal the nearest parked car.
  const carInfo = await call(() => window.ViceHeat.warpNearCar());
  check('a parked car is in reach', !!carInfo, carInfo ? carInfo.kind : 'none');
  await page.keyboard.press('KeyE');
  await sleep(250);
  s = await state();
  check('E gets into the car', s.inCar === true);

  const carPos = { x: s.playerX, y: s.playerY };
  await page.keyboard.down('KeyW');
  await sleep(900);
  await page.keyboard.up('KeyW');
  s = await state();
  check('the car drives', Math.hypot(s.playerX - carPos.x, s.playerY - carPos.y) > 50,
    `drove to ${s.playerX},${s.playerY}`);

  // Job 1: collect Lola at the marina, deliver her to the Hotel Miramar.
  await call(() => window.ViceHeat.warp(2980, 1180));
  await sleep(1300);
  s = await state();
  check('pickup step completes', s.stepIndex === 1, `step=${s.stepIndex}`);
  await call(() => window.ViceHeat.warp(2560, 620));
  await sleep(500);
  s = await state();
  check('first job pays out', s.cash >= 210 && s.missionIndex === 1, `cash=$${s.cash}`);

  // Cause a scene, then keep driving: heat past the second threshold must
  // raise stars and bring the PAPD out. (Sit still and they would simply
  // bust us — the meter needs a moving target for a fair check.)
  await call(() => window.ViceHeat.crime(40));
  await sleep(300);
  s = await state();
  check('crime raises wanted stars', s.stars >= 2, `stars=${s.stars} heat=${s.heat}`);
  await page.keyboard.down('KeyW');
  await sleep(2800);
  await page.keyboard.up('KeyW');
  s = await state();
  check('police respond and give chase', s.cops >= 1 && s.screen === 'playing', `cops=${s.cops}`);

  const saved = await call(() => localStorage.getItem('vice-heat-port-azura-save-v1'));
  check('progress is saved to localStorage', !!saved && saved.includes('"cash"'));

  check('zero page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('zero external requests', externalRequests.length === 0, externalRequests.join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(failures === 0 ? 'PLAYTEST: ALL PASS' : `PLAYTEST: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
