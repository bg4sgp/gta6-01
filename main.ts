// VICE HEAT — Port Azura: the hand-in program for make.fun's gta6-01 bounty (Node 22,
// standard library only). The game itself is the static site under game/ (open
// game/index.html in a desktop browser and play; it loads nothing from the network):
// an open-world crime game in the sunset city of Port Azura — a drivable grid of
// pastel towers and neon signs with traffic and crowds, cars to steal, a five-star
// wanted system and the police who answer it, a five-job story for the fixer Viv,
// fares after it, a minimap HUD, synthesized sound, and a save that keeps your
// cash and your place in the story. This program copies game/ and screenshots/
// into the output directory and writes the dossier the judge reads, using the
// kit's vendored buildDossier library, unchanged.
//
// Run it locally the way the grader does, with the output directory standing in:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with:  node serve.ts   (then open the printed address)

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, mirrored so a bad entry fails here first instead of at the gate:
// dossier text at most 160 KiB, at most 4 screenshots of at most 256 KiB each, game/ at
// most 993 entries and 48 MiB in all, and no path under game/ longer than 1000 bytes.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

function treeSize(dir: string): number {
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    bytes += stats.isDirectory() ? treeSize(path) : stats.size;
  }
  return bytes;
}

mkdirSync(outputDir, { recursive: true });
copyTree(join(repoRoot, 'game'), join(outputDir, 'game'));
copyTree(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));

const dossier = buildDossier(outputDir, DOSSIER_CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

const gameBytes = treeSize(join(outputDir, 'game'));
console.log(`vice-heat: game/ ${gameBytes} bytes, dossier.json ${Buffer.byteLength(dossier)} bytes -> ${outputDir}`);
