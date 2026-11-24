// Banc du superviseur RÉEL (ADR-0030 §D3, §D7). Deux rôles, comme
// `nodefony development` : sans NF_DEV_CHILD, ce script EST le superviseur
// (DevSupervisor, ses signaux, ses chemins d'arrêt) ; relancé par lui avec
// NF_DEV_CHILD=1, il joue le serveur enfant. Lancé sous `--import tsx/esm`,
// que le superviseur transmet à son enfant.
//
// argv[2] = { cwd, ports, plan, crashOnce? } — `crashOnce` : chemin d'un
// témoin ; le PREMIER serveur plante (code 1) dès son plan acquitté, et le
// superviseur le relance (crash rapide), comme après un serveur tombé.
import { existsSync, writeFileSync } from "node:fs";

const config = JSON.parse(process.argv[2]);

if (process.env.NF_DEV_CHILD === "1") {
  // Faux serveur : annonce son PID, envoie le plan, rapporte ce qu'il reçoit —
  // chaque rapport signé de son PID, pour savoir QUEL serveur l'a reçu.
  const report = (event) =>
    process.stdout.write(
      `@@${JSON.stringify({ ...event, from: process.pid })}\n`,
    );
  process.on("message", (message) => {
    if (message?.type === "held-state" || message?.type === "held-plan-ack") {
      report(message);
    }
    if (
      message?.type === "held-plan-ack" &&
      typeof config.crashOnce === "string" &&
      !existsSync(config.crashOnce)
    ) {
      writeFileSync(config.crashOnce, String(process.pid));
      process.exit(1);
    }
  });
  report({ type: "server", pid: process.pid });
  process.send(config.plan);
  setInterval(() => {}, 1_000);
} else {
  const { DevSupervisor } =
    await import("../../../service/dev/DevSupervisor.ts");
  await new DevSupervisor({
    cwd: config.cwd,
    ports: config.ports,
    paths: [],
  }).start();
}
