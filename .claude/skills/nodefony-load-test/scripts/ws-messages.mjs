#!/usr/bin/env node
/**
 * Stress WS — AXE 2 : débit de messages / fan-out broadcast (combien de frames
 * le pipeline encaisse), distinct du nombre de connexions (axe 1 → ws-connections.mjs).
 *
 * Deux modes :
 *   echo       1 socket, paliers de bursts croissants, mesure msg/s + perte.
 *   broadcast  N clients sur /broadcast, chacun émet BURST frames ; chaque frame
 *              est fan-out à TOUS → mesure livraisons reçues vs attendues + perte.
 *
 * À lancer depuis la RACINE du repo :
 *   node .claude/skills/load-test/scripts/ws-messages.mjs
 *   MODE=broadcast CLIENTS=30 node .claude/skills/load-test/scripts/ws-messages.mjs
 *
 * ENV :
 *   MODE        echo | broadcast            (défaut echo)
 *   WS_URL      override cible ; sinon dérivée du MODE (echo→/ws/echo, broadcast→/ws/broadcast)
 *   HOST        base wss                     (défaut wss://127.0.0.1:5152)
 *   BURSTS      paliers echo (CSV)           (défaut 1000,5000,20000,50000,100000,200000)
 *   CLIENTS     nb clients broadcast         (défaut 20)
 *   BURST       frames/client broadcast      (défaut 50)
 *   TIMEOUT_MS  budget par palier            (défaut 60000)
 */
import WebSocket from "ws";

const MODE = process.env.MODE ?? "echo";
const HOST = process.env.HOST ?? "wss://127.0.0.1:5152";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60000);
const wsOpts = { rejectUnauthorized: false };

/** Ouvre 1 WS, résout sur le 1er frame (handshake). */
function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOpts);
    ws.once("error", reject);
    ws.once("message", () => resolve(ws));
  });
}

async function runEcho() {
  const url = process.env.WS_URL ?? `${HOST}/nodefony/test/ws/echo`;
  const bursts = (process.env.BURSTS ?? "1000,5000,20000,50000,100000,200000")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  console.log(
    `\n  WS MESSAGES — echo flood\n  cible=${url}  paliers=${bursts.join(",")}\n`,
  );
  const ws = await open(url);
  let lastRate = 0,
    brokeAt = 0;
  for (const burst of bursts) {
    let received = 0;
    const t0 = Date.now();
    const ok = await new Promise((resolve) => {
      const onMsg = () => {
        if (++received >= burst) {
          ws.removeListener("message", onMsg);
          resolve(true);
        }
      };
      ws.on("message", onMsg);
      for (let i = 0; i < burst; i++) ws.send(`m-${i}`);
      setTimeout(() => {
        ws.removeListener("message", onMsg);
        resolve(received >= burst);
      }, TIMEOUT_MS);
    });
    const rate = (received / (Date.now() - t0)) * 1000;
    console.log(
      `  ▶ burst ${String(burst).padStart(7)} : ${String(received).padStart(7)} reçus @ ${rate.toFixed(0).padStart(6)} msg/s ${ok ? "" : "← SHORTFALL"}`,
    );
    if (!ok) {
      brokeAt = burst;
      break;
    }
    lastRate = rate;
  }
  ws.close();
  console.log(`\n  ── RÉSULTAT ──`);
  console.log(`  dernier débit propre : ${lastRate.toFixed(0)} msg/s`);
  console.log(
    brokeAt
      ? `  rupture au palier    : ${brokeAt}\n`
      : `  aucune perte jusqu'au dernier palier\n`,
  );
}

async function runBroadcast() {
  const url = process.env.WS_URL ?? `${HOST}/nodefony/test/ws/broadcast`;
  const CLIENTS = Number(process.env.CLIENTS ?? 20);
  const BURST = Number(process.env.BURST ?? 50);
  const expectedPerClient = CLIENTS * BURST; // chaque frame fan-out à tous
  console.log(
    `\n  WS MESSAGES — broadcast fan-out\n  cible=${url}  clients=${CLIENTS}  frames/client=${BURST}\n  attendu/client=${expectedPerClient}  livraisons totales=${CLIENTS * expectedPerClient}\n`,
  );

  const clients = await Promise.all(
    Array.from({ length: CLIENTS }, () => open(url)),
  );
  const counts = new Array(CLIENTS).fill(0);
  let total = 0;
  const wantTotal = CLIENTS * expectedPerClient;

  const done = new Promise((resolve) => {
    clients.forEach((ws, idx) =>
      ws.on("message", () => {
        counts[idx]++;
        if (++total >= wantTotal) resolve(true);
      }),
    );
    setTimeout(() => resolve(false), TIMEOUT_MS);
  });

  const t0 = Date.now();
  for (const ws of clients) for (let b = 0; b < BURST; b++) ws.send(`bc-${b}`);
  const ok = await done;
  const dt = Date.now() - t0;
  for (const ws of clients) ws.close();

  const min = Math.min(...counts),
    max = Math.max(...counts);
  const loss = ((wantTotal - total) / wantTotal) * 100;
  console.log(`  ── RÉSULTAT ──`);
  console.log(
    `  livraisons reçues : ${total}/${wantTotal} (${loss <= 0 ? "0" : loss.toFixed(2)}% perte)`,
  );
  console.log(
    `  par client        : min ${min} / max ${max} / attendu ${expectedPerClient}`,
  );
  console.log(
    `  débit fan-out     : ${((total / dt) * 1000).toFixed(0)} livraisons/s`,
  );
  console.log(
    ok
      ? `  ✓ lossless dans le budget\n`
      : `  ← perte/lag (budget ${TIMEOUT_MS}ms dépassé)\n`,
  );
}

(async () => {
  if (MODE === "broadcast") await runBroadcast();
  else await runEcho();
  process.exit(0);
})().catch((e) => {
  console.error("\n  FATAL:", e?.message ?? e);
  process.exit(1);
});
