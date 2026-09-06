import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import fs from "node:fs";
import path from "node:path";
import type FrontendService from "../service/FrontendService";

const options: OptionsCommandInterface = {
  helpGroup: "FRONT ET RÉSEAU",
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
    super(
      "frontend:build",
      "construit les fronts pour la production",
      cli,
      options,
    );
    this.addOption("-f, --force", "rebuild even if the manifest is up-to-date");
  }

  override async generate(): Promise<this> {
    // Options lues via l'API CANONIQUE Commander (`this.command.opts()`). Se fier au
    // RANG des args de l'action est un piège : Commander passe `(…positionnels,
    // options, command)` → SANS argument positionnel (cas de `frontend:build`),
    // `options` est le 1ᵉʳ arg, pas le 2ᵉ. L'ancienne signature `generate(_arg, opts)`
    // lisait donc `opts.force` sur l'objet `command` (pas d'options en Commander
    // moderne) → `--force` silencieusement ignoré. `opts()` est fiable quel que soit
    // le nombre de positionnels.
    const opts = ((
      this.command as unknown as { opts?: () => { force?: boolean } }
    )?.opts?.() ?? {}) as { force?: boolean };
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    if (!svc) {
      this.log(
        "service `frontend` not registered — is @nodefony/frontend loaded?",
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }
    const entries = svc.listEntries();
    if (entries.length === 0) {
      this.log("no frontend entries declared", "WARNING");
      // Sortie UTILISATEUR explicite (console, comme `frontend:status`) : `this.log`
      // n'atteint pas le terminal en CLI → sans ça la commande semble « ne rien faire ».
      console.log(
        "frontend:build — aucun frontend déclaré, rien à construire.",
      );
      return this;
    }

    // Date lisible du dernier build d'une entrée = mtime de son manifest Vite.
    const lastBuilt = (name: string): string => {
      const e = entries.find((x) => x.entryName === name);
      if (!e) return "?";
      try {
        return fs
          .statSync(path.join(e.outDir, ".vite", "manifest.json"))
          .mtime.toLocaleString("fr-FR");
      } catch {
        return "jamais";
      }
    };

    // Résumé VISIBLE à l'écran (console) — le vrai retour à l'utilisateur. `this.log`
    // (INFO) part au syslog mais n'apparaît PAS sur stdout en mode CLI → la commande
    // paraissait « sortir sans info » quand tout était à jour (incrémental silencieux).
    console.log(
      `frontend:build — ${entries.length} frontend(s)${opts.force ? " (--force)" : ""}…`,
    );
    try {
      const res = await svc.build({ force: opts.force });
      if (res.built.length) {
        console.log(`  ✓ construit(s) : ${res.built.join(", ")}`);
      }
      for (const name of res.skipped) {
        console.log(
          `  • à jour       : ${name} (dernier build ${lastBuilt(name)}) — rien à faire`,
        );
      }
      for (const f of res.failures) {
        console.log(`  ✗ ÉCHEC        : ${f.entryName} — ${f.message}`);
      }
      if (!res.built.length && !res.failures.length) {
        console.log(
          "  → tout est à jour. Rien à reconstruire (--force pour tout refaire).",
        );
      }
      // Trace syslog (audit/observabilité) — doublon volontaire du résumé console.
      this.log(
        `built:[${res.built.join(", ") || "—"}] skipped:[${res.skipped.join(", ") || "—"}] failed:[${res.failures.map((f) => f.entryName).join(", ") || "—"}]`,
        res.failures.length ? "ERROR" : "INFO",
      );
      // Pipeline : exit non-zero si un bundle a échoué.
      if (res.failures.length) process.exitCode = 1;
    } catch (e) {
      // Échec global (aucune entrée, import Vite KO, etc.)
      const msg = e instanceof Error ? e.message : String(e);
      this.log(msg, "ERROR");
      console.log(`frontend:build — ÉCHEC : ${msg}`);
      process.exitCode = 1;
    }
    return this;
  }
}

export default FrontendBuild;
