// dev-restart-cycle.mjs — simule un développeur sous le DevSupervisor : modifie un fichier backend,
// chronomètre jusqu'à la remise en écoute, N cycles, médiane. Le fichier est RESTAURÉ à la fin.
// Prérequis : serveur de dev lancé par start.sh (journal /tmp/nodefony-server.log).
// Usage : node dev-restart-cycle.mjs <fichier-backend> [cycles=5]
// NF_DEV_CYCLE_FRONT=default,vue,angular → chronomètre AUSSI le retour du FRONT : l'instant où le
// relais `/_vite/<famille>/@vite/client` du serveur RELANCÉ rend 200 pour chaque famille. C'est
// la mesure qui voit Vite : la ligne « Listen » part avant que Vite, tenu par le serveur, ne soit
// prêt (#692).
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { performance } from "node:perf_hooks";
import { connect } from "node:net";

// La remise en écoute se CONSTATE sur le port (le journal peut écrire ses lignes en lot, en retard).
const PORT = Number(process.env.NF_DEV_CYCLE_PORT ?? 5151);
const portOpen = () =>
  new Promise((r) => {
    const s = connect(PORT, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      r(true);
    });
    s.once("error", () => r(false));
  });

const FRONT = (process.env.NF_DEV_CYCLE_FRONT ?? "")
  .split(",")
  .filter((f) => f.length > 0);
const HTTPS_PORT = Number(process.env.NF_DEV_CYCLE_HTTPS_PORT ?? 5152);
/** Statut du relais Vite d'une famille ; 0 si la requête échoue. */
const viteStatus = (family) =>
  new Promise((r) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: HTTPS_PORT,
        path: `/_vite/${family}/@vite/client`,
        rejectUnauthorized: false,
        agent: false,
      },
      (res) => {
        res.resume();
        r(res.statusCode ?? 0);
      },
    );
    req.setTimeout(2_000, () => req.destroy());
    req.once("error", () => r(0));
    req.end();
  });

const FILE = process.argv[2];
if (!FILE) {
  console.error(
    "usage : node dev-restart-cycle.mjs <fichier-backend> [cycles=5]",
  );
  process.exit(64);
}
const RUNS = Number(process.argv[3] ?? 5);
const LOG = "/tmp/nodefony-server.log";
const READY = /Server Listen on http/g;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const count = () =>
  (strip(readFileSync(LOG, "utf8")).match(READY) ?? []).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {string} */
const original = readFileSync(FILE, "utf8");
const results = [];
const fronts = [];
try {
  for (let i = 1; i <= RUNS; i++) {
    const before = count();
    const logStart = readFileSync(LOG, "utf8").length;
    const t0 = performance.now();
    writeFileSync(
      FILE,
      `${original}\n// watch-cycle ${String(i)} ${String(Date.now())}\n`,
    );
    let ready = null;
    let closedAt = null;
    let portAt = null;
    while (performance.now() - t0 < 60_000) {
      const open = await portOpen();
      if (!open && closedAt === null) closedAt = performance.now() - t0;
      if (open && closedAt !== null && portAt === null)
        portAt = performance.now() - t0;
      // Seulement APRÈS la fermeture constatée du port : la ligne du démarrage
      // précédent, écrite en retard dans le journal, se lisait sinon comme le
      // retour du serveur relancé (vécu : « Listen » à 845 ms au cycle 1).
      if (closedAt !== null && count() > before) {
        ready = performance.now() - t0;
        break;
      }
      await sleep(25);
    }
    // Le front : seulement après la ligne « Listen » du serveur RELANCÉ — avant elle,
    // c'est encore l'ancien serveur qui répond.
    let frontAt = null;
    if (FRONT.length > 0 && ready !== null) {
      const pending = new Set(FRONT);
      while (pending.size > 0 && performance.now() - t0 < 60_000) {
        for (const f of pending)
          if ((await viteStatus(f)) === 200) pending.delete(f);
        if (pending.size > 0) await sleep(25);
      }
      if (pending.size === 0) frontAt = performance.now() - t0;
    }
    fronts.push(frontAt);
    const tail = strip(readFileSync(LOG, "utf8").slice(logStart));
    const dev = tail
      .split("\n")
      .filter((l) => l.startsWith("[dev]"))
      .map((l) => l.trim());
    results.push(ready);
    console.log(
      `cycle ${i}: port fermé à ${closedAt?.toFixed(0) ?? "?"} ms · port rouvert à ${portAt?.toFixed(0) ?? "?"} ms · ligne « Listen » au journal à ${ready === null ? "TIMEOUT" : `${ready.toFixed(0)} ms`}${FRONT.length > 0 ? ` · front prêt à ${frontAt === null ? "TIMEOUT" : `${frontAt.toFixed(0)} ms`}` : ""}`,
    );
    for (const l of dev) console.log(`   ${l.slice(0, 140)}`);
    await sleep(4000); // laisser Vite et la santé se poser avant le cycle suivant
  }
} finally {
  writeFileSync(FILE, original);
}
/** Médiane, min et max d'une série ; les cycles en échec sont comptés à part. */
const summary = (label, series) => {
  const ok = series.filter((r) => r !== null).sort((a, b) => a - b);
  if (ok.length === 0) {
    console.log(`\n${label} : aucune mesure (0/${RUNS})`);
    return false;
  }
  console.log(
    `\n${label} : médiane ${ok[Math.floor(ok.length / 2)].toFixed(0)} ms · min ${ok[0].toFixed(0)} · max ${ok.at(-1).toFixed(0)} (${ok.length}/${RUNS})`,
  );
  return ok.length === RUNS;
};
const listenOk = summary("serveur (« Listen »)", results);
const frontOk =
  FRONT.length === 0 || summary(`front (${FRONT.join(", ")})`, fronts);
// Un banc qui n'a pas tout mesuré ne sort pas en 0.
if (!listenOk || !frontOk) process.exitCode = 1;
