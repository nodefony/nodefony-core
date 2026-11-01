#!/usr/bin/env node
/**
 * bus-bytes.mjs — ce que coûtent des OCTETS sur le bus Redis entre deux serveurs :
 * JSON + base64 (ce qu'une application devait faire avant le sujet binaire) contre
 * le sujet binaire CBOR (ADR-0021 S6, #618).
 *
 * Deux process réels (A mesure, B fait écho), un Redis réel, le `RedisBackplane`
 * livré (dist). Trois mesures par format et par taille, médiane de N runs :
 *  - latence aller-retour, messages ESPACÉS (un en vol), sur l'horloge de A seule ;
 *  - débit sous fenêtre bornée (W messages en vol au plus) : un débit, pas un
 *    backlog — une rafale ouverte mesurerait la file, pas le chemin ;
 *  - CPU par message, émetteur (A) et récepteur (B), par `process.cpuUsage`.
 * Plus la taille exacte de l'enveloppe sur le fil, sans réseau. Formats alternés
 * run par run (ABBA) : la dérive thermique ne se porte sur aucun format.
 *
 * Usage (depuis la racine du dépôt, Redis du compose en marche, realtime bâti) :
 *   node .claude/skills/nodefony-multipod-bench/scripts/bus-bytes.mjs \
 *     [--sizes 64,1024,16384,65536] [--runs 5] [--pings 400] [--flood 10000] \
 *     [--window 256] [--secret 1|0] [--out tmp/bench/bus-bytes.json]
 * Redis : NF_REDIS_TEST_URL, sinon redis://:nodefony-dev@127.0.0.1:6379/15.
 */
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "redis";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";
import {
  RedisBackplane,
  createRedisServiceTransport,
} from "@nodefony/realtime";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..", "..", "..", "..");
const URL =
  process.env.NF_REDIS_TEST_URL ?? "redis://:nodefony-dev@127.0.0.1:6379/15";
// Tiré à chaque lancement : le banc n'a besoin que d'un secret PARTAGÉ avec ses
// enfants (passé par argv), jamais d'une valeur fixe versionnée.
const SECRET_VALUE = randomBytes(32).toString("base64url");
const ACK_EVERY = 32;
const MODES = ["json-b64", "cbor"];

/** Charge applicative de chaque format, et sa relecture en octets chez le récepteur. */
const encode = {
  "json-b64": (seq, total, bytes) => ({
    seq,
    total,
    data: Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString("base64"),
  }),
  cbor: (seq, total, bytes) => ({ seq, total, data: bytes }),
};
const decode = {
  "json-b64": (p) => {
    const b = Buffer.from(p.data, "base64");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  },
  cbor: (p) => p.data,
};

/** Un « pod » : deux connexions Redis et un `RedisBackplane`, sujet binaire armé en mode cbor. */
async function pod(origin, channel, mode, secret) {
  const pub = createClient({ url: URL });
  const sub = pub.duplicate();
  pub.on("error", () => {});
  sub.on("error", () => {});
  await pub.connect();
  await sub.connect();
  const bp = new RedisBackplane(
    createRedisServiceTransport(pub, sub, sub),
    origin,
    channel,
    secret,
    // Borne coupée : la fenêtre du banc tient déjà le vol, et une publication
    // jetée par la file fausserait le débit au lieu de le mesurer.
    { maxQueueBytes: 0 },
  );
  if (mode === "cbor" && !bp.enableBytes(CBOR_FRAME_CODEC))
    throw new Error("sujet binaire non armé : transport sans mode octets");
  await bp.start();
  return {
    bp,
    async close() {
      await bp.stop();
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}

// ─── Process B : écho des pings, puits du flot ──────────────────────────────
if (process.argv[2] === "--child") {
  const [, , , mode, channel, secret] = process.argv;
  const p = await pod("pod-B", channel, mode, secret === "-" ? null : secret);
  let received = 0;
  let cpu0 = null;
  p.bp.onMessage((m) => {
    if (m.channel === "ping") {
      const bytes = decode[mode](m.payload);
      p.bp.publish("pong", encode[mode](m.payload.seq, 0, bytes));
      return;
    }
    if (m.channel !== "flood") return;
    if (received === 0) cpu0 = process.cpuUsage();
    decode[mode](m.payload);
    received += 1;
    const total = m.payload.total;
    if (received % ACK_EVERY === 0 || received === total)
      p.bp.publish("ack", { received });
    if (received === total) {
      const c = process.cpuUsage(cpu0);
      p.bp.publish("cpu", { us: c.user + c.system });
      received = 0;
    }
  });
  process.on("message", (msg) => {
    if (msg === "quit") void p.close().then(() => process.exit(0));
  });
  process.send({ ready: true });
} else {
  await main();
}

// ─── Process A : pilote et mesure ───────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function spawnEcho(mode, channel, secret) {
  return new Promise((resolve, reject) => {
    const child = fork(SELF, ["--child", mode, channel, secret ?? "-"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child.once("message", () => resolve(child));
    child.once("error", reject);
  });
}

async function oneRun({ mode, bytes, secret, pings, flood, window, run }) {
  const channel = `bench:bus-bytes:${process.pid}:${mode}:${bytes.length}:${run}`;
  const child = await spawnEcho(mode, channel, secret);
  const a = await pod("pod-A", channel, mode, secret);
  let onPong = null;
  let acked = 0;
  let onAck = null;
  let onCpu = null;
  a.bp.onMessage((m) => {
    if (m.channel === "pong") onPong?.(m.payload);
    else if (m.channel === "ack") {
      acked = Math.max(acked, m.payload.received);
      onAck?.();
    } else if (m.channel === "cpu") onCpu?.(m.payload.us);
  });

  // 1. Latence aller-retour, un message en vol.
  const rtts = [];
  const warmup = Math.min(50, pings);
  for (let i = 0; i < warmup + pings; i++) {
    const t0 = performance.now();
    await new Promise((resolve) => {
      onPong = (payload) => {
        decode[mode](payload);
        resolve();
      };
      a.bp.publish("ping", encode[mode](i, 0, bytes));
    });
    if (i >= warmup) rtts.push(performance.now() - t0);
  }
  onPong = null;

  // 2. Débit sous fenêtre bornée, CPU des deux côtés.
  const cpuB = new Promise((resolve) => (onCpu = resolve));
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let sent = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (sent < flood && sent - acked < window) {
        a.bp.publish("flood", encode[mode](sent, flood, bytes));
        sent += 1;
      }
      if (acked >= flood) resolve();
    };
    onAck = pump;
    pump();
  });
  const elapsedMs = performance.now() - t0;
  const cpuA = process.cpuUsage(cpu0);
  const cpuBus = await cpuB;
  onAck = null;

  child.send("quit");
  await new Promise((r) => child.once("exit", r));
  await a.close();
  return {
    rttP50: percentile(rtts, 0.5),
    rttP99: percentile(rtts, 0.99),
    msgsPerSec: (flood / elapsedMs) * 1000,
    payloadMBps: (flood * bytes.length) / elapsedMs / 1000,
    cpuPubUs: (cpuA.user + cpuA.system) / flood,
    cpuSubUs: cpuBus / flood,
  };
}

/** Taille exacte de l'enveloppe sur le fil, par les fonctions du driver (dist). */
async function wireSizes(bytes, secret) {
  const envelope = await import(
    pathToFileURL(
      path.join(
        ROOT,
        "src/packages/@nodefony/realtime/dist/nodefony/src/backplane/envelope.js",
      ),
    ).href
  );
  const msg = (mode) => ({
    channel: "flood",
    payload: encode[mode](1, 1, bytes),
    originId: "pod-A",
  });
  return {
    "json-b64": Buffer.byteLength(
      envelope.sealBackplaneEnvelope(msg("json-b64"), secret),
    ),
    cbor: envelope.sealBackplaneEnvelopeBytes(
      msg("cbor"),
      CBOR_FRAME_CODEC,
      secret,
    ).byteLength,
  };
}

async function main() {
  const sizes = arg("sizes", "64,1024,16384,65536").split(",").map(Number);
  const runs = Number(arg("runs", "5"));
  const pings = Number(arg("pings", "400"));
  const flood = Number(arg("flood", "10000"));
  const window = Number(arg("window", "256"));
  const secret = arg("secret", "1") === "0" ? null : SECRET_VALUE;
  const out = arg(
    "out",
    path.join("tmp", "bench", `bus-bytes-${Date.now()}.json`),
  );

  const results = [];
  for (const size of sizes) {
    const bytes = new Uint8Array(randomBytes(size));
    const wire = await wireSizes(bytes, secret);
    // Formats ALTERNÉS run par run, ordre inversé une fois sur deux (ABBA) : une
    // machine qui chauffe ralentit au fil de la campagne, et des runs groupés par
    // format feraient porter toute la dérive au format mesuré en second.
    const byMode = Object.fromEntries(MODES.map((m) => [m, []]));
    for (let run = 0; run < runs; run++) {
      const order = run % 2 === 0 ? MODES : [...MODES].reverse();
      for (const mode of order)
        byMode[mode].push(
          await oneRun({ mode, bytes, secret, pings, flood, window, run }),
        );
    }
    for (const mode of MODES) {
      const samples = byMode[mode];
      const med = (k) => median(samples.map((s) => s[k]));
      const row = {
        size,
        mode,
        wireBytes: wire[mode],
        rttP50Ms: med("rttP50"),
        rttP99Ms: med("rttP99"),
        msgsPerSec: med("msgsPerSec"),
        payloadMBps: med("payloadMBps"),
        cpuPubUs: med("cpuPubUs"),
        cpuSubUs: med("cpuSubUs"),
        samples,
      };
      results.push(row);
      console.log(
        `${String(size).padStart(6)} o  ${mode.padEnd(8)}  fil ${String(row.wireBytes).padStart(7)} o` +
          `  rtt p50 ${row.rttP50Ms.toFixed(3)} ms  p99 ${row.rttP99Ms.toFixed(3)} ms` +
          `  ${Math.round(row.msgsPerSec)} msg/s  ${row.payloadMBps.toFixed(1)} Mo/s` +
          `  cpu émetteur ${row.cpuPubUs.toFixed(1)} µs  récepteur ${row.cpuSubUs.toFixed(1)} µs`,
      );
    }
  }
  const file = path.resolve(ROOT, out);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        node: process.version,
        sealed: secret !== null,
        runs,
        pings,
        flood,
        window,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n→ ${path.relative(ROOT, file)}`);
}
