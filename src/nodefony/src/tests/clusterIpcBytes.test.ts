/**
 * Le relais IPC du cluster porte les octets INTACTS (ADR-0021 S6, #618).
 *
 * Avant : les workers naissaient en sérialisation JSON, et un `Uint8Array`
 * publié sur un canal diffusé arrivait chez l'autre worker en objet ordinaire
 * (`{"0":0,"1":1,…}`). Le master passe désormais l'IPC en clonage structuré
 * (`startClusterMaster`) et l'annonce aux workers par
 * `NF_CLUSTER_IPC_SERIALIZATION`, que le `ClusterBackplane` lit pour accepter
 * les octets.
 *
 * Banc : un vrai master et deux vrais workers, `node` nu sur le `dist`
 * (`fixtures/clusterBytes.fixture.mjs`).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "clusterBytes.fixture.mjs");

/** Lance le master, rend la première ligne `RESULT` d'un worker, puis arrête tout. */
function firstResult(timeoutMs = 15_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const master = spawn(process.execPath, [fixture], {
      cwd: path.resolve(here, "..", ".."),
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    const finish = (err: Error | null, value?: unknown): void => {
      clearTimeout(timer);
      master.kill("SIGTERM");
      if (err !== null) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`aucun RESULT en ${timeoutMs} ms :\n${out}`)),
      timeoutMs,
    );
    master.stdout.setEncoding("utf8");
    master.stdout.on("data", (chunk: string) => {
      out += chunk;
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      if (line !== undefined) finish(null, JSON.parse(line.slice(7)));
    });
    master.on("error", (err) => finish(err));
  });
}

describe("cluster — relais IPC des octets", () => {
  it("un Uint8Array traverse master et relais intact, et le worker sait que son canal le porte", async () => {
    const result = await firstResult();
    expect(result).toEqual({
      env: "advanced",
      isUint8Array: true,
      intact: true,
    });
  }, 20_000);
});
