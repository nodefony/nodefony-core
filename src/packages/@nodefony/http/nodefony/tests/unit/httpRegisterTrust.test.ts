/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BootConfigurationError } from "nodefony";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Http from "../../../index.js";

/**
 * Le BRANCHEMENT de `certificates.extraCaFiles` : c'est l'enregistrement du
 * module — qui tourne aussi pour une commande console — qui pose la confiance
 * sortante. Le mécanisme lui-même est éprouvé dans `certificates.test.ts`.
 */
describe("module http — l'enregistrement applique `extraCaFiles`", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-httpreg-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Joue `onKernelRegister` sur un module minimal, sans kernel complet. */
  function register(extraCaFiles: string[]): Promise<unknown> {
    const self = {
      options: { certificates: { extraCaFiles } },
      kernel: { path: dir, environment: "production" },
      log: () => undefined,
    };
    return Http.prototype.onKernelRegister.call(self as never);
  }

  it("une autorité déclarée introuvable interrompt l'enregistrement en nommant le fichier", async () => {
    const error = await register(["absent.pem"]).catch((e: unknown) => e);
    expect(BootConfigurationError.is(error)).to.equal(true);
    expect((error as Error).message).to.include(path.join(dir, "absent.pem"));
  });

  it("sans autorité déclarée, l'enregistrement passe", async () => {
    await expect(register([])).resolves.toBeDefined();
  });
});
