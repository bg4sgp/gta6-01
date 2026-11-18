// The scripted playtest: boot the real game in headless Chrome, play it with
// synthetic keys through the DevTools protocol, and assert the things a player
// would notice — the run starts, Rook walks, a car drives, crime brings the
// police, a mission completes and pays, and the save lands in localStorage.
// It also fails on any page exception or any request that is not same-origin.
// Usage: node playtest.mjs
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8932;
const DEBUG_PORT = 9932;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const base = join(homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  for (const version of readdirSync(base)) {
    const path = join(base, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(path)) return path;
  }
  throw new Error('chrome-headless-shell not found under ~/.cache/puppeteer');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: root, stdio: 'ignore' });
  const browser = spawn(findBrowser(), [
    `--remote-debugging-port=${DEBUG_PORT}`, '--no-sandbox', '--hide-scrollbars',
    '--window-size=1280,720', '--force-device-scale-factor=1', 'about:blank',
  ], { stdio: 'ignore' });
  const requests = [];
  const exceptions = [];
  try {
    let ws;
    for (let i = 0; i < 40 && !ws; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page) {
          ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((res2, rej) => { ws.onopen = res2; ws.onerror = rej; });
        }
      } catch { /* not up yet */ }
      if (!ws) await sleep(250);
    }
    let id = 0;
    const pending = new Map();
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
      if (data.method === 'Network.requestWillBeSent') requests.push(data.params.request.url);
      if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (res.result && res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
      return res.result.result.value;
    };
    const key = async (code, type) => {
      await send('Input.dispatchKeyEvent', { type, code, key: code === 'Enter' ? 'Enter' : code.replace('Key', '').toLowerCase() });
    };
    const holdKey = async (code, ms) => {
      await key(code, 'keyDown');
      await sleep(ms);
      await key(code, 'keyUp');
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(1600);

    check('boots to the title screen', await evaluate('window.VICEHEAT && VICEHEAT.state.mode') === 'title');
    await key('Enter', 'keyDown');
    await key('Enter', 'keyUp');
    await sleep(400);
    check('Enter starts a run', await evaluate('VICEHEAT.state.mode') === 'play');
    check('the first mission is live', await evaluate('!!VICEHEAT.state.missions.active') === true);

    const y0 = await evaluate('VICEHEAT.state.player.y');
    await holdKey('KeyW', 650);
    const y1 = await evaluate('VICEHEAT.state.player.y');
    check('Rook walks north on W', y1 < y0 - 30, `y ${Math.round(y0)} -> ${Math.round(y1)}`);

    check('a car can be entered', await evaluate('VICEHEAT.enterNearestCar()') === true);
    check('the player is driving', await evaluate('!!VICEHEAT.state.player.car') === true);
    const cx0 = await evaluate('VICEHEAT.state.player.car.x');
    await holdKey('KeyW', 1500);
    const speed = await evaluate('Math.hypot(VICEHEAT.state.player.car.vx, VICEHEAT.state.player.car.vy)');
    const cx1 = await evaluate('VICEHEAT.state.player.car.x');
    check('the car moves under power', speed > 40 || Math.abs(cx1 - cx0) > 120, `speed ${Math.round(speed)}, dx ${Math.round(cx1 - cx0)}`);

    await evaluate('VICEHEAT.crime()');
    await sleep(300);
    const stars = await evaluate('VICEHEAT.state.wanted.stars');
    check('crime raises wanted stars', stars >= 2, `${stars} stars`);
    await sleep(2600);
    const cops = await evaluate("VICEHEAT.state.cars.filter(c => c.role === 'police').length");
    check('police respond', cops >= 1, `${cops} cruisers`);

    const cash0 = await evaluate('VICEHEAT.state.cash');
    await evaluate('(() => { const g = VICEHEAT.state.city.specials.garage; VICEHEAT.teleport(g.x, g.y); })()');
    await sleep(1200);
    const cash1 = await evaluate('VICEHEAT.state.cash');
    const missionIndex = await evaluate('VICEHEAT.state.missions.index');
    check('the first mission completes and pays', missionIndex === 1 && cash1 > cash0, `cash ${cash0} -> ${cash1}`);
    const saved = await evaluate("localStorage.getItem('viceheat-save-v1')");
    check('progress is saved', typeof saved === 'string' && saved.includes('"missionIndex":1'));

    const external = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${PORT}`) && !u.startsWith('data:'));
    check('no request leaves the machine', external.length === 0, external.join(', '));
    check('no page exceptions', exceptions.length === 0, exceptions.join(' | '));
    ws.close();
  } finally {
    browser.kill();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? `\nPLAYTEST OK (${results.length} checks)` : `\nPLAYTEST FAILED (${failed.length}/${results.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
