import type { CliKernel, OptionsCommandInterface } from "nodefony";
import { renderStatus } from "../src/migrator/explain";
import { OrmMigrateCommand, type IMigrateSharedOptions } from "./migrateShared";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Options propres à la réparation de l'historique. */
interface IRepairOptions extends IMigrateSharedOptions {
  source?: string;
  updateHashes?: boolean;
  forget?: string[];
}

/**
 * `nodefony orm:migrate:repair` — lève les marqueurs d'échec, **après**
 * inspection humaine.
 *
 * ## Ce que « réparer » veut dire ici, et ce que ça ne veut pas dire
 *
 * Cette commande **ne répare pas la base**. Elle efface la trace d'une
 * migration qui n'a pas abouti, pour que l'applicateur accepte de reprendre.
 * C'est une déclaration : « j'ai regardé la base, elle est dans l'état que je
 * crois ».
 *
 * Pourquoi ce n'est pas automatique : quand une migration s'arrête en cours de
 * route, l'état laissé dépend de la base. PostgreSQL et SQLite annulent la
 * migration fautive entière — l'état est net. MySQL valide chaque instruction
 * de schéma au fur et à mesure, sans retour possible : la moitié des
 * changements peut être en place. Aucun programme ne peut décider à la place
 * d'un humain si cette moitié est acceptable.
 *
 * **L'ordre des gestes, et il ne s'inverse pas :**
 *
 * 1. `nodefony orm:migrate:status --json` — voir ce qui a échoué et pourquoi ;
 * 2. regarder la base elle-même, et la remettre d'aplomb si besoin ;
 * 3. `nodefony orm:migrate:repair` — lever le marqueur ;
 * 4. `nodefony orm:migrate` — reprendre.
 *
 * ## `--update-hashes` : à ne taper que sur instruction d'un message
 *
 * Ré-aligner les empreintes déclare que les fichiers modifiés APRÈS avoir été
 * appliqués sont réputés conformes. C'est presque toujours faux : les autres
 * bases ont reçu l'ancienne version et ne recevront jamais la nouvelle. Le
 * geste normal face à un fichier modifié est de le restaurer
 * (`git checkout -- migrations/`) et d'écrire une NOUVELLE migration.
 *
 * L'option existe pour le cas où l'on sait que la modification était sans effet
 * — une reformulation, un commentaire. Elle ne touche jamais la base.
 *
 * ## `--forget <source>/<tag>` : l'issue d'un historique qui MENT
 *
 * Il existait un état dont aucune commande ne sortait : une migration inscrite
 * comme réussie que personne n'a jamais exécutée — une adoption mal bornée, ou
 * une base héritée d'une version antérieure aux gardes. La base ne porte pas
 * les tables, l'historique affirme le contraire, et rien n'est « en attente ».
 * Le générateur disait alors « c'est l'historique qu'il faut reprendre » et
 * renvoyait ici ; mais cette commande ne savait lever que des marqueurs
 * d'ÉCHEC, et répondait « rien à réparer ». Trois messages vrais, aucun geste
 * — et le seul chemin restant était de détruire la base.
 *
 * `--forget` désinscrit UNE entrée nommée, pour qu'elle soit rejouée au
 * passage suivant. Bornée par construction : il faut la nommer
 * (`--forget app/0003_ajout_facture`), il n'y a ni motif ni lot. La base n'est
 * pas touchée — si la migration avait réellement été appliquée, son rejeu
 * échouera, bruyamment, ce qui est le comportement voulu.
 */
class OrmMigrateRepair extends OrmMigrateCommand {
  constructor(cli: CliKernel) {
    super(
      "orm:migrate:repair",
      "Lève les marqueurs d'échec après inspection (ne modifie PAS la base)",
      cli,
      options,
    );
    this.addSharedOptions();
    this.addOption(
      "-s, --source <nom>",
      "ne réparer que cette source (framework, app, un module) — toutes si omis",
    );
    this.addOption(
      "--forget <source/tag...>",
      "désinscrit une migration nommée pour qu'elle soit REJOUÉE — l'issue quand l'historique affirme une migration jamais exécutée",
    );
    this.addOption(
      "--update-hashes",
      "déclare conformes les fichiers modifiés après application — presque toujours FAUX, à ne taper que si un message le demande",
    );
  }

  override async generate(opts: IRepairOptions = {}): Promise<this> {
    const resolved = this.resolveOrFail(opts, true);
    if (!resolved) {
      return this;
    }
    const { resolution, config } = resolved;
    const style = this.style;
    try {
      const migrator = await this.migrator(resolution, config);
      const forget = (opts.forget ?? []).map((brut) => {
        const coupe = brut.indexOf("/");
        if (coupe <= 0 || coupe === brut.length - 1) {
          throw new Error(
            `« ${brut} » n'est pas une entrée d'historique. La forme attendue ` +
              `est « source/tag », par exemple « app/0003_ajout_facture » : ` +
              `sans la source, deux migrations de même tag ne se distinguent pas.`,
          );
        }
        return {
          source: brut.slice(0, coupe),
          tag: brut.slice(coupe + 1),
        };
      });
      const done = await migrator.repair({
        source: opts.source,
        updateHashes: opts.updateHashes === true,
        forget,
      });
      const plan = await migrator.status();
      const report = await this.report(plan, resolution, config);
      const payload = { ...report, repaired: done };
      let human = "";
      if (
        done.cleared.length === 0 &&
        done.rehashed.length === 0 &&
        done.forgotten.length === 0
      ) {
        human = `${style.green("Rien à réparer : aucun marqueur d'échec, aucune empreinte à ré-aligner.")}\n\n`;
      } else {
        human = `${style.green(style.bold("✓ historique réparé"))} ${style.dim("— la base n'a pas été modifiée")}\n`;
        for (const c of done.cleared) {
          human += `  ${style.green("−")} marqueur d'échec levé : ${c.source}/${c.tag}\n`;
        }
        for (const r of done.rehashed) {
          human += `  ${style.yellow("≈")} empreinte ré-alignée : ${r.source}/${r.tag}\n`;
        }
        for (const f of done.forgotten) {
          human += `  ${style.yellow("↺")} désinscrite, sera REJOUÉE : ${f.source}/${f.tag}\n`;
        }
        human += "\n";
      }
      human += renderStatus(report, style);
      this.respond(payload, human, report.exitCode, opts.json);
    } catch (e) {
      this.failFrom(e, resolution.connector, opts.json, resolution.ddl);
    }
    return this;
  }
}

export default OrmMigrateRepair;
