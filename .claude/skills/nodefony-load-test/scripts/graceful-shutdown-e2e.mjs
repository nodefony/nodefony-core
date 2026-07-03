// Banc e2e du GRACEFUL SHUTDOWN (@nodefony/http, trou 1 revue 0.7) — sans navigateur.
//
// Prouve le drain bout-en-bout au SIGTERM (= docker stop / éviction k8s) :
//   1. une requête HTTP in-flight (route lente 2 s) se TERMINE (200 complet) ;
//   2. une WebSocket ouverte reçoit une frame Close 1001 « Going Away » (pas une
//      coupure TCP 1006) — les serveurs WS ferment AVANT le drain HTTP (prepend) ;
//   3. le process sort et libère les ports (exit 0 côté serveur).
//
// AVANT le fix : `closeAllConnections()` au onTerminate coupait NET les requêtes
// en cours (curl exit 52/56) → requêtes perdues à chaque déploiement/rolling update.
// APRÈS : drain via http-terminator (in-flight terminées, destroy forcé après
// `servers.*.shutdownTimeout` ms, défaut 5000).
//
// ⚠️ Ce banc ARRÊTE le serveur dev (c'est l'objet du test). Le relancer ensuite :
//   bash .claude/skills/nodefony-start-server/start.sh
//
// Prérequis : serveur dev booté (start.sh). Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/graceful-shutdown-e2e.mjs
// Env : HTTP_SLOW_URL (défaut http://127.0.0.1:5151/nodefony/test/abort/wait — répond après 2 s)
//       WS_URL (défaut ws://127.0.0.1:5151/nodefony/test/ws/echo) · PORT (défaut 5151)
import WebSocket from "ws";
import { execSync } from "node:child_process";

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

// 1) PID du serveur = le process qui ÉCOUTE le port (robuste, indépendant de /tmp/srv.pid).
let pid;
try {
  pid = Number(
    execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { encoding: "utf8" })
      .trim()
      .split("\n")[0],
  );
} catch {
  console.error(
    `✗ Aucun process n'écoute sur :${PORT} — booter le serveur d'abord :\n` +
      "  bash .claude/skills/nodefony-start-server/start.sh",
  );
  process.exit(2);
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
let stillListening = true;
try {
  execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { encoding: "utf8" });
} catch {
  stillListening = false;
}
ok(!stillListening, `port :${PORT} libéré (process sorti)`);

console.log(
  fails.length === 0
    ? "\nGRACEFUL SHUTDOWN : PREUVE COMPLÈTE ✓ — relancer le serveur : bash .claude/skills/nodefony-start-server/start.sh"
    : `\nÉCHECS (${fails.length}) : ${fails.join(" | ")}`,
);
process.exit(fails.length === 0 ? 0 : 1);
