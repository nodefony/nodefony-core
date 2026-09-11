import fs from "node:fs";
import path from "node:path";

import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import { SysExit } from "../../cli/sysexits";
import {
  LicenseInventoryError,
  NOTICES_FILE,
  renderNotices,
  renderReport,
  surveyLicenses,
  type ILicenseSurvey,
} from "../../cli/licenses";

/**
 * `kernelEvent: "onRegister"` — la commande n'interroge ni le plan
 * d'administration ni les serveurs : elle lit l'arbre npm du projet, dont la
 * racine est connue dès la construction du kernel. Aucun port n'est ouvert.
 */
const options: OptionsCommandInterface = {
  helpGroup: "GÉNÉRER ET CONSTRUIRE",
  // Le journal de cycle de vie n'est pas la sortie de cette commande : elle LIT
  // un état et le rend.
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony licenses` — ce que l'application redistribue, et sous quelle licence.
 *
 * Les licences permissives (MIT, BSD, Apache-2.0) imposent toutes de conserver la
 * notice de copyright et le texte de la licence dans les distributions. Une
 * application qui installe une cinquantaine de paquets tiers ne peut pas tenir
 * cette obligation si elle ne sait même pas ce qu'elle embarque.
 *
 * La règle est celle du dépôt du framework, pas une copie : le même code refuse
 * une licence incompatible avant une publication et écrit le relevé d'une
 * application. Deux implémentations d'une même règle divergent en silence,
 * chacune passant ses propres contrôles.
 *
 * @example
 * ```bash
 * nodefony licenses            # le relevé, et le refus de ce qui n'a pas été examiné
 * nodefony licenses --write    # (re)génère THIRD-PARTY-NOTICES.md
 * nodefony licenses --json     # pour un autre outil
 * ```
 */
class Licenses extends Command {
  constructor(cli: CliKernel) {
    super(
      "licenses",
      "les licences des dépendances redistribuées",
      cli as CliKernel,
      options,
    );
    this.addOption("-j, --json", "sortie JSON (scriptable)");
    this.addOption(
      "-w, --write",
      `écrit le relevé dans ${NOTICES_FILE} à la racine du projet`,
    );
    this.addOption(
      "--cwd <path>",
      "racine à inspecter (défaut : la racine du projet)",
    );
  }

  override async generate(opts?: {
    json?: boolean;
    write?: boolean;
    cwd?: string;
  }): Promise<this> {
    const root =
      opts?.cwd !== undefined
        ? path.resolve(opts.cwd)
        : ((this.kernel as Kernel | null)?.path ?? process.cwd());

    let survey: ILicenseSurvey;
    try {
      survey = surveyLicenses(root);
    } catch (error) {
      if (error instanceof LicenseInventoryError) {
        // La cause est nommée, avec son remède : `terminate` porte le message
        // plutôt qu'une trace, qui ferait chercher le défaut dans ce code.
        this.log(error.message, "ERROR");
        await this.terminate(SysExit.SOFTWARE);
        return this;
      }
      throw error;
    }

    if (opts?.write === true) {
      const file = path.join(root, NOTICES_FILE);
      fs.writeFileSync(file, renderNotices(survey), "utf8");
      this.log(`relevé écrit : ${file} (${survey.packages.length} paquets)`);
    }

    if (opts?.json === true) {
      // `process.stdout` et non `this.log` : la sortie machine doit rester du
      // JSON pur, sans un octet de journal — même règle que `outdated --json`.
      process.stdout.write(
        `${JSON.stringify(
          {
            root: survey.root,
            workspaces: survey.workspaces,
            total: survey.packages.length,
            tally: Object.fromEntries(survey.tally),
            packages: survey.packages,
            refused: survey.refused,
            uncovered: survey.uncovered,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(`${renderReport(survey)}\n`);
    }

    // Une licence hors liste, ou une dépendance du gabarit hors du relevé, est un
    // REFUS : le code de sortie doit le dire, sinon la garde ne garde rien.
    await this.terminate(
      survey.refused.length === 0 && survey.uncovered.length === 0
        ? SysExit.OK
        : SysExit.SOFTWARE,
    );
    return this;
  }
}

export default Licenses;
