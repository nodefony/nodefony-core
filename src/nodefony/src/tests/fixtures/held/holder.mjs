// Teneur MINIMAL (ADR-0030 §D6, « superviseur tué net ») : lance l'hôte de
// fixture dans son propre groupe, comme le fait le teneur réel, et écrit son
// PID une fois prêt. Le test le tue par SIGKILL : l'hôte doit sortir seul.
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = fork(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "host.mjs"),
  [],
  {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    detached: process.platform !== "win32",
    execArgv: [],
  },
);
host.on("message", (message) => {
  if (message?.type === "report" && message.state === "ready") {
    process.stdout.write(`${host.pid}\n`);
  }
});
host.send(
  { channel: "nf-held", type: "start", spec: { mode: "ok" } },
  () => {},
);
setInterval(() => {}, 1_000);
