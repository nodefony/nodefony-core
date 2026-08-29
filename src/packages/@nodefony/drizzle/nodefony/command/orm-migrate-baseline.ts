import type { CliKernel, OptionsCommandInterface } from "nodefony";
import {
  MIGRATION_FORMAT_VERSION,
  action,
  renderStatus,
} from "../src/migrator/explain";
import { OrmMigrateCommand, type IMigrateSharedOptions } from "./migrateShared";
import { EXIT } from "../src/migrator/explain";
import { gapAgainstDeclared } from "../src/migrator/divergence";
import { summarizeGap } from "../src/migrator/schemaDiff";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Options propres à l'adoption d'une base existante. */
interface IBaselineOptions extends IMigrateSharedOptions {
  upTo?: string;
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
 * Deux cas y échappent, et pour la même raison — quelqu'un a déjà dit ce que la
 * garde essaie de deviner : `--up-to`, qui borne l'adoption explicitement, et
 * une cible détournée par `NF_MIGRATE_DATABASE_URL`, où la comparaison porterait
 * sur la base de la configuration et non sur celle qu'on migre.
 *
 * @example Adopter jusqu'à une migration précise
 * ```bash
 * nodefony orm:migrate:baseline --up-to 0003_audit_severity
 * nodefony orm:migrate            # applique la suite normalement
 * ```
 */
class OrmMigrateBaseline extends OrmMigrateCommand {
  constructor(cli: CliKernel) {
    super(
      "orm:migrate:baseline",
      "Déclare une base déjà peuplée comme à niveau, sans exécuter de SQL (adoption explicite)",
      cli,
      options,
    );
    this.addSharedOptions();
    this.addOption(
      "--up-to <tag>",
      "dernière migration inscrite (incluse) — ex. 0003_audit_severity ; toutes si omis",
    );
  }

  override async generate(opts: IBaselineOptions = {}): Promise<this> {
    const resolved = this.resolveOrFail(opts, true);
    if (!resolved) {
      return this;
    }
    const { resolution, config } = resolved;
    const style = this.style;
    try {
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
      if (opts.upTo === undefined && !resolution.fromMigrateUrl) {
        const ecart = await gapAgainstDeclared(resolution.connector);
        if (ecart !== null) {
          this.fail(
            resolution.connector,
            "NF_MIGRATE_BASELINE_AMBIGUOUS",
            `La base ne correspond pas au schéma déclaré : ${summarizeGap(ecart)}. Rien n'a été inscrit.`,
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
      };
      let human: string;
      if (adopted.length === 0) {
        human =
          `${style.green("Rien à déclarer : toutes les migrations connues sont déjà enregistrées.")}\n\n` +
          renderStatus(report, style);
      } else {
        human = `${style.green(style.bold(`✓ ${adopted.length} migration(s) déclarée(s) comme appliquée(s)`))} ${style.dim("— aucun SQL n'a été exécuté")}\n`;
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
