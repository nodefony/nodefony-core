#!/usr/bin/env node
// Contre-pression WebSocket sur une VRAIE socket — le drop et la fermeture 1013
// se déclenchent-ils aux seuils de `config.backpressure` ?
//
// CE QUE CE BANC PROUVE, et qu'aucun test unitaire ne peut prouver : les tests
// posent `bufferedAmount` à la main, donc ils vérifient la logique du seuil, pas
// la physique du transport. Ici la file est REMPLIE par le noyau — le client
// suspend la lecture de sa socket, la fenêtre TCP se referme, et les octets
// s'accumulent réellement côté serveur.
//
// ── DÉCOR REQUIS (sans lui, le banc ne mesure rien) ──────────────────────────
// 1. Seuils BAS dans la config de l'app, sinon il faudrait pousser 1 MiB pour
//    voir le premier drop :
//        use("@nodefony/realtime", {
//          backpressure: { dropBytes: 65536, closeBytes: 262144 },
//        })
// 2. Endpoint de banc monté :  NF_BENCH_WS_BACKPRESSURE=1
// 3. Serveur démarré AVEC ces deux éléments :
//        NF_BENCH_WS_BACKPRESSURE=1 bash .claude/skills/nodefony-start-server/start.sh
//
// Usage :  node .claude/skills/nodefony-load-test/scripts/ws-backpressure-e2e.mjs
// Options : WS_URL, FRAMES (défaut 400), BYTES (défaut 16384)

import WebSocket from "ws";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || "5152";
const URL =
  process.env.WS_URL ||
  `wss://${HOST}:${PORT}/nodefony/test/bench/backpressure`;
const FRAMES = Number(process.env.FRAMES || 400);
const BYTES = Number(process.env.BYTES || 16384);

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

const ws = new WebSocket(URL, { rejectUnauthorized: false });
let closeCode = null;
let closeReason = "";
ws.on("close", (code, reason) => {
  closeCode = code;
  closeReason = String(reason || "");
});
ws.on("error", (e) => {
  // Une socket fermée par le serveur pendant qu'on n'écoute pas remonte parfois
  // en erreur de lecture : ce n'est pas un échec du banc, c'est le symptôme.
  if (closeCode === null) log(`  (erreur socket : ${e.message})`);
});

await new Promise((res, rej) => {
  ws.once("open", res);
  ws.once("error", rej);
  setTimeout(() => rej(new Error("timeout connexion")), 10000);
});
log(`✓ connecté  ${URL}`);

// Le welcome arrive avant qu'on cesse de lire.
await new Promise((r) => setTimeout(r, 200));

ws.send(
  JSON.stringify({
    jsonrpc: "2.0",
    method: "subscribe",
    params: { channel: "bench:flood" },
  }),
);
await new Promise((r) => setTimeout(r, 200));

// ── LE GESTE CENTRAL : on cesse de drainer ──────────────────────────────────
// La socket brute est mise en pause : le noyau n'acquitte plus, la fenêtre TCP
// se ferme, et `bufferedAmount` monte côté serveur à chaque envoi.
ws._socket.pause();
log("✓ lecture SUSPENDUE côté client (la file serveur va enfler)");

// L'action rend ce que la sonde de cette connexion voit APRÈS la poussée.
// La réponse ne nous parviendra pas (on ne lit plus) : c'est voulu — la preuve
// se lit sur la fermeture, pas sur une réponse qu'un client muet ne peut recevoir.
ws.send(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "bench:flood",
    params: { frames: FRAMES, bytes: BYTES },
  }),
);
log(
  `✓ inondation demandée : ${FRAMES} frames × ${BYTES} o ≈ ${Math.round((FRAMES * BYTES) / 1024)} Kio`,
);

// On laisse le serveur pousser, jeter, puis fermer.
await new Promise((r) => setTimeout(r, 4000));

if (closeCode === null) {
  ws._socket.resume();
  await new Promise((r) => setTimeout(r, 500));
}

log("");
if (closeCode === 1013) {
  log(`✓ CONNEXION FERMÉE 1013 « ${closeReason || "slow consumer"} »`);
  log("  → le seuil closeBytes a mordu sur une socket réelle.");
  process.exit(0);
}
if (closeCode !== null) {
  fail(
    `fermeture ${closeCode} « ${closeReason} » — attendu 1013. ` +
      `Vérifier que la config porte des seuils BAS (voir le décor en tête de fichier).`,
  );
}
fail(
  "aucune fermeture : la file n'a pas atteint closeBytes. Augmenter FRAMES/BYTES, " +
    "ou vérifier que `backpressure` est bien réglé bas ET que l'endpoint de banc est monté " +
    "(NF_BENCH_WS_BACKPRESSURE=1).",
);
