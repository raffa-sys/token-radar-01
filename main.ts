// SPDX-License-Identifier: MIT
// Token launch radar — entry point.
//
// Reads the sealed snapshot, builds the ranked board, self-validates it,
// and writes board.json, data.js, the dashboard, the screenshots and
// dossier.json into the output directory. Standard library only, no
// network, deterministic: the same input always produces the same bytes.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSnapshot, buildBoard, validateBoard, buildDashboardData, writeDataScript } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "/input";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input" && i + 1 < argv.length) input = argv[++i];
    else if (arg.startsWith("--input=")) input = arg.slice("--input=".length);
    else if (arg === "--output" && i + 1 < argv.length) output = argv[++i];
    else if (arg.startsWith("--output=")) output = arg.slice("--output=".length);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node main.ts [--input <snapshot.json or dir>] [--output <dir>]\n");
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return { input, output };
}

function resolveSnapshotPath(input: string): string {
  const target = resolve(input);
  if (!existsSync(target)) fail(`input not found: ${input}`);
  const stat = statSync(target);
  if (stat.isDirectory()) {
    const inside = join(target, "snapshot.json");
    if (!existsSync(inside)) fail(`no snapshot.json inside input directory: ${input}`);
    return inside;
  }
  return target;
}

// Copy a directory tree into the output, skipping any name starting with a
// dot, and return the number of regular files copied.
function copyTree(sourceDir: string, destDir: string): number {
  mkdirSync(destDir, { recursive: true });
  let count = 0;
  const entries = readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const from = join(sourceDir, entry.name);
    const to = join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      count++;
    }
  }
  return count;
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile()) count++;
    else if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
  }
  return count;
}

async function main(): Promise<void> {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshotPath = resolveSnapshotPath(input);
  const snapshotText = readFileSync(snapshotPath, "utf8");
  const snapshot = parseSnapshot(snapshotText);

  const { rows, meta, scores } = buildBoard(snapshot);
  validateBoard(rows, snapshot);

  const outDir = resolve(output);
  mkdirSync(outDir, { recursive: true });

  // Screenshots are checked before anything is written, so a refusal
  // leaves no partial output behind.
  const dashboardSource = join(REPO_ROOT, "dashboard");
  if (!existsSync(dashboardSource)) fail("dashboard/ directory missing from repository");
  const screenshotsSource = join(REPO_ROOT, "screenshots");
  if (!existsSync(screenshotsSource) || countFiles(screenshotsSource) < 3) {
    fail("screenshots/ holds fewer than 3 images; refusing to write an output the gate would reject");
  }

  // board.json: a JSON object with a rows array and a trailing newline.
  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows }) + "\n", "utf8");

  // data.js lives at the output root, beside the dashboard directory.
  const dashboardData = buildDashboardData(snapshot, rows, meta, scores);
  writeFileSync(join(outDir, "data.js"), writeDataScript(dashboardData), "utf8");

  // Dashboard and screenshots, copied verbatim from the repository.
  copyTree(dashboardSource, join(outDir, "dashboard"));
  copyTree(screenshotsSource, join(outDir, "screenshots"));

  // dossier.json is written last, from exactly what the library returns:
  // a string is written as-is, raw bytes (Uint8Array) are written as-is,
  // and anything else is serialised as JSON.
  const dossier = await buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  if (typeof dossier === "string") {
    writeFileSync(join(outDir, "dossier.json"), dossier, "utf8");
  } else if (dossier instanceof Uint8Array) {
    writeFileSync(join(outDir, "dossier.json"), dossier);
  } else {
    writeFileSync(join(outDir, "dossier.json"), JSON.stringify(dossier, null, 2) + "\n", "utf8");
  }

  process.stdout.write(
    `token-radar: protocols=${snapshot.protocols.length} ` +
      `watchlist=${snapshot.watchlist.length} ` +
      `pre-token=${meta.pre_token_protocols} live=${meta.live_token_protocols} ` +
      `ranked_rows=${rows.length} watchlist_covered=${meta.watchlist_covered}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
