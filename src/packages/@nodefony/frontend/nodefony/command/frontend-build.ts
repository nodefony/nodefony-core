import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import type FrontendService from "../service/FrontendService";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onReady",
};

/**
 * `nodefony frontend:build` — build production de tous les frontends déclarés.
 *
 * Écrit `public/dist/` + `manifest.json` par bundle (lu ensuite par
 * `renderProdTags` + servi par `server-static`).
 *
 * - Idempotent : un bundle déjà à jour est **ignoré** (relance prod rapide).
 *   `--force` rebuild tout.
 * - Erreurs : un bundle KO n'arrête pas les autres ; l'exit code passe à `1`
 *   s'il reste au moins un échec (cassure de pipeline CI).
 */
class FrontendBuild extends Command {
  constructor(cli: CliKernel) {
    super("frontend:build", "Build production frontends (Vite)", cli, options);
    this.addOption("-f, --force", "rebuild even if the manifest is up-to-date");
  }

  override async generate(
    _arg: string,
    opts: { force?: boolean } = {},
  ): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      | FrontendService
      | undefined;
    if (!svc) {
      this.log(
        "service `frontend` not registered — is @nodefony/frontend loaded?",
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }
    if (svc.listEntries().length === 0) {
      this.log("no frontend entries declared", "WARNING");
      return this;
    }

    this.log(
      `building ${svc.listEntries().length} entry(ies)${opts.force ? " (--force)" : ""}…`,
      "INFO",
    );
    try {
      const res = await svc.build({ force: opts.force });
      this.log(
        `built: [${res.built.join(", ") || "—"}] | skipped: [${res.skipped.join(", ") || "—"}] | failed: [${res.failures.map((f) => f.entryName).join(", ") || "—"}]`,
        res.failures.length ? "ERROR" : "INFO",
      );
      for (const f of res.failures) {
        this.log(`  ✗ ${f.entryName}: ${f.message}`, "ERROR");
      }
      // Pipeline : exit non-zero si un bundle a échoué.
      if (res.failures.length) process.exitCode = 1;
    } catch (e) {
      // Échec global (aucune entrée, import Vite KO, etc.)
      this.log(e instanceof Error ? e.message : String(e), "ERROR");
      process.exitCode = 1;
    }
    return this;
  }
}

export default FrontendBuild;
