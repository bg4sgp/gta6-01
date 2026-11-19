// Vice Heat — Port Azura: the hand-in program for make.fun's gta6-01 bounty
// (Node 22, standard library only). The game itself is the static site in
// game/ beside this file; this program packages it for the judges: it copies
// game/ and screenshots/ into the output directory and writes dossier.json
// with the vendored make.fun library, byte for byte what the scorer rebuilds.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// MAKEFUN_OUTPUT_DIR stands in for /output outside the grader's container.
// The program is deterministic: same repository in, same bytes out.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's own caps (reference/gate.json): game/ holds at most 993 entries
// and 48 MiB with no path over 1,000 bytes; screenshots are at most 4 files
// of 256 KiB; the dossier's text is capped at 160 KiB.
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name));
    else n += 1;
  }
  return n;
}

mkdirSync(outDir, { recursive: true });

const gameSrc = join(repoDir, 'game');
if (!existsSync(join(gameSrc, 'index.html'))) {
  throw new Error('game/index.html is missing: the game must live in game/ beside main.ts');
}
cpSync(gameSrc, join(outDir, 'game'), { recursive: true });

const shotsSrc = join(repoDir, 'screenshots');
const shotsOut = join(outDir, 'screenshots');
mkdirSync(shotsOut, { recursive: true });
if (existsSync(shotsSrc)) cpSync(shotsSrc, shotsOut, { recursive: true });
const shotCount = readdirSync(shotsOut).filter((f) => /\.(png|jpe?g)$/i.test(f)).length;
if (shotCount < 3 || shotCount > 4) {
  throw new Error(`screenshots/ must hold 3 or 4 images for the judges, found ${shotCount}`);
}

const dossier = buildDossier(outDir, DOSSIER_LIMITS);
writeFileSync(join(outDir, 'dossier.json'), dossier);

const gameFiles = countFiles(join(outDir, 'game'));
const dossierBytes = statSync(join(outDir, 'dossier.json')).size;
// The dossier is the one file the judges hold against a hard cap (1.5 MiB);
// fail here, loudly, rather than hand in an entry the gate would refuse.
if (dossierBytes > 1572864) {
  throw new Error(`dossier.json is ${dossierBytes} bytes, over the 1.5 MiB cap`);
}
console.log(`vice-heat: packaged ${gameFiles} game files and ${shotCount} screenshots; dossier.json is ${dossierBytes} bytes`);
