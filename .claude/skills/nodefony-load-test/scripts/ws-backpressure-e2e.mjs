#!/usr/bin/env node
// Contre-pression WebSocket SORTANTE (serveur → client) sur une VRAIE socket.
//
// CE QUE CE BANC PROUVE, et qu'aucun test unitaire ne peut prouver : les tests
// posent `bufferedAmount` à la main. Ici la file est remplie par le noyau — le
// client suspend la lecture de sa socket, la fenêtre TCP se referme, les octets
// s'accumulent réellement, et c'est le serveur qui décide.
//
// IL MESURE CÔTÉ SERVEUR (route `/backpressure/probe`), jamais en comptant les
// frames reçues : un client qui n'a pas fini de lire affiche le même déficit
// qu'un client dont les frames ont été jetées. Seul le transport sait ce qu'il
// a refusé — et il faut le lui demander par un AUTRE canal que la socket qu'on
// a justement cessé de drainer.
//
// ── DÉCOR REQUIS ────────────────────────────────────────────────────────────
// Seuils bas sur le serveur WSS (le banc frappe en wss://) — ⚠️ DEUX serveurs,
// DEUX sections de config : `websocket` (ws://5151) et `websocketSecure` (wss://5152) :
//
//     use("@nodefony/http", {
//       websocketSecure: { maxBackpressure: 65536, backpressureCloseAfterDrops: 20 },
//     })
//
// Puis, endpoint de banc monté + volume de rafale :
//     NF_BENCH_WS_BACKPRESSURE=1 NF_BENCH_WS_FRAMES=400 NF_BENCH_WS_BYTES=32768 \
//       bash .claude/skills/nodefony-start-server/start.sh
//
// Usage : node .claude/skills/nodefony-load-test/scripts/ws-backpressure-e2e.mjs

import WebSocket from "ws";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || "5152";
const BASE = `https://${HOST}:${PORT}`;
const URL =
  process.env.WS_URL ||
  `wss://${HOST}:${PORT}/nodefony/test/bench/backpressure`;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // cert de dev auto-signé

const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error(`\n✗ ${m}`);
  process.exit(1);
};

const readProbe = async () => {
  const r = await fetch(`${BASE}/nodefony/test/bench/backpressure/probe`);
  const body = await r.json();
  return body.result ?? body;
};

const ws = new WebSocket(URL, { rejectUnauthorized: false });
let closeCode = null;
ws.on("close", (c) => {
  closeCode = c;
});
ws.on("error", () => {
  /* socket coupée pendant qu'on ne lit pas : c'est le symptôme, pas une panne */
});

await new Promise((res, rej) => {
  ws.once("open", res);
  ws.once("error", rej);
  setTimeout(() => rej(new Error("timeout connexion")), 10000);
});
log(`✓ connecté  ${URL}`);
await new Promise((r) => setTimeout(r, 300));

// ── LE GESTE CENTRAL : cesser de drainer AVANT de déclencher la rafale ───────
ws._socket.pause();
log("✓ lecture SUSPENDUE côté client");

// Le provider part en rafale au 1ᵉʳ abonné : l'abonnement EST le déclencheur.
ws.send(
  JSON.stringify({
    jsonrpc: "2.0",
    method: "subscribe",
    params: { channel: "bench:stream" },
  }),
);
log("✓ abonné — le serveur part en rafale");
await new Promise((r) => setTimeout(r, 3000));

const p = await readProbe();
if (p.absent)
  fail("aucune connexion de banc vue par le serveur — endpoint monté ?");

const opts = p.options ?? {};
log("");
log(
  `   réglages lus par le transport : max=${opts.max} policy=${opts.policy} closeAfterDrops=${opts.closeAfterDrops}`,
);
log(`   charges poussées              : ${p.pushed}`);
log(`   frames servies                : ${p.messagesSent}`);
log(`   frames REFUSÉES               : ${p.dropped}`);
log(
  `   readyState socket             : ${p.readyState} (1=ouverte, 2=fermeture, 3=fermée)`,
);
log("");

if (!opts.max) {
  fail(
    "la protection est DÉSACTIVÉE sur ce serveur (max=0) — configurer " +
      "`websocketSecure.maxBackpressure` (⚠️ pas `websocket`, le banc frappe en wss).",
  );
}
if (p.dropped <= 0) {
  fail(
    "aucune frame refusée : la contre-pression n'a pas mordu. Augmenter le volume de rafale.",
  );
}
log(
  `✓ DROP actif — ${p.dropped} frames refusées, la mémoire du serveur est bornée.`,
);

if (!opts.closeAfterDrops) {
  log(
    "⚠ closeAfterDrops=0 : la fermeture est désactivée, rien de plus à vérifier.",
  );
  process.exit(0);
}
if (p.readyState !== 2 && p.readyState !== 3) {
  fail(
    `la socket est encore OUVERTE après ${p.dropped} refus alors que closeAfterDrops=` +
      `${opts.closeAfterDrops}. Un client qui ne draine plus doit être coupé, sinon il ` +
      "immobilise sa file indéfiniment.",
  );
}
log("✓ FERMETURE déclenchée côté serveur (le client zombie est coupé).");

// Le client ne peut voir le 1013 qu'en redrainant : il était en pause.
ws._socket.resume();
await new Promise((r) => setTimeout(r, 1500));
if (closeCode !== 1013) {
  fail(`le client attendait un close 1013, il a reçu : ${closeCode ?? "rien"}`);
}
log("✓ le client reçoit bien 1013 « Try Again Later » (il sait le retenter).");
process.exit(0);
