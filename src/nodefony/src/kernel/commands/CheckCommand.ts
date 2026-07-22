import path from "node:path";
import { readFileSync, statSync } from "node:fs";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { checkPackageDeps } from "../checks/packageDeps";
import type { IPackageFinding } from "../checks/packageDeps";
import clc from "../../colors";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony check` — contrôle la cohérence des paquets de l'application.
 *
 * Elle répond à une question qu'aucun test applicatif ne pose : **ce que mes
 * modules importent, est-ce qu'ils le déclarent ?** Tant qu'on développe, la
 * réponse n'a aucune importance — npm hisse tout à la racine du projet, donc un
 * import non déclaré se résout quand même. Elle en prend le jour où le module
 * part ailleurs : l'installation n'amène pas ce qui n'est pas déclaré, et un
 * outil de construction ne peut pas ordonner ce qu'on ne lui a pas dit.
 *
 * Le contrôle porte sur les modules de l'application (`modules/`, `src/modules/`)
 * et sur l'application elle-même.
 *
 * @example
 * ```bash
 * nodefony check          # sortie lisible, sort en erreur si un manquement
 * nodefony check --json   # même chose, exploitable par un script de CI
 * ```
 */
class Check extends Command {
  constructor(cli: CliKernel) {
    super(
      "check",
      "Check that every Nodefony package imported by the app is declared",
      cli as CliKernel,
      options,
    );
    this.addOption("--json", "Machine-readable output");
  }

  override async generate(opts?: { json?: boolean }): Promise<this> {
    const cwd = process.cwd();
    // Les deux dispositions rencontrées : une application créée par
    // `nodefony create app` (modules/) et le dépôt du framework (src/modules/).
    const roots = [cwd, "modules", "src/modules", "src/packages/@nodefony"]
      .map((r) => (path.isAbsolute(r) ? r : path.join(cwd, r)))
      .filter((r) => statSync(r, { throwIfNoEntry: false }));

    // Exceptions déclarées par le projet, dans son `package.json` :
    //   "nodefony": { "check": { "typeCycles": {…}, "typesUnreachable": [...] } }
    // Sans cette porte, un projet qui porte un cycle de types légitime ne peut
    // jamais être vert — et une vérification qu'on ne peut pas satisfaire est
    // une vérification qu'on apprend à ignorer.
    let typeCycles: Record<string, string[]> | undefined;
    let typesUnreachable: string[] | undefined;
    try {
      const raw = readFileSync(path.join(cwd, "package.json"), "utf8");
      const check = (JSON.parse(raw) as { nodefony?: { check?: unknown } })
        .nodefony?.check as
        | { typeCycles?: Record<string, string[]>; typesUnreachable?: string[] }
        | undefined;
      typeCycles = check?.typeCycles;
      typesUnreachable = check?.typesUnreachable;
    } catch {
      /* pas de package.json lisible : on vérifie sans exception */
    }

    const { findings, scanned } = checkPackageDeps({
      roots,
      cwd,
      typeCycles,
      typesUnreachable,
    });
    const json = Boolean(opts?.json);

    if (json) {
      this.log(JSON.stringify({ scanned, findings }, null, 2), "INFO");
      await this.terminate(findings.length > 0 ? 1 : 0);
      return this;
    }

    if (findings.length === 0) {
      this.log(clc.green(`✓ ${scanned} paquet(s) — rien à signaler.`), "INFO");
      await this.terminate(0);
      return this;
    }

    for (const f of findings as IPackageFinding[]) {
      this.log(clc.red(`✗ ${f.message}`), "ERROR");
      if (f.file) {
        this.log(`  premier usage : ${f.file}`, "ERROR");
      }
    }
    this.log(
      clc.red(`\n${findings.length} manquement(s) sur ${scanned} paquet(s).`),
      "ERROR",
    );
    await this.terminate(1);
    return this;
  }
}

export default Check;
