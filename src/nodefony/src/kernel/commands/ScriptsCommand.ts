import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import {
  loadProjectScripts,
  groupProjectScripts,
} from "../../cli/projectScripts";

const options: OptionsCommandInterface = {
  helpGroup: "COMPRENDRE",
  quietBoot: true,
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony scripts` — ce que font les scripts `npm` de ce projet.
 *
 * `package.json` est du JSON : il n'accepte aucun commentaire, et le seul indice
 * de ce que fait un script y est son NOM. Sur un projet qui en porte soixante,
 * son propre auteur ne s'en souvient plus, et un agent qui découvre le dépôt ne
 * peut que deviner — ou lancer pour voir.
 *
 * Les descriptions se déclarent dans `nodefony.scripts` du `package.json`. Elles
 * remontent aussi dans `nodefony --help` ; cette commande existe pour les rendre
 * SEULES, et surtout pour les rendre en JSON : un agent ne doit pas avoir à
 * analyser une page d'aide pour savoir quoi lancer.
 *
 * Le classement par famille est DÉRIVÉ du nom (`groupOfScript`) : un script
 * ajouté demain se range tout seul, là où un ordre écrit à la main l'aurait
 * laissé tomber en fin de liste sans que personne le voie.
 *
 * @example
 * ```bash
 * nodefony scripts          # les familles, pour un humain
 * nodefony scripts --json   # la même chose, pour un programme
 * ```
 */
class Scripts extends Command {
  constructor(cli: CliKernel) {
    super(
      "scripts",
      "ce que font les scripts npm de ce projet",
      cli as CliKernel,
      options,
    );
    this.addOption("-j, --json", "sortie JSON (scriptable)");
  }

  override async generate(opts?: { json?: boolean }): Promise<this> {
    const all = loadProjectScripts();
    const groups = groupProjectScripts(all);

    if (opts?.json) {
      // La sortie porte AUSSI ce qui n'est pas décrit : un agent qui ne verrait
      // que les scripts documentés conclurait que les autres n'existent pas.
      process.stdout.write(
        `${JSON.stringify(
          {
            groups: groups.map((g) => ({
              title: g.title,
              scripts: g.scripts.map((s) => ({
                name: s.name,
                description: s.description,
                command: s.command,
              })),
            })),
            undocumented: all
              .filter((s) => s.description === null)
              .map((s) => ({ name: s.name, command: s.command })),
          },
          null,
          2,
        )}\n`,
      );
      await this.terminate(0);
      return this;
    }

    if (!groups.length) {
      process.stdout.write(
        "Aucun script décrit dans ce projet.\n" +
          "  Les décrire dans « nodefony.scripts » du package.json :\n" +
          '  "nodefony": { "scripts": { "build": "Ce que fait build." } }\n',
      );
      await this.terminate(0);
      return this;
    }

    const width = Math.max(
      ...groups.flatMap((g) => g.scripts.map((s) => s.name.length)),
    );
    const lines: string[] = [
      "",
      "  Scripts npm de ce projet — ils se lancent avec : npm run <nom>",
      "  (ce ne sont pas des commandes nodefony)",
    ];
    for (const group of groups) {
      lines.push("", `  ${group.title}`);
      for (const script of group.scripts) {
        lines.push(`    ${script.name.padEnd(width)}  ${script.description}`);
      }
    }
    const undocumented = all.filter((s) => s.description === null);
    if (undocumented.length) {
      lines.push(
        "",
        `  ${undocumented.length} script(s) sans description : ${undocumented
          .map((s) => s.name)
          .join(", ")}`,
      );
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    await this.terminate(0);
    return this;
  }
}

export default Scripts;
