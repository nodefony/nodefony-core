#!/usr/bin/env node
/**
 * Banc — boot SERVEUR de développement, N cycles start/stop, médiane.
 *
 * Chaque cycle : `start.sh` (skill nodefony-start-server, pose `--expose-gc`),
 * puis lecture du bilan `var/last-boot.json` écrit par le noyau (`durationMs` :
 * UNE horloge, celle du serveur), puis deux appels de la sonde
 * `/nodefony/test/memory` (GC forcé côté serveur → tas RETENU après le boot ;
 * la seconde lecture est retenue), puis `nodefony stop`.
 *
 * @usage node .claude/skills/nodefony-load-test/scripts/server-boot-bench.mjs 7 tmp/bench/<sujet>-server-boot-before.json
 * @option --keep-last laisse le serveur du dernier cycle en vie (pour enchaîner un gate).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const START = path.join(
  REPO_ROOT,
  ".claude",
  "skills",
  "nodefony-start-server",
  "start.sh",
);
const LAST_BOOT = path.join(REPO_ROOT, "var", "last-boot.json");
const PROBE = "http://127.0.0.1:5151/nodefony/test/memory";

const cycles = Number(process.argv[2]) || 7;
const outFile =
  process.argv[3] ?? path.join(REPO_ROOT, "tmp", "bench", "server-boot.json");
const keepLast = process.argv.includes("--keep-last");

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function probe() {
  const res = await fetch(PROBE);
  if (!res.ok) throw new Error(`sonde ${res.status}`);
  return res.json();
}

function stop() {
  spawnSync("npx", ["nodefony", "stop"], { cwd: REPO_ROOT, stdio: "ignore" });
}

const results = [];
for (let i = 0; i < cycles; i++) {
  process.stdout.write(`cycle ${i + 1}/${cycles} … `);
  fs.rmSync(LAST_BOOT, { force: true });
  const t0 = performance.now();
  const started = spawnSync("bash", [START], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  const startMs = performance.now() - t0;
  if (started.status !== 0) {
    console.log(`FAIL: start.sh exit ${started.status}`);
    stop();
    continue;
  }
  try {
    // `start.sh` rend la main dès que les ports écoutent et que /livez répond ;
    // le bilan est écrit un peu après (fin d'`initServers`, écouteurs
    // `onServersReady` compris). On ATTEND le fichier de CE démarrage.
    const startedAt = Date.now() - startMs;
    let boot = null;
    for (let tries = 0; tries < 120 && boot === null; tries++) {
      try {
        const parsed = JSON.parse(fs.readFileSync(LAST_BOOT, "utf8"));
        if (Date.parse(parsed.timestamp) >= startedAt - 1000) boot = parsed;
      } catch {
        /* pas encore écrit */
      }
      if (boot === null) await new Promise((r) => setTimeout(r, 500));
    }
    if (boot === null) throw new Error("bilan last-boot.json jamais écrit");
    await probe();
    const m = await probe();
    results.push({
      startMs,
      durationMs: boot.durationMs,
      modules: boot.modulesLoaded?.length ?? null,
      heapUsed: m.heapUsed,
      rss: m.rss,
      gcForced: m.gcForced,
      activeResourcesTotal: m.activeResourcesTotal,
    });
    console.log(
      `start.sh ${startMs.toFixed(0)} ms · boot noyau ${boot.durationMs} ms · heapUsed ${(m.heapUsed / 1024 / 1024).toFixed(2)} Mo · rss ${(m.rss / 1024 / 1024).toFixed(1)} Mo · gc=${m.gcForced} · handles ${m.activeResourcesTotal}`,
    );
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
  if (!(keepLast && i === cycles - 1)) stop();
}

if (results.length) {
  const summary = {
    cycles: results.length,
    durationMs: {
      median: median(results.map((r) => r.durationMs)),
      all: results.map((r) => r.durationMs),
    },
    startMs: {
      median: median(results.map((r) => r.startMs)),
      all: results.map((r) => Math.round(r.startMs)),
    },
    heapUsed: {
      median: median(results.map((r) => r.heapUsed)),
      all: results.map((r) => r.heapUsed),
    },
    rss: {
      median: median(results.map((r) => r.rss)),
      all: results.map((r) => r.rss),
    },
    activeResourcesTotal: {
      median: median(results.map((r) => r.activeResourcesTotal)),
      all: results.map((r) => r.activeResourcesTotal),
    },
    modules: results[0].modules,
    gcForced: results.every((r) => r.gcForced),
    node: process.version,
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `\n=== boot serveur dev : ${summary.cycles} cycles — boot noyau médiane ${summary.durationMs.median} ms · ` +
      `heapUsed médiane ${(summary.heapUsed.median / 1024 / 1024).toFixed(2)} Mo · rss médiane ${(summary.rss.median / 1024 / 1024).toFixed(1)} Mo · ` +
      `handles médiane ${summary.activeResourcesTotal.median} · modules ${summary.modules} · gcForced=${summary.gcForced} ===`,
  );
  console.log(`→ ${outFile}`);
}
