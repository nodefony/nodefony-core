#!/usr/bin/env node
/**
 * Banc — boot CONSOLE du noyau, N runs, médiane.
 *
 * Mesure, par run d'une commande console (`nodefony inspect services --json`
 * par défaut) :
 *   - `wallMs`   : du spawn à la sortie du processus (horloge du banc) ;
 *   - `uptimeMs` : durée de vie du processus mesuré, lue DANS le processus
 *                  (`process.uptime()` à `exit`) — une seule horloge ;
 *   - `heapUsed` : tas RETENU à la sortie, après deux `gc()` forcés
 *                  (`--expose-gc` + crochet `heap-at-exit.mjs`).
 *
 * @usage node .claude/skills/nodefony-load-test/scripts/console-boot-bench.mjs 7 tmp/bench/<sujet>-console-boot-before.json
 * @usage node .claude/skills/nodefony-load-test/scripts/console-boot-bench.mjs 7 tmp/bench/<sujet>-console-boot.json -- inspect routes --json
 * @requires dist à jour (npm run build)
 * @output médianes wall/uptime/heapUsed/rss en JSON (défaut : tmp/bench/console-boot.json)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const BIN = path.join(REPO_ROOT, "src", "nodefony", "bin", "nodefony");
const HOOK = path.join(HERE, "heap-at-exit.mjs");

const sep = process.argv.indexOf("--");
const runs = Number(process.argv[2]) || 7;
const outFile =
  process.argv[3] ?? path.join(REPO_ROOT, "tmp", "bench", "console-boot.json");
const cmdArgs =
  sep >= 0 ? process.argv.slice(sep + 1) : ["inspect", "services", "--json"];

const heapFile = path.join(os.tmpdir(), `nf-boot-heap-${process.pid}.jsonl`);

function once() {
  return new Promise((resolve, reject) => {
    fs.rmSync(heapFile, { force: true });
    const t0 = performance.now();
    const child = spawn(process.execPath, [BIN, ...cmdArgs], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NF_BENCH_HEAP_FILE: heapFile,
        NODE_OPTIONS: `--expose-gc --import=${pathToFileURL(HOOK).href}`,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      const wallMs = performance.now() - t0;
      if (code !== 0) {
        return reject(new Error(`exit ${code}\n${err.slice(-1200)}`));
      }
      let rec = null;
      try {
        const lines = fs
          .readFileSync(heapFile, "utf8")
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
        rec = lines.find((l) => l.pid === child.pid) ?? lines[0] ?? null;
      } catch {
        /* pas de ligne : le crochet n'a pas tourné */
      }
      if (!rec) return reject(new Error("crochet muet : aucune mesure de tas"));
      resolve({ wallMs, ...rec });
    });
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const results = [];
for (let i = 0; i < runs; i++) {
  process.stdout.write(`run ${i + 1}/${runs} [${cmdArgs.join(" ")}] … `);
  try {
    const r = await once();
    results.push(r);
    console.log(
      `wall ${r.wallMs.toFixed(0)} ms · uptime ${r.uptimeMs} ms · heapUsed ${(r.heapUsed / 1024 / 1024).toFixed(2)} Mo · rss ${(r.rss / 1024 / 1024).toFixed(1)} Mo · gc=${r.gcForced}`,
    );
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
}
fs.rmSync(heapFile, { force: true });

if (results.length) {
  const summary = {
    command: cmdArgs.join(" "),
    runs: results.length,
    wallMs: {
      median: median(results.map((r) => r.wallMs)),
      all: results.map((r) => Math.round(r.wallMs)),
    },
    uptimeMs: {
      median: median(results.map((r) => r.uptimeMs)),
      all: results.map((r) => r.uptimeMs),
    },
    heapUsed: {
      median: median(results.map((r) => r.heapUsed)),
      all: results.map((r) => r.heapUsed),
    },
    rss: {
      median: median(results.map((r) => r.rss)),
      all: results.map((r) => r.rss),
    },
    gcForced: results.every((r) => r.gcForced),
    node: process.version,
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `\n=== boot console [${summary.command}] : ${summary.runs} runs — ` +
      `wall médiane ${summary.wallMs.median.toFixed(0)} ms · uptime médiane ${summary.uptimeMs.median} ms · ` +
      `heapUsed médiane ${(summary.heapUsed.median / 1024 / 1024).toFixed(2)} Mo · rss médiane ${(summary.rss.median / 1024 / 1024).toFixed(1)} Mo · gcForced=${summary.gcForced} ===`,
  );
  console.log(`→ ${outFile}`);
}
