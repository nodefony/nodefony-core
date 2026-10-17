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
  function register(
    extraCaFiles: string[],
    environment = "production",
    journal: string[] = [],
  ): Promise<unknown> {
    const self = {
      options: { certificates: { extraCaFiles } },
      kernel: { path: dir, environment },
      log: (message: string) => journal.push(message),
    };
    return Http.prototype.onKernelRegister.call(self as never);
  }

  it("une autorité déclarée introuvable interrompt l'enregistrement en nommant le fichier", async () => {
    const error = await register(["absent.pem"]).catch((e: unknown) => e);
    expect(BootConfigurationError.is(error)).to.equal(true);
    expect((error as Error).message).to.include(path.join(dir, "absent.pem"));
  });

  // L'autorité de DÉVELOPPEMENT déclarée (`NF_TLS_CA_FILE` du `.env` du preset
  // complete) avant tout premier démarrage en dev : rien ne doit bloquer, et
  // une commande console ne fabrique aucun certificat.
  describe("l'autorité de développement pas encore engendrée", () => {
    const declared = path.join(
      "nodefony",
      "config",
      "certificates",
      "ca",
      "nodefony-root-ca.crt.pem",
    );
    let cwd = "";
    let envBefore: string | undefined;
    beforeEach(async () => {
      // Le chemin de l'autorité suit le répertoire courant ; `realpath` : sous
      // macOS le dossier temporaire est un lien (/var → /private/var).
      dir = await fs.realpath(dir);
      cwd = process.cwd();
      process.chdir(dir);
      envBefore = process.env.NF_TLS_CA_FILE;
    });
    afterEach(() => {
      process.chdir(cwd);
      if (envBefore === undefined) delete process.env.NF_TLS_CA_FILE;
      else process.env.NF_TLS_CA_FILE = envBefore;
    });

    it("en développement : l'enregistrement passe, le journal le dit, rien n'est écrit", async () => {
      const journal: string[] = [];
      await register([declared], "development", journal);
      expect(journal.join("\n")).to.include("pas encore engendrée : ignorée");
      const written = await fs.access(path.join(dir, "nodefony")).then(
        () => true,
        () => false,
      );
      expect(written).to.equal(false);
    });

    it("en production : refus qui nomme NF_TLS_CA_FILE et le geste", async () => {
      process.env.NF_TLS_CA_FILE = declared;
      const error = await register([declared]).catch((e: unknown) => e);
      expect(BootConfigurationError.is(error)).to.equal(true);
      const message = (error as Error).message;
      expect(message).to.include("NF_TLS_CA_FILE");
      expect(message).to.include("autorité de DÉVELOPPEMENT");
      expect(message).to.include("npx nodefony http:certificates");
    });

    it("une autorité d'entreprise absente reste un refus en développement", async () => {
      const error = await register(["entreprise.pem"], "development").catch(
        (e: unknown) => e,
      );
      expect(BootConfigurationError.is(error)).to.equal(true);
      expect((error as Error).message).to.include(
        "Poser le fichier à ce chemin",
      );
    });
  });

  it("sans autorité déclarée, l'enregistrement passe", async () => {
    await expect(register([])).resolves.toBeDefined();
  });
});
