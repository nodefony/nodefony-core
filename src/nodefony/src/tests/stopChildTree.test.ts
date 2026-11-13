/**
 * Arrêt d'un exemplaire jetable : N'arrête QUE son arbre, et dit comment.
 * Un arrêt gracieux laisse tourner les crochets de sortie (profil
 * `--cpu-prof`) ; un arrêt forcé les coupe. Process RÉELS : c'est l'enfant
 * qui dit s'il a vu son `SIGTERM`.
 */
import { describe, it, afterAll } from "vitest";
import { expect } from "chai";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stopChildTree } from "../testing/stopChildTree";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-stop-tree-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// Windows : aucun arrêt gracieux d'arbre — le verdict attendu est `forced`.
const posix = process.platform !== "win32";

/**
 * Enfant chef de son groupe. `onTerm` : écrit le témoin puis sort sur
 * `SIGTERM` ; `ignore` : reste sourd au `SIGTERM`.
 */
async function child(
  name: string,
  mode: "onTerm" | "ignore",
): Promise<{ proc: ChildProcess; marker: string }> {
  const marker = path.join(dir, `${name}.done`);
  const body =
    mode === "onTerm"
      ? `process.on("SIGTERM", () => { process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok"); process.exit(0); });`
      : `process.on("SIGTERM", () => undefined);`;
  const proc = spawn(
    process.execPath,
    ["-e", `${body} setInterval(() => undefined, 1000); console.log("ready");`],
    { detached: posix, stdio: ["ignore", "pipe", "ignore"] },
  );
  if (proc.stdout === null) throw new Error("stdout absent");
  await once(proc.stdout, "data");
  return { proc, marker };
}

describe("stopChildTree — arrêter l'exemplaire, et lui seul", () => {
  it("graceful : SIGTERM, l'enfant sort de lui-même et son crochet de sortie a tourné", async () => {
    const { proc, marker } = await child("graceful", "onTerm");
    const outcome = await stopChildTree(proc, { graceful: true });
    expect(outcome).to.equal(posix ? "graceful" : "forced");
    expect(fs.existsSync(marker)).to.equal(posix);
  });

  it("par défaut : SIGKILL d'emblée, aucun crochet de sortie", async () => {
    const { proc, marker } = await child("forced", "onTerm");
    expect(await stopChildTree(proc)).to.equal("forced");
    expect(fs.existsSync(marker)).to.equal(false);
  });

  it("sourd au SIGTERM : forcé après le délai de grâce, la main revient", async () => {
    const { proc } = await child("deaf", "ignore");
    expect(
      await stopChildTree(proc, { graceful: true, graceMs: 200 }),
    ).to.equal("forced");
    expect(proc.signalCode ?? proc.exitCode).to.not.equal(null);
  });

  it("déjà sorti : constaté, sans attendre un `exit` passé", async () => {
    const { proc } = await child("gone", "onTerm");
    proc.kill("SIGKILL");
    await once(proc, "exit");
    expect(await stopChildTree(proc, { graceful: true })).to.equal(
      "already-exited",
    );
  });
});
