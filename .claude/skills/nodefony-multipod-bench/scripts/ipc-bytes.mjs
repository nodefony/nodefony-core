#!/usr/bin/env node
/**
 * ipc-bytes.mjs — ce que coûte la sérialisation `advanced` (clonage structuré) de
 * l'IPC du cluster, que le master pose depuis #618, face au JSON d'avant :
 *  - OCTETS : JSON + base64 (avant) contre `Uint8Array` brut en `advanced` ;
 *  - TEXTE ORDINAIRE : la même enveloppe realtime en JSON et en `advanced` — le
 *    changement s'applique à TOUT l'IPC, il ne doit pas ralentir le cas courant.
 *
 * Un parent, un enfant forké (comme master ↔ worker), l'enveloppe realtime réelle
 * (`kind: nf:rt`). Latence aller-retour espacée (horloge du parent), débit sous
 * fenêtre bornée, CPU par message des deux côtés ; médiane de N runs.
 *
 * Usage : node .claude/skills/nodefony-multipod-bench/scripts/ipc-bytes.mjs \
 *   [--sizes 64,1024,16384,65536] [--runs 5] [--pings 1000] [--flood 20000] [--window 256]
 */
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { CLUSTER_RT_KIND } from "nodefony";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..", "..", "..", "..");
const ACK_EVERY = 32;

/** Formats éprouvés : sérialisation du canal + forme de la charge. */
const FORMATS = {
  "octets json+b64": { serialization: "json", bytes: "b64" },
  "octets advanced": { serialization: "advanced", bytes: "raw" },
  "texte json": { serialization: "json", bytes: "text" },
  "texte advanced": { serialization: "advanced", bytes: "text" },
};

function payload(kind, seq, total, bytes, text) {
  if (kind === "b64")
    return {
      seq,
      total,
      data: Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ).toString("base64"),
    };
  if (kind === "raw") return { seq, total, data: bytes };
  return { seq, total, text };
}
function read(kind, p) {
  if (kind === "b64") return Buffer.from(p.data, "base64");
  if (kind === "raw") return p.data;
  return p.text;
}
const envelope = (channel, p) => ({
  kind: CLUSTER_RT_KIND,
  channel,
  payload: p,
  originId: String(process.pid),
});

// ─── Enfant : écho des pings, puits du flot ─────────────────────────────────
if (process.argv[2] === "--child") {
  const kind = process.argv[3];
  let received = 0;
  let cpu0 = null;
  process.on("message", (m) => {
    if (m === "quit") process.exit(0);
    if (m?.kind !== CLUSTER_RT_KIND) return;
    if (m.channel === "ping") {
      const v = read(kind, m.payload);
      const back =
        kind === "b64"
          ? payload("b64", m.payload.seq, 0, new Uint8Array(v))
          : m.payload;
      process.send(envelope("pong", back));
      return;
    }
    if (received === 0) cpu0 = process.cpuUsage();
    read(kind, m.payload);
    received += 1;
    const total = m.payload.total;
    if (received % ACK_EVERY === 0 || received === total)
      process.send(envelope("ack", { received }));
    if (received === total) {
      const c = process.cpuUsage(cpu0);
      process.send(envelope("cpu", { us: c.user + c.system }));
      received = 0;
    }
  });
  process.send("ready");
} else {
  await main();
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}
// Déclarations de fonction (hissées) : `main()` s'exécute plus haut, au chargement du module.
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(xs, q) {
  return [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(q * xs.length))
  ];
}

async function oneRun({ format, bytes, text, pings, flood, window }) {
  const { serialization, bytes: kind } = FORMATS[format];
  const child = fork(SELF, ["--child", kind], {
    serialization,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  await new Promise((r) => child.once("message", r));
  let onPong = null;
  let onAck = null;
  let onCpu = null;
  let acked = 0;
  child.on("message", (m) => {
    if (m?.channel === "pong") onPong?.(m.payload);
    else if (m?.channel === "ack") {
      acked = Math.max(acked, m.payload.received);
      onAck?.();
    } else if (m?.channel === "cpu") onCpu?.(m.payload.us);
  });

  const rtts = [];
  const warmup = Math.min(100, pings);
  for (let i = 0; i < warmup + pings; i++) {
    const t0 = performance.now();
    await new Promise((resolve) => {
      onPong = (p) => {
        read(kind, p);
        resolve();
      };
      child.send(envelope("ping", payload(kind, i, 0, bytes, text)));
    });
    if (i >= warmup) rtts.push(performance.now() - t0);
  }

  const cpuB = new Promise((r) => (onCpu = r));
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let sent = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (sent < flood && sent - acked < window) {
        child.send(envelope("flood", payload(kind, sent, flood, bytes, text)));
        sent += 1;
      }
      if (acked >= flood) resolve();
    };
    onAck = pump;
    pump();
  });
  const ms = performance.now() - t0;
  const cpuA = process.cpuUsage(cpu0);
  const cpuChild = await cpuB;
  child.send("quit");
  await new Promise((r) => child.once("exit", r));
  return {
    rttP50: pct(rtts, 0.5),
    rttP99: pct(rtts, 0.99),
    msgsPerSec: (flood / ms) * 1000,
    cpuPubUs: (cpuA.user + cpuA.system) / flood,
    cpuSubUs: cpuChild / flood,
  };
}

async function main() {
  const sizes = arg("sizes", "64,1024,16384,65536").split(",").map(Number);
  const runs = Number(arg("runs", "5"));
  const pings = Number(arg("pings", "1000"));
  const flood = Number(arg("flood", "20000"));
  const window = Number(arg("window", "256"));
  const out = arg(
    "out",
    path.join("tmp", "bench", `ipc-bytes-${Date.now()}.json`),
  );
  const results = [];
  for (const size of sizes) {
    const bytes = new Uint8Array(randomBytes(size));
    // Texte de même longueur, ASCII : le cas d'une charge applicative ordinaire.
    const text = "x".repeat(size);
    // Formats ALTERNÉS run par run, ordre inversé une fois sur deux (ABBA) : la
    // dérive thermique d'une campagne ne se porte sur aucun format.
    const names = Object.keys(FORMATS);
    const byFormat = Object.fromEntries(names.map((f) => [f, []]));
    for (let i = 0; i < runs; i++)
      for (const format of i % 2 === 0 ? names : [...names].reverse())
        byFormat[format].push(
          await oneRun({ format, bytes, text, pings, flood, window }),
        );
    for (const format of names) {
      const samples = byFormat[format];
      const med = (k) => median(samples.map((s) => s[k]));
      const row = {
        size,
        format,
        rttP50Ms: med("rttP50"),
        rttP99Ms: med("rttP99"),
        msgsPerSec: med("msgsPerSec"),
        cpuPubUs: med("cpuPubUs"),
        cpuSubUs: med("cpuSubUs"),
        samples,
      };
      results.push(row);
      console.log(
        `${String(size).padStart(6)} o  ${format.padEnd(16)}  rtt p50 ${row.rttP50Ms.toFixed(3)} ms  p99 ${row.rttP99Ms.toFixed(3)} ms` +
          `  ${Math.round(row.msgsPerSec)} msg/s  cpu émetteur ${row.cpuPubUs.toFixed(1)} µs  récepteur ${row.cpuSubUs.toFixed(1)} µs`,
      );
    }
  }
  const file = path.resolve(ROOT, out);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      { node: process.version, runs, pings, flood, window, results },
      null,
      2,
    ),
  );
  console.log(`\n→ ${path.relative(ROOT, file)}`);
}
