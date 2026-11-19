// take-shots.mjs — renders the entry's screenshots for real: serves game/
// locally, opens each staged scene from shots.json in headless Chrome, and
// saves JPEGs into screenshots/. Run AFTER the game is final; the images
// must be honest renders of the shipped code.
//
//   CHROME_BIN=<chrome-headless-shell> node take-shots.mjs

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/makefun/shot-tools/package.json');
const puppeteer = require('puppeteer-core');

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const gameDir = join(repoDir, 'game');
const shots = JSON.parse(readFileSync(join(repoDir, 'shots.json'), 'utf8'));
const CHROME = process.env.CHROME_BIN
  ?? '/home/hatch/.cache/puppeteer/chrome-headless-shell/linux-157.0.8103.78/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 8137;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const file = join(gameDir, path === '/' ? 'index.html' : path);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const shot of shots) {
    await page.goto(`http://127.0.0.1:${PORT}/index.html${shot.query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.ViceHeat && window.ViceHeat.ready, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1600)); // let traffic and crowds settle into the scene
    const out = join(repoDir, 'screenshots', shot.name);
    await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
    const bytes = statSync(out).size;
    console.log(`${shot.name}: ${bytes} bytes${bytes > 262144 ? '  <-- OVER the 256 KiB cap!' : ''}`);
    if (bytes > 262144) process.exitCode = 1;
  }
  if (errors.length) {
    console.error('page errors during shooting:', errors);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.close();
}
