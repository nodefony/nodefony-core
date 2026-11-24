// Banc du superviseur RÉEL (ADR-0030 §D3, §D7). Deux rôles, comme
// `nodefony development` : sans NF_DEV_CHILD, ce script EST le superviseur
// (DevSupervisor, ses signaux, ses chemins d'arrêt) ; relancé par lui avec
// NF_DEV_CHILD=1, il joue le serveur enfant. Lancé sous `--import tsx/esm`,
// que le superviseur transmet à son enfant.
//
// argv[2] = { cwd, ports, plan, crashOnce?, lossWitness? } — `crashOnce` :
// chemin d'un témoin ; le PREMIER serveur plante (code 1) dès son plan
// acquitté, et le superviseur le relance (crash rapide), comme après un
// serveur tombé. `lossWitness` : chemin du témoin d'arrêt à la perte du
// superviseur (#908) — le serveur écoute alors `ports[0]`.
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
  if (typeof config.lossWitness === "string") {
    // #908 : le serveur s'arrête à la perte de son superviseur, par la VRAIE
    // fonction du noyau. Il écoute un port, comme un serveur ; son arrêt
    // écrit d'abord (des journaux), attend que l'écriture ait abouti — sur un
    // tube dont le lecteur est mort, c'est là que tombe `EPIPE` —, puis ferme
    // son port et laisse un témoin : la preuve que l'arrêt est allé au bout.
    const { createServer } = await import("node:net");
    const { terminateOnSupervisorLoss } =
      await import("../../../service/dev/devChannel.ts");
    const server = createServer();
    await new Promise((resolve) =>
      server.listen(config.ports[0], "127.0.0.1", resolve),
    );
    let terminating = false;
    terminateOnSupervisorLoss({
      get isTerminating() {
        return terminating;
      },
      async terminate(code) {
        terminating = true;
        for (let i = 0; i < 32; i++) process.stdout.write(`arrêt ${i}\n`);
        await new Promise((resolve) => process.stdout.write("fin\n", resolve));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => server.close(resolve));
        writeFileSync(config.lossWitness, String(code));
        process.exit(code);
      },
    });
  }
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
