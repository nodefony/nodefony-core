/**
 * Preuve « le chat sur deux pods » (ADR-0025, #760 étape 5) : présence, frappe
 * et départs vus d'un pod à l'autre, à travers un VRAI Redis, avec le VRAI
 * client navigateur (`NodefonySocket` de `nodefony/client`, chargé depuis le
 * `dist` de l'application comme le ferait une page).
 *
 *   node presence-pods.mjs [--app appalpha] [--other appbeta]
 *
 * Le script démarre SES pods (ports 5191, 5193, 5195 — hors des 517x de
 * `run.sh` et du Vite du serveur de dev) : il ne tue que des process qu'il a lancés. Tous les délais sont lus
 * sur UNE horloge, celle de ce process (axiome 13).
 *
 * Contrôle négatif : un pod d'une AUTRE application, au secret différent, sur le
 * même Redis — ses connexions ne doivent jamais entrer dans la présence. Sans
 * lui, « 2 présents » pourrait vouloir dire « tout ce qui est branché au bus ».
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  arg,
  arreterPod,
  demarrerPod,
  dormir,
  jusqua,
  rapporteur,
} from "./lib/pod.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const app = path.resolve(here, arg("app", "appalpha"));
const other = path.resolve(here, arg("other", "appbeta"));
const LOBBY = "chat:lobby";
const GRACE_MS = 2000; // celle du canal (references/controller.md)
const FORGET_MS = 15_000; // 3 preuves de vie de 5 s (PRESENCE_INTERVAL_MS)
const redis =
  process.env.NF_REDIS_URL ?? "redis://:nodefony-dev@127.0.0.1:6379";

const { NodefonySocket } = await import(
  pathToFileURL(
    path.join(app, "node_modules/nodefony/dist/client/client/index.js"),
  ).href
);

const r = rapporteur();
// Dernier filet : un rejet oublié ne doit jamais sauter le `finally`.
process.on("unhandledRejection", (e) => {
  console.error("rejet non attrapé :", e);
});
const pods = [];

/** Un pod de l'application `racine`, sur le bus du banc. */
async function pod(
  name,
  port,
  racine = app,
  secret = "bench-secret-0123456789abcdefghij",
) {
  const p = await demarrerPod({
    port,
    racine,
    env: {
      NF_POD_NAME: name,
      NF_REDIS_URL: redis,
      NF_REALTIME_BACKPLANE_SECRET: secret,
    },
  });
  if (!p.debout) {
    console.error(p.journal.join("").slice(-3000));
    throw new Error(`le pod ${name} n'a jamais écouté sur ${port}`);
  }
  pods.push(p);
  return p;
}

/** Un onglet : une socket réelle, abonnée au salon, qui relève ce qu'elle VOIT. */
function tab(port) {
  const socket = new NodefonySocket({
    url: `ws://127.0.0.1:${port}/api/chat/realtime`,
  });
  const seen = { snapshot: null, typing: [] };
  socket.onPresence(LOBBY, (s) => {
    seen.snapshot = s;
  });
  socket.on(LOBBY, (m) => {
    if (typeof m === "object" && m !== null && "typing" in m)
      seen.typing.push(m);
  });
  seen.error = null;
  // Un refus d'ouverture se RELÈVE : non attrapé, il tuerait le banc avant son
  // `finally`, et laisserait ses pods orphelins sur leurs ports.
  socket.connect().catch((e) => {
    seen.error = e instanceof Error ? e.message : String(e);
  });
  socket.subscribe(LOBBY);
  return { socket, seen };
}

/** Présents vus par cet onglet (nommés + anonymes), `-1` tant que rien n'est reçu. */
const total = (t) =>
  t.seen.snapshot?.ready === true
    ? t.seen.snapshot.count + t.seen.snapshot.unnamed
    : -1;

/** Durée jusqu'à ce que l'onglet voie `n` présents (budget `maxMs`), `null` sinon. */
async function timeTo(t, n, maxMs) {
  const t0 = performance.now();
  const ok = await jusqua(async () => total(t) === n, maxMs);
  return ok ? Math.round(performance.now() - t0) : null;
}

try {
  console.log(
    ">>> démarrage de A, B (application témoin) et OTHER (autre secret)…",
  );
  const [podA, ,] = await Promise.all([
    pod("A", 5191),
    pod("B", 5193),
    pod("OTHER", 5195, other, "autre-secret-0123456789abcdefghijk"),
  ]);

  console.log(">>> (a) présence, frappe et départ, d'un pod à l'autre");
  const watcher = tab(5193); // l'onglet qui regarde, sur B
  r.dire(
    (await timeTo(watcher, 1, 10_000)) !== null,
    "B seul : l'onglet se voit seul présent",
  );

  const intruder = tab(5195); // autre application, même Redis
  const x = tab(5191);
  const joined = await timeTo(watcher, 2, 10_000);
  r.dire(joined !== null, `un onglet sur A apparaît sur B (${joined} ms)`);
  await dormir(1500);
  r.dire(
    total(watcher) === 2,
    "l'onglet de l'AUTRE application n'entre pas dans la présence (contrôle négatif)",
  );
  r.dire(
    watcher.seen.snapshot?.partial === false,
    "vue complète (partial: false)",
  );
  intruder.socket.disconnect();

  x.socket.emit("chat:typing", { author: "x" });
  const typed = await jusqua(async () => watcher.seen.typing.length > 0, 5000);
  r.dire(
    typed && watcher.seen.typing[0].from === "A",
    `la frappe émise sur A arrive sur B (${JSON.stringify(watcher.seen.typing[0] ?? null)})`,
  );
  r.dire(total(watcher) === 2, "la frappe ne touche pas la présence");

  // Grâce : un AUTRE onglet tient le canal ouvert sur A, le départ de X est retenu.
  const keeper = tab(5191);
  r.dire(
    (await timeTo(watcher, 3, 10_000)) !== null,
    "un second onglet sur A, vu sur B",
  );
  const t0 = performance.now();
  x.socket.disconnect();
  await dormir(GRACE_MS - 500);
  r.dire(
    total(watcher) === 3,
    `départ retenu pendant la grâce (${GRACE_MS} ms)`,
  );
  const left = await timeTo(watcher, 2, 10_000);
  const leftAt = left === null ? null : Math.round(performance.now() - t0);
  r.dire(
    leftAt !== null && leftAt >= GRACE_MS && leftAt <= GRACE_MS + 2000,
    `onglet fermé sur A : parti de B à ${leftAt} ms (grâce ${GRACE_MS} ms)`,
  );

  // Exception d'ADR-0025 P5 : le DERNIER client d'un pod ferme le canal sur ce
  // pod, sa part locale part à zéro au lot suivant — grâce comprise. Mesurée,
  // pas assertée comme un défaut : c'est la décision écrite.
  const t0b = performance.now();
  keeper.socket.disconnect();
  const lastLeft = await timeTo(watcher, 1, 10_000);
  const lastLeftAt =
    lastLeft === null ? null : Math.round(performance.now() - t0b);
  r.dire(
    lastLeftAt !== null,
    `dernier onglet de A fermé : parti de B à ${lastLeftAt} ms (exception P5 : sans grâce)`,
  );

  console.log(">>> (b) pod arrêté proprement en pleine conversation");
  const y = tab(5191);
  r.dire(
    (await timeTo(watcher, 2, 10_000)) !== null,
    "un onglet sur A, vu sur B",
  );
  const t1 = performance.now();
  const graceful = await arreterPod(podA);
  const goneClean = await timeTo(watcher, 1, FORGET_MS);
  const goneCleanAt =
    goneClean === null ? null : Math.round(performance.now() - t1);
  r.dire(graceful, "A s'est arrêté sur SIGTERM");
  r.dire(
    goneCleanAt !== null && goneCleanAt <= GRACE_MS + 3000,
    `arrêt propre : ses présents partis de B à ${goneCleanAt} ms — annoncé, pas oublié`,
  );
  y.socket.disconnect();

  console.log(">>> (b) pod TUÉ (SIGKILL) en pleine conversation");
  const podA2 = await pod("A", 5191);
  const z = tab(5191);
  r.dire(
    (await timeTo(watcher, 2, 10_000)) !== null,
    "A relancé : un onglet sur A, vu sur B",
  );
  const t2 = performance.now();
  process.kill(podA2.enfant.pid, "SIGKILL");
  await jusqua(async () => podA2.estMort() !== null, 5000);
  // Témoin : aucun oubli prématuré — le pair n'est oublié qu'au délai.
  await dormir(FORGET_MS - 3000);
  r.dire(total(watcher) === 2, `aucun oubli avant ${FORGET_MS - 3000} ms`);
  const killed = await timeTo(watcher, 1, 15_000);
  const killedAt = killed === null ? null : Math.round(performance.now() - t2);
  r.dire(
    killedAt !== null && killedAt <= FORGET_MS + 5000 + GRACE_MS + 1000,
    `pod tué : ses présents oubliés sur B à ${killedAt} ms (délai ${FORGET_MS} ms + tic + grâce)`,
  );
  r.dire(
    watcher.seen.snapshot?.partial === false,
    "vue de B toujours complète après l'oubli",
  );
  z.socket.disconnect();
  watcher.socket.disconnect();
} catch (error) {
  r.dire(
    false,
    `banc interrompu : ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  for (const p of pods) await arreterPod(p);
}
process.exit(r.verdict());
