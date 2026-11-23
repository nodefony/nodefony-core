// Hôte de fixture (ADR-0030) : joue le scénario nommé par `spec.mode`.
// Fichier .mjs non typé ; il charge le canal SOURCE (dépouillement des types de Node).
import { existsSync, writeFileSync } from "node:fs";
import { serveHeldService } from "../../../service/dev/heldChannel.ts";

let deaf = false;

serveHeldService({
  async start(spec) {
    const mode = spec.mode;
    if (mode === "fail") throw new Error("port occupé (fixture)");
    if (mode === "silent") return new Promise(() => {});
    if (mode === "noisy") {
      process.stdout.write("ab");
      await new Promise((r) => setTimeout(r, 20));
      process.stdout.write("c\nde");
      await new Promise((r) => setTimeout(r, 20));
      process.stdout.write("f\n");
      process.stderr.write("erreur\n");
    }
    if (mode === "crash-after-ready") {
      setTimeout(() => process.exit(3), 80).unref();
    }
    // Plante UNE fois (le témoin survit au process), puis reste sain.
    if (mode === "crash-once" && !existsSync(spec.marker)) {
      writeFileSync(spec.marker, "1");
      setTimeout(() => process.exit(3), 80).unref();
    }
    if (mode === "freeze-after-ready") {
      setTimeout(() => {
        for (;;) {} // boucle gelée : aucun pong ne repartira
      }, 80);
    }
    // Sourd à l'arrêt : la boucle gèle, même le délai de grâce de l'hôte ne
    // peut plus partir — seul le teneur, en tuant l'arbre, en vient à bout.
    if (mode === "ignore-stop") deaf = true;
    // Garde le process vivant tant que le service tourne.
    const keep = setInterval(() => {}, 1_000);
    globalThis.__keep = keep;
    return {
      pid: process.pid,
      devChild: process.env.NF_DEV_CHILD ?? null,
      mode,
    };
  },
  async stop() {
    if (deaf) for (;;) {}
    clearInterval(globalThis.__keep);
  },
});
