// dev-restart-cycle.mjs — simule un développeur sous le DevSupervisor : modifie un fichier backend,
// chronomètre jusqu'à la remise en écoute, N cycles, médiane. Le fichier est RESTAURÉ à la fin.
// Prérequis : serveur de dev lancé par start.sh (journal /tmp/nodefony-server.log).
// Usage : node dev-restart-cycle.mjs <fichier-backend> [cycles=5]
import { readFileSync, writeFileSync } from "node:fs";
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
      if (count() > before) {
        ready = performance.now() - t0;
        break;
      }
      await sleep(25);
    }
    const tail = strip(readFileSync(LOG, "utf8").slice(logStart));
    const dev = tail
      .split("\n")
      .filter((l) => l.startsWith("[dev]"))
      .map((l) => l.trim());
    results.push(ready);
    console.log(
      `cycle ${i}: port fermé à ${closedAt?.toFixed(0) ?? "?"} ms · port rouvert à ${portAt?.toFixed(0) ?? "?"} ms · ligne « Listen » au journal à ${ready === null ? "TIMEOUT" : `${ready.toFixed(0)} ms`}`,
    );
    for (const l of dev) console.log(`   ${l.slice(0, 140)}`);
    await sleep(4000); // laisser Vite et la santé se poser avant le cycle suivant
  }
} finally {
  writeFileSync(FILE, original);
}
const ok = results.filter((r) => r !== null).sort((a, b) => a - b);
if (ok.length) {
  console.log(
    `\nmédiane ${ok[Math.floor(ok.length / 2)].toFixed(0)} ms · min ${ok[0].toFixed(0)} · max ${ok.at(-1).toFixed(0)} (${ok.length}/${RUNS})`,
  );
}
