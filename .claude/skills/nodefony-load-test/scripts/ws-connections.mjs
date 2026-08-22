#!/usr/bin/env node
/**
 * Stress WS — AXE 1 : nombre de connexions simultanées (combien de sockets un
 * process tient), distinct du débit messages (axe 2 → ws-messages.mjs).
 *
 * Rampe des connexions par batches jusqu'au 1er batch qui ne s'ouvre pas
 * entièrement (= plafond) ou jusqu'au CAP, puis ferme tout proprement.
 * Rapporte : plafond atteint, delta heap serveur (si sonde dispo), durée.
 *
 * À lancer depuis la RACINE du repo (résout `ws` via node_modules hoisté) :
 *   node .claude/skills/load-test/scripts/ws-connections.mjs
 *   CAP=4000 STEP=500 node .claude/skills/load-test/scripts/ws-connections.mjs
 *
 * ENV (toutes optionnelles) :
 *   WS_URL    cible WS                 (défaut wss://127.0.0.1:5152/nodefony/test/ws/echo)
 *   CAP       plafond dur de sécurité  (défaut 8000 — sous les ~16k ports éphémères loopback)
 *   STEP      taille d'un palier       (défaut 250)
 *   BATCH     opens concurrents/sous-lot (défaut 50 — >100 d'un coup = AggregateError TLS loopback)
 *   HOLD_MS   maintien au pic avant close (défaut 0)
 *   HEAP_URL  sonde heap serveur (GET → {heapUsed}) (défaut https://127.0.0.1:5152/nodefony/test/memory)
 */
import WebSocket from "ws";
import https from "node:https";
import http from "node:http";

const WS_URL =
  process.env.WS_URL ?? "wss://127.0.0.1:5152/nodefony/test/ws/echo";
const CAP = Number(process.env.CAP ?? 8000);
const STEP = Number(process.env.STEP ?? 250);
const BATCH = Number(process.env.BATCH ?? 50);
const HOLD_MS = Number(process.env.HOLD_MS ?? 0);
const HEAP_URL =
  process.env.HEAP_URL ?? "https://127.0.0.1:5152/nodefony/test/memory";
const wsOpts = { rejectUnauthorized: false };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON sur HEAP_URL → heapUsed (octets), ou null si indisponible. */
function serverHeap() {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(HEAP_URL);
    } catch {
      return resolve(null);
    }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(
              JSON.parse(Buffer.concat(chunks).toString()).heapUsed ?? null,
            );
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

/** Ouvre 1 WS, résout sur le 1er frame reçu (handshake echo) ; rejette sur erreur. */
function openHandshaked() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, wsOpts);
    const onErr = (e) => {
      cleanup();
      reject(e);
    };
    const onMsg = () => {
      cleanup();
      resolve(ws);
    };
    const cleanup = () => {
      ws.removeListener("error", onErr);
      ws.removeListener("message", onMsg);
    };
    ws.once("error", onErr);
    ws.once("message", onMsg);
  });
}

/** Ferme proprement toutes les sockets (attend "close", backstop 8 s). */
function closeAll(sockets) {
  return new Promise((resolve) => {
    let pending = sockets.length;
    if (!pending) return resolve();
    for (const ws of sockets) {
      const done = () => {
        if (--pending === 0) resolve();
      };
      if (ws.readyState === WebSocket.CLOSED) {
        done();
        continue;
      }
      ws.once("close", done);
      try {
        ws.close();
      } catch {
        done();
      }
    }
    setTimeout(resolve, 8000);
  });
}

async function main() {
  console.log(`\n  WS CONNECTIONS — axe 1 (plafond connexions)`);
  console.log(`  cible=${WS_URL}  CAP=${CAP}  STEP=${STEP}  BATCH=${BATCH}`);
  const heap0 = await serverHeap();
  const live = [];
  let ceiling = 0;
  const t0 = Date.now();

  try {
    while (live.length < CAP) {
      const want = Math.min(STEP, CAP - live.length);
      let openedInStep = 0;
      for (let i = 0; i < want; i += BATCH) {
        const size = Math.min(BATCH, want - i);
        const res = await Promise.allSettled(
          Array.from({ length: size }, () => openHandshaked()),
        );
        for (const r of res)
          if (r.status === "fulfilled") {
            live.push(r.value);
            openedInStep++;
          }
        await wait(10);
      }
      ceiling = live.length;
      process.stdout.write(`\r  ▶ ouvertes: ${ceiling}   `);
      if (openedInStep < want) break; // 1er palier incomplet = plafond
    }
  } finally {
    const heapPeak = await serverHeap();
    if (HOLD_MS) {
      console.log(`\n  maintien ${HOLD_MS}ms au pic…`);
      await wait(HOLD_MS);
    }
    console.log(`\n\n  ── RÉSULTAT ──`);
    console.log(`  plafond           : ${ceiling} connexions simultanées`);
    if (heap0 != null && heapPeak != null) {
      console.log(
        `  heap serveur      : ${(heap0 / 1048576).toFixed(1)} → ${(heapPeak / 1048576).toFixed(1)} MB (Δ ${((heapPeak - heap0) / 1048576).toFixed(1)} MB)`,
      );
      console.log(
        `  coût/connexion    : ~${((heapPeak - heap0) / Math.max(ceiling, 1) / 1024).toFixed(2)} KB`,
      );
    }
    console.log(
      `  durée             : ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    console.log(`  fermeture des ${live.length} sockets…`);
    await closeAll(live);
    await wait(500);
    const heapEnd = await serverHeap();
    if (heap0 != null && heapEnd != null) {
      console.log(
        `  heap après close  : ${(heapEnd / 1048576).toFixed(1)} MB (Δ vs début ${((heapEnd - heap0) / 1048576).toFixed(1)} MB → doit retomber)`,
      );
    }
    console.log("");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  FATAL:", e?.message ?? e);
  process.exit(1);
});
