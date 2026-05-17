#!/usr/bin/env node
/**
 * POC bench — mesure la latence p50/p95/p99 du backend Nodefony
 * pendant que Vite tourne / compile.
 *
 * Usage :
 *   node scripts/poc-bench.mjs [--url http://127.0.0.1:5151/poc/api/data]
 *                              [--duration 10000]
 *                              [--concurrency 50]
 *                              [--label baseline]
 *                              [--touch /path/to/file]   ← rebuild trigger Vite
 *                              [--touch-delay 2000]      ← ms après start
 *
 * Output JSON sur stdout :
 *   { label, url, durationMs, total, ok, errors, p50, p95, p99, rps, ... }
 */
import { performance } from "node:perf_hooks";
import { utimes } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? "http://127.0.0.1:5151/poc/api/data";
const durationMs = parseInt(args.duration ?? "10000", 10);
const concurrency = parseInt(args.concurrency ?? "50", 10);
const label = args.label ?? "default";
const touchPath = args.touch ?? null;
const touchDelay = parseInt(args["touch-delay"] ?? "2000", 10);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

async function fireRequest() {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers: { connection: "keep-alive" } });
    if (!r.ok) {
      await r.text();
      return { ok: false, latency: performance.now() - t0, status: r.status };
    }
    await r.text(); // drain body
    return { ok: true, latency: performance.now() - t0, status: r.status };
  } catch (e) {
    return {
      ok: false,
      latency: performance.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function worker(latencies, errors, stopAt) {
  while (performance.now() < stopAt) {
    const r = await fireRequest();
    if (r.ok) latencies.push(r.latency);
    else errors.push(r);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx];
}

async function maybeTouch() {
  if (!touchPath) return;
  const fireAt = performance.now() + touchDelay;
  while (performance.now() < fireAt) await new Promise((r) => setTimeout(r, 50));
  try {
    const now = new Date();
    await utimes(touchPath, now, now);
    process.stderr.write(`[bench] touched ${touchPath} at +${touchDelay}ms\n`);
  } catch (e) {
    process.stderr.write(`[bench] touch failed: ${e.message}\n`);
  }
}

async function main() {
  const latencies = [];
  const errors = [];
  const startedAt = performance.now();
  const stopAt = startedAt + durationMs;

  const workers = Array.from({ length: concurrency }, () =>
    worker(latencies, errors, stopAt),
  );
  const touchPromise = maybeTouch();

  await Promise.all([...workers, touchPromise]);

  const total = latencies.length + errors.length;
  latencies.sort((a, b) => a - b);
  const elapsed = performance.now() - startedAt;
  const result = {
    label,
    url,
    durationMs: Math.round(elapsed),
    concurrency,
    total,
    ok: latencies.length,
    errors: errors.length,
    rps: Math.round((total / elapsed) * 1000),
    p50: round(percentile(latencies, 50)),
    p95: round(percentile(latencies, 95)),
    p99: round(percentile(latencies, 99)),
    max: round(latencies[latencies.length - 1] ?? null),
    mean: round(
      latencies.reduce((s, x) => s + x, 0) / Math.max(1, latencies.length),
    ),
    touchedAt: touchPath ? touchDelay : null,
    touchPath: touchPath ?? null,
    errorSample: errors.slice(0, 3),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function round(x) {
  if (x === null || x === undefined) return null;
  return Math.round(x * 100) / 100;
}

main().catch((e) => {
  process.stderr.write(`[bench] fatal: ${e.stack ?? e.message}\n`);
  process.exit(2);
});
