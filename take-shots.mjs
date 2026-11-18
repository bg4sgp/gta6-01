// Take the entry's screenshots: serve game/, open each scene named in shots.json
// in headless Chrome over the DevTools protocol, wait until the game says the
// scene is staged (window.__shotReady), and save the frame as a JPEG that fits
// the gate's 256 KiB cap. Node 22+, no dependencies: CDP runs over the global
// WebSocket. Usage: node take-shots.mjs
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8931;
const DEBUG_PORT = 9931;
const MAX_BYTES = 262144;

function findBrowser() {
  const base = join(homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  for (const version of readdirSync(base)) {
    const path = join(base, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(path)) return path;
  }
  throw new Error('chrome-headless-shell not found under ~/.cache/puppeteer');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectCdp() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res2, rej) => { ws.onopen = res2; ws.onerror = rej; });
        let id = 0;
        const pending = new Map();
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data.id && pending.has(data.id)) {
            pending.get(data.id)(data);
            pending.delete(data.id);
          }
        };
        const send = (method, params = {}) => new Promise((resolve) => {
          id += 1;
          pending.set(id, resolve);
          ws.send(JSON.stringify({ id, method, params }));
        });
        return { ws, send };
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('could not connect to the browser DevTools');
}

async function main() {
  const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: root, stdio: 'ignore' });
  const browser = spawn(findBrowser(), [
    `--remote-debugging-port=${DEBUG_PORT}`, '--no-sandbox', '--hide-scrollbars',
    '--window-size=1280,720', '--force-device-scale-factor=1', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const { ws, send } = await connectCdp();
    await send('Page.enable');
    await send('Runtime.enable');
    for (const shot of shots) {
      const url = `http://127.0.0.1:${PORT}/${shot.query}`;
      await send('Page.navigate', { url });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i += 1) {
        await sleep(300);
        const res = await send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
        ready = res.result && res.result.result && res.result.result.value === true;
      }
      if (!ready) throw new Error(`${shot.name}: the scene never staged`);
      await sleep(650); // let the staged moment breathe before the frame
      let quality = 84;
      let data = null;
      while (quality >= 46) {
        const shotRes = await send('Page.captureScreenshot', { format: 'jpeg', quality });
        data = shotRes.result.data;
        const bytes = Buffer.byteLength(data, 'base64');
        if (bytes <= MAX_BYTES) break;
        quality -= 12;
      }
      const out = join(root, 'screenshots', shot.name);
      writeFileSync(out, Buffer.from(data, 'base64'));
      console.log(`${shot.name}: ${statSync(out).size} bytes at quality ${quality}`);
    }
    ws.close();
  } finally {
    browser.kill();
    server.kill();
  }
}

await main();
