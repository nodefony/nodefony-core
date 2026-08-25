#!/usr/bin/env node
/*
 * boot-bench.mjs — mesure le temps de boot d'un mode Nodefony (du spawn jusqu'à ce que
 * les serveurs écoutent) et compte le nombre de `new Kernel()` via NF_KERNEL_TRACE_FILE.
 *
 * Usage : node scripts/boot-bench.mjs <runs> -- <args nodefony...>
 *   node scripts/boot-bench.mjs 3 -- production --workers 1
 *   node scripts/boot-bench.mjs 3 -- cluster --workers 1
 *
 * Prérequis : dist à jour (npm run build), ports 5151/5152 libres (stop.sh).
 * Outil d'AUDIT (pas un test de non-régression) — readiness détectée sur "Server Listen on".
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const BIN = path.join(REPO_ROOT, "src", "nodefony", "bin", "nodefony");
const READY_RE = /Server Listen on http/i; // 1er serveur réseau (pas les statics)

const sep = process.argv.indexOf("--");
const runs = Number(process.argv[2]) || 3;
const cmdArgs =
  sep >= 0 ? process.argv.slice(sep + 1) : ["production", "--workers", "1"];

function once(args) {
  return new Promise((resolve, reject) => {
    const traceFile = path.join(
      os.tmpdir(),
      `boot-bench-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
    const t0 = performance.now();
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, NF_KERNEL_TRACE_FILE: traceFile },
    });
    let out = "";
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      const ms = performance.now() - t0;
      let kernels = 0;
      try {
        kernels = fs
          .readFileSync(traceFile, "utf8")
          .split("\n")
          .filter((l) => l.trim()).length;
      } catch {
        /* ignore */
      }
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 4000);
      try {
        fs.rmSync(traceFile, { force: true });
      } catch {
        /* ignore */
      }
      if (err) return reject(err);
      resolve({ ms, kernels });
    };
    const onData = (d) => {
      out += d.toString();
      if (READY_RE.test(out)) finish(null);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", finish);
    child.once("exit", (code, sig) =>
      finish(
        new Error(
          `exit before ready (code=${code} sig=${sig})\n${out.slice(-1500)}`,
        ),
      ),
    );
    setTimeout(
      () => finish(new Error(`timeout 60s\n${out.slice(-1500)}`)),
      60000,
    );
  });
}

const results = [];
for (let i = 0; i < runs; i++) {
  process.stdout.write(`run ${i + 1}/${runs} [${cmdArgs.join(" ")}] ... `);
  try {
    const r = await once(cmdArgs);
    results.push(r);
    console.log(`${r.ms.toFixed(0)} ms — ${r.kernels} kernel(s)`);
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800)); // laisser les ports se libérer
}

if (results.length) {
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  const min = times[0];
  const max = times[times.length - 1];
  const med = times[Math.floor(times.length / 2)];
  console.log(
    `\n=== boot [${cmdArgs.join(" ")}] : ${results.length} runs — avg ${avg.toFixed(0)} ms · médiane ${med.toFixed(0)} ms · min ${min.toFixed(0)} · max ${max.toFixed(0)} · kernels=${results[0].kernels} ===`,
  );
}
