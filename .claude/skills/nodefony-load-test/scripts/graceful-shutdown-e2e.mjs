// Banc e2e du GRACEFUL SHUTDOWN (@nodefony/http, trous 1+3 revue 0.7) — sans navigateur.
//
// Prouve le drain bout-en-bout au SIGTERM (= docker stop / éviction k8s) :
//   1. une requête HTTP in-flight (route lente 2 s) se TERMINE (200 complet) ;
//   2. /readyz bascule 503 dès le SIGTERM, AVANT le drain (le LB retire le pod) ;
//   3. une WebSocket ouverte reçoit une frame Close 1001 « Going Away » (pas une
//      coupure TCP 1006) — les serveurs WS ferment AVANT le drain HTTP (prepend) ;
//   4. le process sort et libère les ports (exit 0 côté serveur).
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

// 2) WS ouverte AVANT le SIGTERM — on capture son code de close.
const wsClose = new Promise((res) => {
  const ws = new WebSocket(WS_URL);
  ws.on("close", (code) => res(code));
  ws.on("error", () => res(-1));
});

// 3) Requête lente in-flight (répond après 2 s si non coupée).
await sleep(150); // la WS a le temps de s'ouvrir
const inflight = fetch(HTTP_SLOW_URL)
  .then(async (r) => ({ status: r.status, body: await r.json() }))
  .catch((e) => ({ status: 0, error: String(e?.cause ?? e) }));

// 4) SIGTERM pendant que la requête est en vol.
await sleep(400);
process.kill(pid, "SIGTERM");
console.log(
  `— SIGTERM envoyé à ${pid} (requête in-flight à ~400 ms / 2000 ms)`,
);

// 4b) Bascule readiness (trou 3) : dès le SIGTERM, /readyz doit répondre 503
// (le LB retire le pod) PENDANT que le serveur accepte encore (fenêtre = close
// 1001 des WS ~600 ms + `health.shutdownDelay` éventuel, AVANT le drain HTTP).
await sleep(120);
const readyz = await fetch(`http://127.0.0.1:${PORT}/readyz`)
  .then((r) => r.status)
  .catch(() => 0);
ok(
  readyz === 503,
  `readyz bascule 503 dès le SIGTERM, avant le drain (reçu : ${readyz})`,
);

// 5) Asserts.
const res = await inflight;
ok(
  res.status === 200 && res.body?.aborted === false,
  `in-flight terminée malgré SIGTERM : 200 {"aborted":false} (reçu : ${JSON.stringify(res)})`,
);

const closeCode = await Promise.race([wsClose, sleep(6000).then(() => -2)]);
ok(
  closeCode === 1001,
  `WS fermée proprement 1001 Going Away (reçu : ${closeCode})`,
);

// Le process doit sortir et libérer le port (< shutdownTimeout + marge).
await sleep(3000);
const stillListening = await isPortListening(PORT);
ok(!stillListening, `port :${PORT} libéré (process sorti)`);

console.log(
  fails.length === 0
    ? "\nGRACEFUL SHUTDOWN : PREUVE COMPLÈTE ✓ — relancer le serveur :\n  node node_modules/nodefony/bin/nodefony development --detach --wait 120"
    : `\nÉCHECS (${fails.length}) : ${fails.join(" | ")}`,
);
process.exit(fails.length === 0 ? 0 : 1);
