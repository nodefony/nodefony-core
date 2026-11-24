// Teneur RÉEL (`HostHolder`) qui s'arrête LENTEMENT sur SIGTERM, comme le
// superviseur qui attend la fin d'un build avant d'arrêter ses services portés
// (audit #692, I3). Chaque état publié part sur la sortie standard, une ligne
// JSON : le test y lit si l'hôte a été vu planté pendant l'arrêt.
// Lancé sous `--import tsx/esm` ; argv[2] = dossier de travail de l'hôte.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HostHolder } from "../../../service/dev/HostHolder.ts";

const holder = new HostHolder({
  key: "graceful:ok",
  module: path.join(path.dirname(fileURLToPath(import.meta.url)), "host.mjs"),
  spec: { mode: "ok" },
  cwd: process.argv[2] ?? process.cwd(),
  env: { ...process.env },
  livenessIntervalMs: 0,
  restartBackoffBaseMs: 10,
  restartBackoffMaxMs: 20,
  onStatus: (s) => {
    process.stdout.write(`${JSON.stringify({ state: s.state, pid: s.pid })}\n`);
  },
});

process.on("SIGTERM", () => {
  setTimeout(() => {
    void holder.stop().then(() => process.exit(0));
  }, 800);
});

await holder.start();
setInterval(() => {}, 1_000);
