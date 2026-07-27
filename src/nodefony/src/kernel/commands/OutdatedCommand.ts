import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import { SysExit } from "../../cli/sysexits";
import {
  aggregateOutdated,
  formatHeadline,
  toTableRows,
  type IOutdatedSummary,
  type NpmOutdatedReport,
} from "../../cli/outdated";

const run = promisify(execFile);

/**
 * `kernelEvent: "onRegister"` — la commande n'interroge ni le plan d'administration
 * ni les serveurs : elle n'a besoin que de la racine du projet, connue dès la
 * construction du kernel. Aucun port n'est ouvert (profil console par défaut).
 */
const optionsCommand: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onRegister",
};

/** Sortie maximale acceptée de `npm outdated --json` (un gros dépôt en rend beaucoup). */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Ce que `execFile` attache à son erreur quand le process sort avec un code non nul.
 *
 * `npm outdated` sort **1** dès qu'un paquet est en retard : c'est son cas NOMINAL,
 * et sa sortie standard est alors parfaitement exploitable.
 */
interface IExecFailure extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | string;
}

/**
 * Liste les dépendances en retard du projet — une ligne par paquet, pas une par dépendant.
 *
 * Une seule interrogation de `npm` est faite, à la racine du projet : les espaces de
 * travail y sont déjà couverts. Interroger chaque module séparément, comme le faisait
 * la version précédente, réaffichait le MÊME tableau complet à chaque tour, puisqu'un
 * `npm` lancé dans un sous-dossier d'espace de travail remonte à la racine.
 *
 * @example
 * ```bash
 * nodefony outdated
 * nodefony outdated --all           # nomme tous les dépendants au lieu de les compter
 * nodefony outdated --json | jq '.packages[] | select(.severity == "major")'
 * ```
 */
class Outdated extends Command {
  constructor(cli: CliKernel) {
    super(
      "outdated",
      "Liste les dépendances du projet en retard, agrégées par paquet",
      cli as CliKernel,
      optionsCommand,
    );
    this.addOption("-j, --json", "sortie JSON (scriptable)");
    this.addOption(
      "-a, --all",
      "nomme tous les dépendants au lieu de n'en donner le compte",
    );

    // Le syslog est branché au tout début de `Kernel.start()`, avant le moindre
    // hook : un silence demandé depuis `generate()` arriverait après que le boot
    // a déjà écrit, et un `| jq` casserait sur la première ligne de log.
    // Le constructeur tourne pour TOUTES les commandes, d'où la garde sur argv.
    if (process.argv.includes("--json") || process.argv.includes("-j")) {
      (cli as CliKernel).quietBoot = true;
    }
  }

  override async generate(
    opts: { json?: boolean; all?: boolean } = {},
  ): Promise<this> {
    const root = (this.kernel as Kernel)?.path ?? process.cwd();

    if (!(await this.isNpmProject(root))) {
      // Fail-loud plutôt que fausse réponse : `pnpm outdated --json` et
      // `yarn outdated --json` rendent des documents de FORME différente, que
      // l'agrégateur ci-dessous lirait de travers sans rien signaler.
      this.log(
        `aucun « package-lock.json » à la racine (${root}) — cette commande lit le format de npm`,
        "ERROR",
      );
      await this.terminate(SysExit.UNAVAILABLE);
      return this;
    }

    let report: NpmOutdatedReport;
    try {
      report = await this.readNpmReport(root);
    } catch (error) {
      this.log(
        `interrogation de npm impossible : ${(error as Error).message}`,
        "ERROR",
      );
      await this.terminate(SysExit.SOFTWARE);
      return this;
    }

    const summary = aggregateOutdated(report);

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      this.renderHuman(summary, opts.all === true);
    }
    await this.terminate(SysExit.OK);
    return this;
  }

  /**
   * Vérifie que la racine porte bien un projet géré par npm.
   *
   * @param root - racine du projet.
   * @returns `true` si un `package-lock.json` s'y trouve.
   */
  private async isNpmProject(root: string): Promise<boolean> {
    try {
      await access(path.join(root, "package-lock.json"));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Interroge `npm outdated --json` UNE fois, à la racine.
   *
   * @param root - racine du projet, passée en répertoire courant du process fils.
   * @returns le document rendu par npm (objet vide si rien n'est en retard).
   * @throws Si npm est introuvable, ou si sa sortie n'est pas du JSON.
   */
  private async readNpmReport(root: string): Promise<NpmOutdatedReport> {
    let stdout = "";
    try {
      ({ stdout } = await run("npm", ["outdated", "--json", "--long"], {
        cwd: root,
        maxBuffer: MAX_BUFFER,
      }));
    } catch (error) {
      const failure = error as IExecFailure;
      // Code 1 = « il y a des paquets en retard ». C'est le cas nominal, et la
      // sortie standard porte alors le rapport. Sans stdout, c'est un vrai échec.
      if (typeof failure.stdout !== "string" || !failure.stdout.trim()) {
        throw error;
      }
      stdout = failure.stdout;
    }
    const trimmed = stdout.trim();
    return trimmed ? (JSON.parse(trimmed) as NpmOutdatedReport) : {};
  }

  /**
   * Affiche le résumé sous forme de tableaux.
   *
   * @param summary - le résumé agrégé.
   * @param all - `true` pour nommer tous les dépendants.
   */
  private renderHuman(summary: IOutdatedSummary, all: boolean): void {
    // Les tableaux passent par le MÊME syslog que les phrases qui les
    // introduisent : `displayTable` écrit sinon directement sur la sortie
    // standard, et le tableau apparaît AVANT le titre qui l'annonce.
    const syslog = this.cli?.syslog ?? null;

    this.log(formatHeadline(summary), "INFO");

    if (summary.packages.length) {
      this.cli?.displayTable(
        toTableRows(summary, all),
        {
          head: [
            "Paquet",
            "Saut",
            "Actuel",
            "Souhaité",
            "Dernier",
            "Dépendants",
          ],
        },
        syslog,
      );
    }

    if (summary.ahead.length) {
      this.log(
        `${summary.ahead.length} paquet${summary.ahead.length > 1 ? "s" : ""} en AVANCE sur le registre — un espace de travail local non publié n'est pas un retard :`,
        "INFO",
      );
      this.cli?.displayTable(
        summary.ahead.map((p) => [p.name, p.current ?? "—", p.latest]),
        { head: ["Paquet", "Installé ici", "Publié au registre"] },
        syslog,
      );
    }
  }
}

export default Outdated;
