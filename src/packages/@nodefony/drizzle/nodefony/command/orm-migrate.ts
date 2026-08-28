import type { CliKernel, OptionsCommandInterface } from "nodefony";
import type { IMigrationFile } from "../src/migrator/types";
import {
  EXIT,
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

/**
 * Options propres à l'application des migrations.
 *
 * Pas de `--source` ici, et c'est délibéré : l'applicateur applique l'ordre
 * complet (le framework d'abord, l'application ensuite) et n'a pas de filtre
 * par source. Déclarer l'option pour l'ignorer serait pire qu'un refus — un
 * argument accepté puis jeté fait croire à un comportement qui n'existe pas.
 */
interface IMigrateOptions extends IMigrateSharedOptions {
  dryRun?: boolean;
  outOfOrder?: boolean;
  ignoreMissing?: boolean;
}

/**
 * Ce qu'un `--dry-run` rend — la même charge utile qu'un état, plus le SQL.
 *
 * Le SQL est ce que le mode d'essai a de plus utile : il montre EXACTEMENT ce
 * qui va être exécuté, sans rien exécuter. Un mode d'essai qui se contenterait
 * d'annoncer des noms de fichiers ne dispenserait pas d'aller les lire.
 */
interface IDryRunReport {
  formatVersion: typeof MIGRATION_FORMAT_VERSION;
  connector: string;
  verdict: string;
  exitCode: 0 | 1 | 2;
  dryRun: true;
  summary: string;
  nextActions: { command: string; args: string[] }[];
  sources: unknown[];
  driver: unknown;
  /** Le SQL qui serait exécuté, migration par migration, dans l'ordre. */
  statements: { source: string; tag: string; sql: string[] }[];
}

/**
 * `nodefony orm:migrate` — applique les migrations restantes, sous verrou.
 *
 * ## Ce que la commande fait, dans cet ordre exact
 *
 * 1. **prend le verrou** de la base (verrou natif du serveur : il se libère
 *    tout seul si le processus meurt — aucun verrou fantôme à débloquer à la
 *    main) ;
 * 2. **crée la table d'historique** si elle n'existe pas ;
 * 3. **valide TOUT** — empreintes, ordre, échecs passés, fichiers manquants ;
 * 4. **applique** les migrations une par une, chacune dans sa transaction là où
 *    la base le permet.
 *
 * La validation précède toute écriture : **un refus laisse la base
 * intacte**. C'est ce qui rend sûr de relancer la commande après un refus.
 *
 * ## Elle ne s'exécute jamais toute seule au démarrage — sauf si on le demande
 *
 * Appliquer des migrations au démarrage n'est pas un défaut, et ce n'est pas de
 * la prudence : au démarrage, plusieurs exemplaires partent en même temps. Le
 * mode `ddl: "migrate"` existe pour les déploiements à exemplaire unique et
 * s'écrit à la main. En production orchestrée, c'est un travail séparé qui
 * lance cette commande AVANT que les nouveaux exemplaires ne démarrent.
 *
 * ## Le compte qui migre n'est pas le compte qui sert
 *
 * `NF_MIGRATE_DATABASE_URL` remplace, pour cette commande seulement, la
 * connexion du connecteur. C'est le véhicule du moindre privilège : le secret
 * qui a le droit de modifier le schéma est monté dans le travail de migration,
 * et nulle part ailleurs. Elle doit désigner une connexion **directe** — un
 * répartiteur de connexions en mode transaction casse le verrou.
 *
 * @example Voir sans rien appliquer
 * ```bash
 * nodefony orm:migrate --dry-run
 * ```
 *
 * @example Dans un travail de déploiement
 * ```bash
 * NF_MIGRATE_DATABASE_URL="postgres://migrator:…@db:5432/app" nodefony orm:migrate --json
 * ```
 */
class OrmMigrate extends OrmMigrateCommand {
  constructor(cli: CliKernel) {
    super(
      "orm:migrate",
      "Applique les migrations en attente (verrou, historique, validation avant écriture)",
      cli,
      options,
    );
    this.addSharedOptions();
    this.addOption(
      "-n, --dry-run",
      "n'applique RIEN : valide et affiche le SQL qui serait exécuté",
    );
    this.addOption(
      "--out-of-order",
      "accepte une migration plus ancienne que la dernière appliquée (trace d'une fusion de branches — à ne taper que si le message le demande)",
    );
    this.addOption(
      "--ignore-missing",
      "accepte qu'une migration enregistrée n'ait plus de fichier (à ne taper que si le message le demande)",
    );
  }

  override async generate(opts: IMigrateOptions = {}): Promise<this> {
    const resolved = this.resolveOrFail(opts, true);
    if (!resolved) {
      return this;
    }
    const { resolution, config } = resolved;
    const style = this.style;
    try {
      const migrator = await this.migrator(resolution, config);
      // La validation d'un essai est la MÊME que celle d'une application réelle
      // — c'est tout l'intérêt : un essai qui passerait là où le vrai refuse ne
      // servirait qu'à donner confiance à tort.
      const run = await migrator.migrate({
        dryRun: opts.dryRun === true,
        outOfOrder: opts.outOfOrder === true,
        ignoreMissing: opts.ignoreMissing === true,
      });
      const plan = await migrator.status();
      const report = buildReport(plan, {
        ddl: resolution.ddl,
        divergenceBlocks: config.migrations.divergence === "fail",
      });

      if (opts.dryRun === true) {
        const pending = plan.pending as readonly IMigrationFile[];
        const payload: IDryRunReport = {
          formatVersion: MIGRATION_FORMAT_VERSION,
          connector: report.connector,
          verdict: report.verdict,
          exitCode: report.exitCode,
          dryRun: true,
          summary: report.summary,
          nextActions: report.nextActions,
          sources: report.sources,
          driver: report.driver,
          statements: pending.map((f) => ({
            source: f.source,
            tag: f.tag,
            sql: [...f.statements],
          })),
        };
        let human = `${style.bold("Essai — RIEN n'a été appliqué.")}\n\n`;
        if (pending.length === 0) {
          human += `${style.green("Aucune migration en attente : il n'y a rien à appliquer.")}\n`;
        } else {
          for (const f of pending) {
            human += `${style.bold(`── ${f.source}/${f.tag}`)}\n`;
            for (const sql of f.statements) {
              human += `${style.dim(sql)};\n`;
            }
            human += "\n";
          }
          human += `${style.bold("Pour appliquer :")}\n  ${style.green(
            `nodefony orm:migrate${resolution.connector === "default" ? "" : ` --connector ${resolution.connector}`}`,
          )}\n`;
        }
        this.respond(payload, human, report.exitCode, opts.json);
        return this;
      }

      if (run.applied.length === 0) {
        this.emitReport(
          report,
          `${style.green("Rien à appliquer : la base est déjà à jour.")}\n\n${renderStatus(report, style)}`,
          opts.json,
        );
        return this;
      }
      let human = `${style.green(style.bold(`✓ ${run.applied.length} migration(s) appliquée(s)`))} ${style.dim(`(exécution ${run.runId})`)}\n`;
      for (const a of run.applied) {
        human += `  ${style.green("+")} ${a.source}/${a.tag} ${style.dim(`— ${a.executionMs} ms`)}\n`;
      }
      human += `\n${renderStatus(report, style)}`;
      // Le code de sortie est celui de l'état APRÈS application : on peut avoir
      // appliqué ce qu'on pouvait ET laisser un écart à traiter.
      this.emitReport(report, human, opts.json);
    } catch (e) {
      this.failFrom(e, resolution.connector, opts.json, resolution.ddl);
    }
    return this;
  }
}

export default OrmMigrate;
export { EXIT, action };
