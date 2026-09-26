import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { spawnedOutput } from "../runtime/spawnedOutput";

describe("spawnedOutput", () => {
  it("rend des sorties vides quand le lancement échoue, là où le type promet des chaînes", () => {
    const run = spawnSync("nodefony-executable-introuvable", [], {
      encoding: "utf8",
    });
    // Le constat qui fonde le helper : `@types/node` dit `string`, Node rend
    // `undefined`. Si Node change un jour, ce test le dira.
    expect(run.error).toBeDefined();
    expect(run.stdout as string | undefined).toBeUndefined();
    expect(spawnedOutput(run)).toEqual({ stdout: "", stderr: "" });
  });

  it("rend les sorties d'un processus lancé telles quelles", () => {
    const run = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write('o'); process.stderr.write('e')"],
      { encoding: "utf8" },
    );
    expect(spawnedOutput(run)).toEqual({ stdout: "o", stderr: "e" });
  });
});
