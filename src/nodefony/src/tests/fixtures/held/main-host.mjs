// Hôte de fixture (ADR-0030, M9) : ne sert QUE lancé comme point d'entrée par
// un teneur — même entrée que l'hôte Vite (`serveHeldServiceIfMain`).
import { serveHeldServiceIfMain } from "../../../service/dev/heldChannel.ts";

serveHeldServiceIfMain(import.meta, () => ({
  async start() {
    globalThis.__keep = setInterval(() => {}, 1_000);
    return { pid: process.pid, title: process.title };
  },
  async stop() {
    clearInterval(globalThis.__keep);
  },
}));
