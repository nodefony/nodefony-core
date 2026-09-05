import path from "node:path";
import type { CliKernel, Kernel, OptionsCommandInterface } from "nodefony";
import {
  MIGRATION_FORMAT_VERSION,
  action,
  renderStatus,
} from "../src/migrator/explain";
import { OrmMigrateCommand, type IMigrateSharedOptions } from "./migrateShared";
import { EXIT } from "../src/migrator/explain";
import { gapAgainstDeclared } from "../src/migrator/divergence";
import {
  adoptFromDatabase,
  readJournal,
  type IAdoptedBaseline,
} from "../src/migrator/adopt";
import { appMigrationsDir } from "../src/migrator/resolve";
import { registeredTables } from "../src/migrator/appSchema";
import { frameworkTables } from "../src/migrator/sources";
import { HISTORY_TABLE } from "../src/migrator/types";
import { stampFormatMarker } from "../src/migrator/kit";
import { checkMigrationName } from "../src/migrator/name";
import type { IConnectorResolution } from "../src/migrator/resolve";
import type { IDrizzleConfig } from "../interfaces/IDrizzleConfig";
import { summarizeGap } from "../src/migrator/schemaDiff";

const options: OptionsCommandInterface = {
  helpGroup: "BASE DE DONNÉES",
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Options propres à l'adoption d'une base existante. */
interface IBaselineOptions extends IMigrateSharedOptions {
  upTo?: string;
  fromDatabase?: boolean;
  name?: string;
}

/**
 * `nodefony orm:migrate:baseline` — déclare une base existante « à niveau »,
 * SANS exécuter une seule instruction de schéma.
 *
 * ## Quand on en a besoin
 *
 * La base contient déjà les tables — parce qu'on branche Nodefony sur une base
 * qui existait avant, ou parce que le schéma a été créé autrement (mode `auto`
 * en développement) — mais aucune migration n'y est enregistrée. Appliquer les
 * migrations dans cet état exécuterait des créations de tables qui existent
 * déjà, et échouerait.
 *
 * ## Pourquoi ce n'est PAS automatique
 *
 * Adopter tout seul retirerait le filet qui protège de la pire erreur : se
 * tromper de base. Une adresse de base héritée d'un autre environnement, et
 * l'outil déclarerait « à niveau » une base qui n'a rien à voir — puis
 * appliquerait dessus les migrations suivantes. La documentation de Flyway
 * elle-même met en garde contre son propre mode automatique pour cette raison.
 *
 * **Vérifie que c'est la bonne base avant de taper cette commande.** Elle ne
 * modifie pas le schéma, mais elle change ce que le framework CROIT du schéma —
 * et tout le reste en découle.
 *
 * ## Ce qu'elle fait exactement
 *
 * Elle inscrit dans l'historique, comme appliquées avec succès et une durée
 * nulle, les migrations qui n'y sont pas encore. Rejouée, elle n'inscrit que ce
 * qui manque : elle est donc sûre à relancer.
 *
 * ## Ce qu'elle REFUSE
 *
 * Adopter, c'est affirmer que la base est à l'état que décrivent ces
 * migrations. Quand la base s'écarte du schéma déclaré, l'affirmation serait
 * fausse — et une affirmation fausse gravée dans l'historique n'est rattrapable
 * par aucune commande. La commande constate donc la base AVANT d'écrire, et
 * refuse (`NF_MIGRATE_BASELINE_AMBIGUOUS`) en nommant ce qui manque.
 *
 * Trois cas y échappent, et pour la même raison — la garde n'a plus rien à
 * deviner : `--up-to`, qui borne l'adoption explicitement ; `--from-database`,
 * dont la référence DÉCRIT la base et rend donc l'affirmation vraie par
 * construction ; et une cible détournée par `NF_MIGRATE_DATABASE_URL`, où la
 * comparaison porterait sur la base de la configuration et non sur celle qu'on
 * migre.
 *
 * ## Une base qui n'a JAMAIS eu de migrations — `--from-database`
 *
 * Adopter suppose des fichiers à inscrire. Une application passée du mode
 * dérivé, où le démarrage fabrique le schéma, au mode de production n'en a
 * aucun : sa base porte tout, son dossier de migrations est vide. Sans
 * référence, la première génération décrirait ce que le CODE déclare — un
 * schéma que cette base n'a peut-être jamais eu, si quelqu'un vient de changer
 * une entité — et l'inscrire graverait une affirmation fausse.
 *
 * `--from-database` LIT le schéma de la base et en écrit la migration de
 * référence, puis l'inscrit. Rien n'est exécuté sur la base. La suite redevient
 * ordinaire : le champ ajouté produit un `ALTER TABLE`.
 *
 * @example Adopter jusqu'à une migration précise
 * ```bash
 * nodefony orm:migrate:baseline --up-to 0003_audit_severity
 * nodefony orm:migrate            # applique la suite normalement
 * ```
 *
 * @example Reprendre une base qui existait avant toute migration
 * ```bash
 * nodefony orm:migrate:baseline --from-database   # la référence est LUE sur la base
 * nodefony orm:generate --name ajout_du_slug      # produit un ALTER, plus un CREATE
 * nodefony orm:migrate                            # applique
 * ```
 */
class OrmMigrateBaseline extends OrmMigrateCommand {
  constructor(cli: CliKernel) {
    super(
      "orm:migrate:baseline",
      "déclare une base déjà peuplée comme à niveau",
      cli,
      options,
    );
    this.addSharedOptions();
    this.addOption(
      "--up-to <tag>",
      "dernière migration inscrite (incluse) — ex. 0003_audit_severity ; toutes si omis",
    );
    this.addOption(
      "--from-database",
      "LIT le schéma de la base pour en écrire la migration de référence, puis l'inscrit — pour une base qui existait avant toute migration",
    );
    this.addOption(
      "--name <nom>",
      "nom de la migration de référence écrite par --from-database (défaut : base_existante)",
    );
  }

  /**
   * Écrit la migration de référence en LISANT la base, puis l'inscrit.
   *
   * ## Pourquoi la référence vient de la base, et non du code
   *
   * Le générateur ne connaît que les fichiers. Sans instantané de départ, il
   * décrit ce que le CODE déclare — c'est-à-dire, si quelqu'un vient de changer
   * une entité, un schéma que la base n'a jamais eu. L'adopter graverait cette
   * affirmation dans l'historique, et la colonne manquante ne s'appliquerait
   * plus jamais. Lue sur la base, la référence est vraie par construction : elle
   * décrit ce qui est là.
   *
   * ## Ce qui est écrit, et ce qui ne l'est pas
   *
   * Un fichier de migration et son instantané, dans le dossier de l'application.
   * **Aucune instruction n'est exécutée sur la base** — l'inscription qui suit
   * déclare appliquée une migration qui décrit un état déjà atteint.
   *
   * @param opts - options reçues.
   * @param resolution - connecteur prêt.
   * @param config - configuration validée du module.
   * @returns ce qui a été écrit, ou `null` si la commande a déjà refusé.
   */
  async #fromDatabase(
    opts: IBaselineOptions,
    resolution: Extract<IConnectorResolution, { kind: "ready" }>,
    config: IDrizzleConfig,
  ): Promise<IAdoptedBaseline | null> {
    const root = (this.kernel as Kernel).path;
    const dir = appMigrationsDir(this.kernel as Kernel, config.migrations.dir);
    if (dir === undefined) {
      this.fail(
        resolution.connector,
        "NF_MIGRATE_UNAVAILABLE",
        "La racine de l'application n'a pas pu être résolue : impossible de savoir où écrire la migration de référence.",
        "Le dossier des migrations se résout depuis la racine de l'application, jamais depuis le répertoire courant — sans quoi la commande serait juste ou fausse selon l'endroit d'où on la tape.",
        [action("nodefony inspect config --json")],
        opts.json,
      );
      return null;
    }
    const outDir = path.join(dir, resolution.dialect);
    const journal = await readJournal(outDir);
    if (journal !== null && journal.entries.length > 0) {
      // Adopter par lecture de la base suppose qu'il n'y a RIEN à quoi se
      // comparer. Des migrations déjà écrites décrivent une histoire ; en
      // poser une seconde, tirée de l'état courant, ferait deux récits du même
      // schéma — et le prochain diff repartirait du mauvais.
      this.fail(
        resolution.connector,
        "NF_MIGRATE_BASELINE_NOT_EMPTY",
        `Rien n'a été écrit : ce dossier porte déjà ${journal.entries.length} migration(s) (${outDir}).`,
        "La lecture de la base ne sert qu'à DÉMARRER un historique qui n'existe pas encore. Ici il en existe un : c'est lui qui fait foi, et la base s'adopte alors telle quelle. Si ces migrations décrivent bien l'état de la base, `orm:migrate:baseline` sans option les inscrit ; si elles décrivent autre chose, c'est un écart à regarder, pas une référence à réécrire.",
        [
          action(
            `nodefony orm:migrate:status --connector ${resolution.connector} --json`,
          ),
          action(
            `nodefony orm:migrate:baseline --connector ${resolution.connector}`,
          ),
        ],
        opts.json,
        EXIT.actionRequired,
      );
      return null;
    }
    const verdict = checkMigrationName(opts.name ?? "base_existante");
    if (!verdict.ok) {
      this.fail(
        resolution.connector,
        "NF_GENERATE_NAME",
        verdict.reason,
        "Le nom entre dans le tag de la migration de référence, et un tag ne se renomme plus une fois inscrit : c'est lui qui dit à chaque base ce qu'elle a déjà reçu.",
        [
          action(
            `nodefony orm:migrate:baseline --from-database --name ${verdict.suggestion ?? "base_existante"}`,
          ),
        ],
        opts.json,
        EXIT.actionRequired,
      );
      return null;
    }
    const adopted = await adoptFromDatabase({
      projectRoot: root,
      outDir,
      dialect: resolution.dialect,
      target: resolution.target,
      // Les tables du framework ont leurs PROPRES fichiers de migration, que
      // l'inscription qui suit prend en charge ; les lire ici en ferait une
      // seconde description du même schéma, et le prochain diff repartirait du
      // mauvais côté.
      excludedTables: [
        ...(await frameworkTables(resolution.dialect)),
        HISTORY_TABLE,
      ],
      declaredTables: registeredTables(resolution.connector).map(
        (t) => t.table,
      ),
      name: verdict.name,
      workDir: path.join(
        root,
        "node_modules",
        ".cache",
        "nodefony",
        "orm-adopt",
      ),
    });
    stampFormatMarker(outDir);
    return adopted;
  }

  override async generate(opts: IBaselineOptions = {}): Promise<this> {
    const resolved = this.resolveOrFail(opts, true);
    if (!resolved) {
      return this;
    }
    const { resolution, config } = resolved;
    const style = this.style;
    try {
      let reference: IAdoptedBaseline | null = null;
      if (opts.fromDatabase === true) {
        reference = await this.#fromDatabase(opts, resolution, config);
        if (reference === null) {
          return this;
        }
      }
      const migrator = await this.migrator(resolution, config);

      // 🔴 CONSTATER la base AVANT d'écrire dans l'historique.
      //
      // Adopter, c'est AFFIRMER que la base est à l'état que décrivent ces
      // migrations. L'affirmation n'était jamais vérifiée : la boucle inscrivait
      // tout fichier absent de l'historique, y compris une migration écrite une
      // minute plus tôt et jamais exécutée. L'état obtenu est le pire de la
      // chaîne — l'historique dit « tout est appliqué », la base n'a pas la
      // colonne, et plus AUCUNE commande n'offre de geste. Mesuré au banc : le
      // seul chemin restant était de détruire la base.
      //
      // La garde ne se déclenche que sans `--up-to` : borner l'adoption, c'est
      // précisément dire soi-même jusqu'où la base suit, et personne n'a alors à
      // le deviner. Et elle ne mord que sur un écart RÉEL — une base conforme
      // s'adopte sans un mot de plus, sinon la garde punirait qui n'a rien
      // demandé.
      //
      // ⚠️ Elle ne s'applique pas non plus quand la cible est DÉTOURNÉE : la
      // comparaison interroge l'ORM du registre, connecté à la base de la
      // CONFIGURATION — pas à celle que `NF_MIGRATE_DATABASE_URL` désigne. La
      // faire mordre là reviendrait à juger une base sur l'état d'une AUTRE,
      // c'est-à-dire à rendre exactement le genre de verdict faux qu'elle
      // existe pour empêcher. L'en-tête du rapport dit déjà que la cible est
      // détournée (#113) : celui qui adopte dans ce cas sait ce qu'il fait.
      if (
        opts.upTo === undefined &&
        opts.fromDatabase !== true &&
        !resolution.fromMigrateUrl
      ) {
        const gap = await gapAgainstDeclared(resolution.connector);
        if (gap !== null) {
          this.fail(
            resolution.connector,
            "NF_MIGRATE_BASELINE_AMBIGUOUS",
            `La base ne correspond pas au schéma déclaré : ${summarizeGap(gap)}. Rien n'a été inscrit.`,
            "Adopter reviendrait à déclarer appliquées des migrations que cette base n'a jamais " +
              "reçues — une affirmation fausse gravée dans l'historique, qu'aucune commande ne " +
              "peut ensuite rattraper. Dis jusqu'où la base suit avec `--up-to <tag>` : les " +
              "migrations postérieures resteront en attente et s'appliqueront normalement.",
            [
              action(
                `nodefony orm:migrate:status --connector ${resolution.connector}`,
              ),
              action(
                `nodefony orm:migrate:baseline --up-to <tag> --connector ${resolution.connector}`,
              ),
            ],
            opts.json,
            EXIT.actionRequired,
          );
          return this;
        }
      }

      const adopted = await migrator.baseline(opts.upTo);
      const plan = await migrator.status();
      const report = await this.report(plan, resolution, config);
      const payload = {
        ...report,
        adopted: adopted.map((a) => ({ source: a.source, tag: a.tag })),
        // Publié dans la charge utile, jamais dans un journal : le boot
        // silencieux des commandes avale `INFO` comme `WARNING`, et un
        // avertissement qui n'atteint personne est pire qu'aucun.
        ...(reference === null
          ? {}
          : {
              reference: {
                tag: reference.tag,
                file: reference.file,
                runnable: reference.runnable,
                extraTables: reference.extraTables,
              },
            }),
      };
      let human = "";
      if (reference !== null) {
        human +=
          `${style.green(style.bold(`✓ Référence ${reference.tag} écrite en LISANT la base`))} ` +
          `${style.dim("— aucune instruction n'a été exécutée dessus")}\n` +
          `  ${style.dim(reference.file)}\n`;
        if (reference.extraTables.length > 0) {
          // Une table de la référence qu'aucune entité ne déclare est une table
          // que le prochain diff propose de SUPPRIMER. La nommer maintenant,
          // pendant qu'il est encore facile de décider.
          human +=
            `${style.bold("⚠️  Tables LUES sans être déclarées par l'application")} : ` +
            `${reference.extraTables.join(", ")}.\n` +
            `  ${style.dim("La prochaine génération proposera de les SUPPRIMER — relire le fichier avant.")}\n`;
        }
        if (!reference.runnable) {
          // Une référence restée en commentaire s'inscrit très bien ici — et ne
          // recrée RIEN le jour où quelqu'un monte un environnement neuf depuis
          // ces mêmes fichiers. Le dire là où ça se lit.
          human +=
            `${style.bold("⚠️  Son corps est resté en COMMENTAIRE")} — une base montée depuis ces ` +
            `fichiers sortirait VIDE. Relire le fichier avant de créer un environnement.\n`;
        }
        human += "\n";
      }
      if (adopted.length === 0) {
        human +=
          `${style.green("Rien à déclarer : toutes les migrations connues sont déjà enregistrées.")}\n\n` +
          renderStatus(report, style);
      } else {
        human += `${style.green(style.bold(`✓ ${adopted.length} migration(s) déclarée(s) comme appliquée(s)`))} ${style.dim("— aucun SQL n'a été exécuté")}\n`;
        for (const a of adopted) {
          human += `  ${style.green("=")} ${a.source}/${a.tag}\n`;
        }
        human += `\n${renderStatus(report, style)}`;
      }
      this.respond(payload, human, report.exitCode, opts.json);
    } catch (e) {
      this.failFrom(e, resolution.connector, opts.json, resolution.ddl);
    }
    return this;
  }
}

export default OrmMigrateBaseline;
export { MIGRATION_FORMAT_VERSION, action };
