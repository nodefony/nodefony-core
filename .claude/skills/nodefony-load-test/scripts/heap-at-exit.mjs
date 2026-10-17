/**
 * Crochet de banc (`console-boot-bench.mjs`) — chargé par `NODE_OPTIONS=--import=<ce fichier>` dans
 * un processus `nodefony` en boot CONSOLE. À la sortie du processus, force deux
 * collectes (exige `--expose-gc`) puis consigne le tas RETENU et la durée de vie
 * du processus (UNE horloge : `process.uptime()`), une ligne JSON par processus,
 * dans le fichier `NF_BENCH_HEAP_FILE`.
 *
 * Aucun import de `nodefony` ici : importer le paquet depuis ce crochet
 * inscrirait une seconde copie au registre d'instances (garde de dualité).
 */
import fs from "node:fs";

const file = process.env.NF_BENCH_HEAP_FILE;
if (file) {
  process.on("exit", (code) => {
    const gc = globalThis.gc;
    if (typeof gc === "function") {
      gc();
      gc();
    }
    const m = process.memoryUsage();
    const line = JSON.stringify({
      pid: process.pid,
      ppid: process.ppid,
      code,
      gcForced: typeof gc === "function",
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      rss: m.rss,
      external: m.external,
      uptimeMs: Math.round(process.uptime() * 1000),
      argv: process.argv.slice(1, 4),
    });
    try {
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      /* banc best-effort : ne jamais faire échouer le processus mesuré */
    }
  });
}
