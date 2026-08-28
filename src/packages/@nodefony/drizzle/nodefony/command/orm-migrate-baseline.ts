import type { CliKernel, OptionsCommandInterface } from "nodefony";
import {
  MIGRATION_FORMAT_VERSION,
  action,
  buildReport,
  renderStatus,
} from "../src/migrator/explain";
import { OrmMigrateCommand, type IMigrateSharedOptions } from "./migrateShared";

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
      const adopted = await migrator.baseline(opts.upTo);
      const plan = await migrator.status();
      const report = buildReport(plan, {
        ddl: resolution.ddl,
        divergenceBlocks: config.migrations.divergence === "fail",
      });
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
