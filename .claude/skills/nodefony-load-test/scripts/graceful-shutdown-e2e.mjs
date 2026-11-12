// Banc e2e du GRACEFUL SHUTDOWN (@nodefony/http, trous 1+3 revue 0.7) — sans navigateur.
//
// Prouve le drain bout-en-bout au SIGTERM (= docker stop / éviction k8s) :
//   1. une requête HTTP in-flight (route lente 2 s) se TERMINE (200 complet) ;
//   2. /readyz bascule 503 dès le SIGTERM, AVANT le drain (le LB retire le pod) ;
//   3. une WebSocket ouverte reçoit une frame Close 1001 « Going Away » (pas une
//      coupure TCP 1006) — les serveurs WS ferment AVANT le drain HTTP (prepend) ;
//   4. le process sort et libère les ports (exit 0 côté serveur) ;
//   5. les FLUX LONGS reçoivent leur fin AVANT le drain (ADR-0026 D8, #695
//      critères 33 et 58) : un flux SSE et un flux d'octets vivant finissent
//      proprement ; un flux gRPC qui écoute son signal reçoit 14 UNAVAILABLE
//      AVANT le premier GOAWAY de sa session ; un gestionnaire SOURD qui produit
//      reçoit 14 au message suivant ; un sourd ET bloqué tombe au drain ; un
//      unaire en vol finit en 0 ; un unaire plus long que `shutdownTimeout`
//      lit 14 chez grpc-js (le transport, pas Nodefony — connect-node lit 1,
//      écart du client, imprimé sans être exigé).
//
// AVANT le fix : `closeAllConnections()` au onTerminate coupait NET les requêtes
// en cours (curl exit 52/56) → requêtes perdues à chaque déploiement/rolling update.
// APRÈS : drain via http-terminator (in-flight terminées, destroy forcé après
// `servers.*.shutdownTimeout` ms, défaut 5000).
//
// ⚠️ Ce banc ARRÊTE le serveur dev (c'est l'objet du test). Le relancer ensuite :
//   node node_modules/nodefony/bin/nodefony development --detach --wait 120
// (`start.sh` fait la même chose avec le confort du poste, mais il est POSIX : le
// nommer SEUL laissait un lecteur sous Windows sans commande.)
//
// Prérequis : serveur dev booté. Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/graceful-shutdown-e2e.mjs
// Env : HTTP_SLOW_URL (défaut http://127.0.0.1:5151/nodefony/test/abort/wait — répond après 2 s)
//       WS_URL (défaut ws://127.0.0.1:5151/nodefony/test/ws/echo) · PORT (défaut 5151)
//       H2C_URL (défaut http://127.0.0.1:5153 — h2c, hors production)
// Le banc lit le contrat gRPC BÂTI du module `test` (`src/modules/test/dist`).
import http2 from "node:http2";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Code, createClient, ConnectError } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import WebSocket from "ws";
// Le produit répond DÉJÀ aux deux questions de ce banc — qui écoute, et le port
// est-il rendu. Les redemander à `lsof` était la faute que le dépôt a déjà payée
// ailleurs : l'outil n'existe pas sous Windows, la sonde rendait « aucun process
// n'écoute sur :5151 » pendant que le serveur écoutait, et le banc accusait le
// drain d'un défaut qui était le sien.
import { readRuntimeState, isPortListening } from "nodefony";

const PORT = Number(process.env.PORT ?? 5151);
const HTTP_SLOW_URL =
  process.env.HTTP_SLOW_URL ??
  `http://127.0.0.1:${PORT}/nodefony/test/abort/wait`;
const WS_URL =
  process.env.WS_URL ?? `ws://127.0.0.1:${PORT}/nodefony/test/ws/echo`;
const H2C_URL = process.env.H2C_URL ?? "http://127.0.0.1:5153";
const TEST_MODULE = path.join(process.cwd(), "src", "modules", "test");

const fails = [];
const ok = (cond, msg) => {
  if (cond) {
    console.log(`✓ ${msg}`);
  } else {
    fails.push(msg);
    console.error(`✗ ${msg}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) PID du serveur = celui que le runtime PUBLIE sur lui-même une fois en écoute
// (`node_modules/.cache/nodefony/runtime.json`). C'est le canal du framework, pas une
// observation de l'OS : il porte le PID de qui écoute, il est déjà purgé quand le
// process est mort, et il répond à l'identique sur les trois systèmes.
const runtime = readRuntimeState(process.cwd());
if (!runtime || runtime.pid <= 0) {
  console.error(
    `✗ Aucun runtime Nodefony publié sous ${process.cwd()} — booter le serveur d'abord :\n` +
      "  node node_modules/nodefony/bin/nodefony development --detach --wait 120",
  );
  process.exit(2);
}
const pid = runtime.pid;
// Le banc frappe le port qu'on lui donne ; le runtime dit celui qu'il SERT. Les voir
// diverger (`servers.portPolicy: "auto"` a décalé) explique un banc qui tape dans le
// vide — le taire ferait accuser le drain.
if (!runtime.ports.includes(PORT)) {
  console.warn(
    `⚠ le runtime écoute sur [${runtime.ports.join(", ")}], le banc vise :${PORT}`,
  );
}
console.log(`— serveur PID=${pid} sur :${PORT}`);

// 2) Le STIMULUS existe-t-il sur cette plateforme ?
//
// Windows n'a pas les signaux POSIX : Node y implémente `process.kill(pid, …)` par
// `TerminateProcess`, qui tue SANS que le process reçoive quoi que ce soit. Aucun
// handler ne s'exécute, donc aucun drain n'est possible — et le banc mesurait alors
// trois « échecs » (readyz injoignable, in-flight ECONNRESET, WebSocket 1006) qui
// décrivaient la plateforme, jamais le produit. Mesuré : le serveur mourait 124 ms
// après le signal, quand le drain seul dure 2 s.
//
// Ce n'est PAS un `skipIf` de confort : c'est l'axiome « aucun arrêt gracieux d'arbre
// sous Windows » ÉNONCÉ plutôt que masqué derrière un SIGTERM qui n'en a que le nom.
// Ce qui reste prouvable là-bas l'est — le process meurt et rend ses ports.
//
// Le chemin de l'utilisateur, lui, fonctionne : un Ctrl+C dans la console Windows
// délivre bien SIGINT à Node. C'est l'envoi depuis un AUTRE process qui n'existe pas.
const signauxDelivres = process.platform !== "win32";
if (!signauxDelivres) {
  console.log(
    "⚠ PREUVE DU DRAIN NON MENÉE — cette plateforme ne délivre pas les signaux à un\n" +
      "  process tiers (`TerminateProcess`). Reste éprouvé ci-dessous : le process meurt\n" +
      "  et libère ses ports. Le drain lui-même se prouve sur linux et macOS.",
  );
}

// 3) WS ouverte AVANT le SIGTERM — on capture son code de close.
const wsClose = new Promise((res) => {
  const ws = new WebSocket(WS_URL);
  ws.on("close", (code) => res(code));
  ws.on("error", () => res(-1));
});

// 3b) Flux longs ouverts AVANT le SIGTERM (ADR-0026 D8). Chacun rend ce que
// son client a lu, et QUAND, sur l'horloge de ce process.
const { EchoService } = await import(
  pathToFileURL(
    path.join(
      TEST_MODULE,
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
const echo = createClient(
  EchoService,
  createGrpcTransport({ baseUrl: H2C_URL }),
);
const grpcCode = (e) =>
  e instanceof ConnectError ? e.code : `${e?.cause ?? e}`;
const settle = (promise) =>
  promise.then(
    (value) => ({ value, at: performance.now() }),
    (error) => ({ error, at: performance.now() }),
  );

// Flux qui ÉCOUTE son signal, sur une session HTTP/2 nue : ses trailers et le
// GOAWAY de la session se lisent sur la même horloge.
const raw = { trailers: null, trailersAt: 0, goawayAt: 0 };
const rawSession = http2.connect(H2C_URL);
rawSession.on("error", () => {});
rawSession.on("goaway", () => {
  raw.goawayAt ||= performance.now();
});
const rawStream = rawSession.request({
  ":method": "POST",
  ":path": "/nodefony.test.v1.EchoService/Watch",
  "content-type": "application/grpc",
  te: "trailers",
});
rawStream.on("trailers", (headers) => {
  raw.trailers = headers["grpc-status"] ?? null;
  raw.trailersAt = performance.now();
});
rawStream.on("data", () => {});
rawStream.on("error", () => {});
rawStream.end(Buffer.from([0, 0, 0, 0, 0])); // WatchRequest vide, muet

const readAll = async (iterable) => {
  let n = 0;
  for await (const _ of iterable) n++;
  return n;
};
const deafProducer = settle(
  readAll(echo.watch({ follow: true, intervalMs: 50 })),
);
const deafBlocked = settle(
  readAll(
    // Un client qui n'envoie jamais rien : le gestionnaire reste bloqué.
    echo.converse(
      (async function* idle() {
        await new Promise(() => {});
        yield* []; // jamais atteint : la requête reste ouverte, vide
      })(),
    ),
  ),
);
const sseHold = settle(
  fetch(`http://127.0.0.1:${PORT}/nodefony/test/sse/hold`).then((r) =>
    r.text(),
  ),
);
const bytesHold = settle(
  fetch(`http://127.0.0.1:${PORT}/nodefony/test/stream/hold`).then((r) =>
    r.text(),
  ),
);
// Unaire plus long que `shutdownTimeout` (critère 58), chez deux clients.
const blockedConnect = settle(
  echo.stall({ block: true, witness: "graceful-connect" }),
);
const echoJs = (() => {
  const definition = protoLoader.loadSync(
    path.join("nodefony", "test", "v1", "echo.proto"),
    {
      includeDirs: [path.join(TEST_MODULE, "proto")],
    },
  );
  const loaded = grpc.loadPackageDefinition(definition);
  return new loaded.nodefony.test.v1.EchoService(
    new URL(H2C_URL).host,
    grpc.credentials.createInsecure(),
  );
})();
const blockedGrpcJs = settle(
  new Promise((resolve, reject) =>
    echoJs.Stall({ block: true, witness: "graceful-grpc-js" }, (err, res) =>
      err
        ? reject(err instanceof Error ? err : new Error(String(err)))
        : resolve(res),
    ),
  ),
);

// 4) Requête lente in-flight (répond après 2 s si non coupée).
await sleep(150); // la WS a le temps de s'ouvrir
const inflight = fetch(HTTP_SLOW_URL)
  .then(async (r) => ({ status: r.status, body: await r.json() }))
  .catch((/** @type {unknown} */ e) => ({
    status: 0,
    error: String(e?.cause ?? e),
  }));

// Unaire en vol au SIGTERM, plus court que le drain : il doit finir en 0.
const unaryInFlight = settle(echo.stall({ delayMs: 1200 }));

// 5) SIGTERM pendant que la requête est en vol.
await sleep(400);
process.kill(pid, "SIGTERM");
console.log(
  `— SIGTERM envoyé à ${pid} (requête in-flight à ~400 ms / 2000 ms)`,
);

// 5b) Bascule readiness (trou 3) : dès le SIGTERM, /readyz doit répondre 503
// (le répartiteur retire le pod) PENDANT que le serveur sert encore.
//
// ⚠️ Ce que ce cas prouve est un ORDRE, pas un délai. Il attendait 120 ms fixes
// puis interrogeait une fois — ce qui ne mesurait que la machine : sur un
// exécuteur macOS partagé, `/readyz` rendait encore 200 à 287 ms alors que le
// drain était PARFAIT par ailleurs (in-flight terminée, WebSocket en 1001, port
// rendu). Un rouge qui n'accusait que la contention du moment.
//
// La bascule est donc SONDÉE jusqu'à ce qu'elle survienne, et ce qu'on exige est
// qu'elle survienne AVANT la fin du drain — deux instants lus sur la MÊME
// horloge, dans le MÊME process. Le seuil n'est pas relâché : il est remplacé
// par le fait qu'il cherchait à approcher.
const repere = performance.now();
let finDuDrain = 0;
void inflight.then(() => {
  finDuDrain = performance.now();
});

let basculeA = 0;
let readyz = 0;
while (performance.now() - repere < 8000) {
  readyz = await fetch(`http://127.0.0.1:${PORT}/readyz`)
    .then((r) => r.status)
    .catch(() => 0);
  if (readyz === 503) {
    basculeA = performance.now();
    break;
  }
  // Le serveur est parti : plus rien à observer, la bascule n'aura pas lieu.
  if (readyz === 0 && finDuDrain) break;
  await sleep(25);
}

if (signauxDelivres) {
  ok(
    basculeA > 0,
    `readyz bascule en 503 après le SIGTERM (dernier code observé : ${readyz})`,
  );
  ok(
    basculeA > 0 && (finDuDrain === 0 || basculeA <= finDuDrain),
    `readyz bascule AVANT la fin du drain (bascule à ${(basculeA - repere).toFixed(0)} ms, ` +
      `drain ${finDuDrain ? `fini à ${(finDuDrain - repere).toFixed(0)} ms` : "encore en cours"})`,
  );
}

// 6) Asserts.
const res = await inflight;
const closeCode = await Promise.race([wsClose, sleep(6000).then(() => -2)]);
if (signauxDelivres) {
  ok(
    res.status === 200 && res.body?.aborted === false,
    `in-flight terminée malgré SIGTERM : 200 {"aborted":false} (reçu : ${JSON.stringify(res)})`,
  );
  ok(
    closeCode === 1001,
    `WS fermée proprement 1001 Going Away (reçu : ${closeCode})`,
  );
} else {
  // On les IMPRIME quand même : le jour où une plateforme se met à délivrer le
  // signal, ces deux lignes sont le premier endroit où ça se verra.
  console.log(
    `— sans signal délivré : in-flight ${JSON.stringify(res)} · WS close ${closeCode}`,
  );
}

// 6b) Flux longs (ADR-0026 D8, critères 33 et 58).
const killedAt = repere;
const all = await Promise.race([
  Promise.all([
    deafProducer,
    deafBlocked,
    sseHold,
    bytesHold,
    blockedConnect,
    blockedGrpcJs,
    unaryInFlight,
  ]),
  sleep(15_000).then(() => null),
]);
if (signauxDelivres) {
  ok(all !== null, "flux longs : tous terminés en moins de 15 s");
}
if (signauxDelivres && all !== null) {
  const [producer, blocked, sse, bytes, unaryConnect, unaryJs, inFlight] = all;
  const ms = (r) => `${Math.round(r.at - killedAt)} ms`;
  ok(
    raw.trailers === "14" &&
      raw.trailersAt > 0 &&
      (raw.goawayAt === 0 || raw.trailersAt < raw.goawayAt),
    `gRPC qui écoute : 14 AVANT le GOAWAY (trailers ${raw.trailers} à ${Math.round(raw.trailersAt - killedAt)} ms, ` +
      `GOAWAY ${raw.goawayAt ? `à ${Math.round(raw.goawayAt - killedAt)} ms` : "non vu"})`,
  );
  ok(
    grpcCode(producer.error) === Code.Unavailable,
    `gRPC sourd qui produit : 14 (reçu : ${producer.error ? grpcCode(producer.error) : "fin OK"}, ${ms(producer)})`,
  );
  ok(
    blocked.error !== undefined && blocked.at - killedAt > 1000,
    `gRPC sourd et bloqué : coupé au drain (${blocked.error ? grpcCode(blocked.error) : "fin OK"}, ${ms(blocked)})`,
  );
  ok(
    sse.error === undefined,
    `SSE : fin propre (${sse.error ?? "ok"}, ${ms(sse)})`,
  );
  ok(
    bytes.error === undefined,
    `flux d'octets vivant : fin propre (${bytes.error ?? "ok"}, ${ms(bytes)})`,
  );
  ok(
    inFlight.error === undefined,
    `unaire en vol : fini en 0 (${inFlight.error ? grpcCode(inFlight.error) : "OK"}, ${ms(inFlight)})`,
  );
  ok(
    unaryJs.error?.code === 14,
    `unaire plus long que le drain, grpc-js : 14 (reçu : ${unaryJs.error?.code ?? "OK"}, ${ms(unaryJs)})`,
  );
  // Écart du CLIENT connect-node (session détruite lue en CANCEL) : imprimé,
  // pas exigé — le jour où il lit 14, c'est ici que ça se verra.
  console.log(
    `— unaire plus long que le drain, connect-node : ${unaryConnect.error ? grpcCode(unaryConnect.error) : "OK"} (${ms(unaryConnect)})`,
  );
}
rawSession.destroy();
echoJs.close();

// Le process doit sortir et libérer le port (< shutdownTimeout + marge).
await sleep(3000);
const stillListening = await isPortListening(PORT);
ok(!stillListening, `port :${PORT} libéré (process sorti)`);

console.log(
  fails.length === 0
    ? `\nGRACEFUL SHUTDOWN : ${signauxDelivres ? "PREUVE COMPLÈTE ✓" : "arrêt et libération des ports ✓ (drain NON éprouvé ici)"} — relancer le serveur :\n  node node_modules/nodefony/bin/nodefony development --detach --wait 120`
    : `\nÉCHECS (${fails.length}) : ${fails.join(" | ")}`,
);
process.exit(fails.length === 0 ? 0 : 1);
