// Témoin de l'ANCIENNE garde d'entrée (ADR-0030, M9) : `argv[1]` comparé à
// l'URL du module. Lancé par un lien symbolique, il ne sert jamais — Node
// réalise l'URL du module, pas `argv[1]`.
import { fileURLToPath } from "node:url";
import { serveHeldService } from "../../../service/dev/heldChannel.ts";

if (
  typeof process.send === "function" &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  serveHeldService({
    async start() {
      globalThis.__keep = setInterval(() => {}, 1_000);
      return { pid: process.pid };
    },
    async stop() {
      clearInterval(globalThis.__keep);
    },
  });
}
