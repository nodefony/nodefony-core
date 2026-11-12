// Banc #695 critère 34 (ADR-0026 D8) — le coût d'un appel gRPC UNAIRE ne doit
// pas dépendre du nombre de flux longs ouverts sur le serveur.
//
// Pourquoi : Connect lie un écouteur par appel à son `shutdownSignal`, et
// l'ajout/retrait d'un écouteur sur un `AbortSignal` parcourt ceux déjà posés —
// mesuré +122 µs par appel à 10 000 appels ouverts. Nodefony ne l'emploie pas :
// ses flux longs entrent dans un registre du noyau (`ShutdownRegistry`) que
// l'unaire ne touche pas. Ce banc le vérifie de bout en bout.
//
// Méthode : pour chaque palier N, N flux `Watch` muets sont ouverts (h2c, une
// session par 100 flux), puis `CALLS` unaires `Say` en série sont chronométrés
// côté client ; médiane des `PASSES` passes. Les paliers sont joués dans l'ordre
// 0 → max → 0 : un second 0 qui dérive accuse le décor, pas le registre.
//
// Prérequis : serveur de dev démarré SANS superviseur (une recompilation en
// cours de mesure fausserait tout) :
//   node node_modules/nodefony/bin/nodefony development --no-watch --detach --wait 120
// Lancement (racine du dépôt) :
//   node .claude/skills/nodefony-load-test/scripts/grpc-unary-vs-open-streams.mjs
// Env : H2C_URL (défaut http://127.0.0.1:5153) · STEPS (défaut 0,1000,10000,0)
//       CALLS (défaut 2000) · PASSES (défaut 7) · OUT (défaut tmp/bench/grpc-unary-vs-open-streams.json)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

const H2C_URL = process.env.H2C_URL ?? "http://127.0.0.1:5153";
// Sonde du module `test` : portées de requête ouvertes = flux réellement
// arrivés au serveur (un flux ouvert porte la sienne jusqu'à sa fin).
const SCOPES_URL =
  process.env.SCOPES_URL ??
  "http://127.0.0.1:5151/nodefony/test/als-test/scopes";
const STEPS = (process.env.STEPS ?? "0,1000,10000,0").split(",").map(Number);
const CALLS = Number(process.env.CALLS ?? 2000);
const PASSES = Number(process.env.PASSES ?? 7);
// Le serveur annonce SETTINGS_MAX_CONCURRENT_STREAMS = 100 : au-delà, le client
// met les flux en file sans les ouvrir (constaté : 100 sur 1 000).
const STREAMS_PER_SESSION = 100;
const OUT =
  process.env.OUT ??
  path.join("tmp", "bench", "grpc-unary-vs-open-streams.json");

const { EchoService } = await import(
  pathToFileURL(
    path.join(
      process.cwd(),
      "src",
      "modules",
      "test",
      "dist",
      "nodefony",
      "gen",
      "nodefony",
      "test",
      "v1",
      "echo_pb.js",
    ),
  ).href
);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

/** Ouvre `count` flux muets ; rend de quoi les fermer. */
async function openStreams(count) {
  const controllers = [];
  const transports = [];
  for (let opened = 0; opened < count; opened += STREAMS_PER_SESSION) {
    const transport = createGrpcTransport({ baseUrl: H2C_URL });
    transports.push(transport);
    const client = createClient(EchoService, transport);
    const batch = Math.min(STREAMS_PER_SESSION, count - opened);
    for (let i = 0; i < batch; i++) {
      const controller = new AbortController();
      controllers.push(controller);
      // Le flux reste ouvert jusqu'à l'annulation ; la première lecture
      // n'arrive jamais (muet), on n'attend pas.
      (async () => {
        for await (const _ of client.watch(
          { follow: false },
          { signal: controller.signal },
        )) {
          // muet
        }
      })().catch(() => {});
    }
  }
  return () => {
    for (const c of controllers) c.abort();
  };
}

async function measure() {
  const client = createClient(
    EchoService,
    createGrpcTransport({ baseUrl: H2C_URL }),
  );
  for (let i = 0; i < 200; i++) await client.say({ sentence: "chauffe" });
  const perCall = [];
  for (let pass = 0; pass < PASSES; pass++) {
    const start = performance.now();
    for (let i = 0; i < CALLS; i++) await client.say({ sentence: "x" });
    perCall.push(((performance.now() - start) * 1000) / CALLS); // µs par appel
  }
  return { medianUs: median(perCall), passesUs: perCall };
}

const rows = [];
for (const n of STEPS) {
  const close = await openStreams(n);
  // Les flux doivent être ARRIVÉS au serveur avant la mesure : on le CONSTATE.
  let open = 0;
  for (let i = 0; i < 120; i++) {
    open = await fetch(SCOPES_URL)
      .then((r) => r.json())
      .then((j) => j.requestScopes - 1) // la sonde compte sa propre requête
      .catch(() => -1);
    if (open >= n) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (open < n) {
    console.error(
      `✗ ${n} flux demandés, ${open} ouverts côté serveur — mesure abandonnée`,
    );
    process.exit(1);
  }
  const result = await measure();
  rows.push({ openStreams: n, serverOpen: open, ...result });
  console.log(
    `${String(n).padStart(6)} flux ouverts (${open} au serveur) : ${result.medianUs.toFixed(1)} µs/appel unaire (médiane de ${PASSES} × ${CALLS})`,
  );
  close();
  await new Promise((r) => setTimeout(r, 1000));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ steps: STEPS, calls: CALLS, passes: PASSES, rows }, null, 2),
);
console.log(`→ ${OUT}`);
process.exit(0);
