// Hôte de fixture (ADR-0030) : joue le scénario nommé par `spec.mode`.
// Fichier .mjs non typé ; il charge le canal SOURCE (dépouillement des types de Node).
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { serveHeldService } from "../../../service/dev/heldChannel.ts";

let deaf = false;
let stopDelayMs = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Écrit `size` octets sur la sortie standard, en respectant la contre-pression. */
async function writeAll(text, size) {
  const chunk = Buffer.alloc(64 * 1024, text);
  for (let sent = 0; sent < size; sent += chunk.length) {
    const part =
      size - sent < chunk.length ? chunk.subarray(0, size - sent) : chunk;
    if (!process.stdout.write(part)) {
      await new Promise((r) => process.stdout.once("drain", r));
    }
  }
}

serveHeldService({
  async start(spec) {
    const mode = spec.mode;
    // Le PID sur disque, dès le départ : un test peut abattre l'hôte même si
    // aucun état ne lui parvient (c'est justement ce qu'il éprouve).
    if (typeof spec.pidFile === "string") {
      writeFileSync(spec.pidFile, String(process.pid));
    }
    if (mode === "fail") throw new Error("port occupé (fixture)");
    // Échoue UNE fois avec un arrêt LENT (B1) : l'hôte condamné tarde à sortir.
    if (mode === "fail-once-slow-stop" && !existsSync(spec.marker)) {
      writeFileSync(spec.marker, String(process.pid));
      stopDelayMs = 1_000;
      throw new Error("échec une fois (fixture)");
    }
    // Laisse un petit-enfant dans son groupe, puis plante (une seule fois).
    if (mode === "grandchild-then-crash" && !existsSync(spec.marker)) {
      const grandchild = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        {
          stdio: "ignore",
        },
      );
      writeFileSync(spec.marker, String(grandchild.pid));
      setTimeout(() => process.exit(3), 80).unref();
    }
    // Une ligne démesurée sans fin, puis sa fin.
    if (mode === "flood-line") {
      await writeAll("x", spec.bytes);
      process.stdout.write("\n");
    }
    // Meurt au chargement en disant pourquoi sur la sortie d'erreur.
    if (mode === "die-loudly") {
      // Sortie APRÈS l'écriture : un tube est asynchrone hors Linux.
      process.stderr.write("SyntaxError: fixture illisible\n", () =>
        process.exit(1),
      );
      await new Promise(() => {});
    }
    // Donnée démesurée : l'hôte doit nommer la cause plutôt que se taire.
    if (mode === "huge-data") return { blob: "x".repeat(spec.size) };
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
      tag: spec.tag ?? null,
    };
  },
  async stop() {
    if (deaf) for (;;) {}
    if (stopDelayMs > 0) await sleep(stopDelayMs);
    clearInterval(globalThis.__keep);
  },
});
