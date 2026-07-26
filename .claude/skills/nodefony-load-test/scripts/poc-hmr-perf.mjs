#!/usr/bin/env node
/**
 * POC HMR perf — mesure le délai end-to-end entre :
 *   1. `fs.utimes()` (touch) sur un fichier source surveillé par Vite
 *   2. réception du 1er message HMR ("update" ou "full-reload") côté client WS
 *
 * Mesure le ressenti utilisateur "j'ai sauvegardé → l'écran se met à jour".
 *
 * Usage :
 *   node scripts/poc-hmr-perf.mjs --file /abs/path/to/App.tsx
 *                                 [--vite-url ws://127.0.0.1:5173]
 *                                 [--iterations 10]
 *                                 [--gap-ms 1500]
 *
 * Output JSON sur stdout : { iterations, p50, p95, p99, samples: [...] }
 */
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const filePath = args.file;
if (!filePath) {
  process.stderr.write("missing --file <abs path>\n");
  process.exit(2);
}
const viteUrl = args["vite-url"] ?? "ws://127.0.0.1:5173";
const iterations = parseInt(args.iterations ?? "10", 10);
const gapMs = parseInt(args["gap-ms"] ?? "1500", 10);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v =
        argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

async function openViteWs() {
  // Vite HMR subprotocol "vite-hmr"
  const ws = new WebSocket(viteUrl, "vite-hmr");
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener(
      "error",
      (e) => reject(new Error(`ws error: ${e.message ?? "unknown"}`)),
      { once: true },
    );
  });
  return ws;
}

/**
 * Vite est en mode "watch on demand" : il ne surveille un fichier que si son
 * graphe de modules a déjà résolu ce fichier (le client browser l'a fetché).
 *
 * Pour réveiller le watch on simule le browser : on GET `/src/main.tsx` côté
 * Vite (en HTTP), ce qui fait pull `App.tsx` (et tout l'arbre) dans le graphe.
 */
async function warmupViteGraph(httpUrl, entries) {
  for (const e of entries) {
    try {
      const url = `${httpUrl}${e.startsWith("/") ? "" : "/"}${e}`;
      const r = await fetch(url);
      await r.text();
      process.stderr.write(`[hmr-bench] warmup ${url} → ${r.status}\n`);
    } catch (err) {
      process.stderr.write(`[hmr-bench] warmup failed: ${err.message}\n`);
    }
  }
}

async function waitHmrEvent(ws, deadlineMs) {
  return new Promise((resolve, reject) => {
    const onMessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "update" || msg.type === "full-reload") {
          ws.removeEventListener("message", onMessage);
          clearTimeout(t);
          resolve(msg);
        }
      } catch {
        // ignore non-JSON
      }
    };
    ws.addEventListener("message", onMessage);
    const t = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`HMR event timeout ${deadlineMs}ms`));
    }, deadlineMs);
  });
}

async function rewriteFileToTriggerHmr(path) {
  // Vite watch via chokidar — `utimes` seul ne déclenche PAS toujours un rebuild
  // (mtime non-significatif pour le content cache). Pour forcer Vite à voir
  // un vrai changement, on append un commentaire — le revert sera fait par main()
  // une fois l'event HMR reçu (pas en setTimeout pour éviter les races).
  const original = await readFile(path, "utf8");
  const marker = `\n// hmr-bench-${Date.now()}\n`;
  await writeFile(path, original + marker, "utf8");
  return original;
}

async function revertFile(path, original) {
  await writeFile(path, original, "utf8");
}

async function main() {
  // Warmup graphe Vite — fetch les entrées pour que chokidar surveille l'arbre
  const httpUrl = viteUrl.replace(/^ws/, "http");
  const entries = (args.entries ?? "src/main.tsx").split(",");
  await warmupViteGraph(httpUrl, entries);

  const ws = await openViteWs();
  process.stderr.write(`[hmr-bench] connected to ${viteUrl}\n`);

  // attend que Vite ait fini son optimizeDeps initial (filet)
  await new Promise((r) => setTimeout(r, 500));

  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const original = await readFile(filePath, "utf8");
    const t0 = performance.now();
    await rewriteFileToTriggerHmr(filePath);
    try {
      const evt = await waitHmrEvent(ws, 10_000);
      const t1 = performance.now();
      const delta = t1 - t0;
      samples.push({ iter: i, delta, type: evt.type });
      process.stderr.write(
        `[hmr-bench] iter ${i}: ${delta.toFixed(1)}ms (${evt.type})\n`,
      );
    } catch (e) {
      samples.push({ iter: i, delta: null, error: e.message });
      process.stderr.write(`[hmr-bench] iter ${i}: FAILED ${e.message}\n`);
    }
    // Revert APRÈS réception de l'event — l'append du revert va re-trigger Vite
    // mais on l'absorbe avec un gap. Mieux : on attend un peu avant revert.
    await new Promise((r) => setTimeout(r, 200));
    await revertFile(filePath, original);
    await new Promise((r) => setTimeout(r, gapMs));
  }

  ws.close();

  const deltas = samples
    .map((s) => s.delta)
    .filter((x) => typeof x === "number");
  deltas.sort((a, b) => a - b);
  const p = (v) => {
    if (deltas.length === 0) return null;
    const idx = Math.min(
      deltas.length - 1,
      Math.floor((deltas.length * v) / 100),
    );
    return Math.round(deltas[idx] * 100) / 100;
  };
  const mean =
    deltas.length === 0
      ? null
      : Math.round((deltas.reduce((s, x) => s + x, 0) / deltas.length) * 100) /
        100;

  const result = {
    label: args.label ?? "hmr-perf",
    file: filePath,
    viteUrl,
    iterations,
    ok: deltas.length,
    fail: iterations - deltas.length,
    p50: p(50),
    p95: p(95),
    p99: p(99),
    min: deltas[0] ? Math.round(deltas[0] * 100) / 100 : null,
    max: deltas[deltas.length - 1]
      ? Math.round(deltas[deltas.length - 1] * 100) / 100
      : null,
    mean,
    samples,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`[hmr-bench] fatal: ${e.stack ?? e.message}\n`);
  process.exit(2);
});
