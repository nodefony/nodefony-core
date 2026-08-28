import type { CliKernel, OptionsCommandInterface } from "nodefony";
import { buildReport, renderStatus } from "../src/migrator/explain";
import { OrmMigrateCommand, type IMigrateSharedOptions } from "./migrateShared";

/**
 * `kernelEvent: "onPostReady"` — la commande LIT l'état de l'application.
 *
 * Le registre des connecteurs est peuplé au démarrage par le service du module.
 * Une commande branchée plus tôt passerait avant lui et ne trouverait rien.
 * Aucun serveur n'écoute pour autant : le profil console est respecté.
 */
const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

/**
 * `nodefony orm:migrate:status` — dit ce que la base a reçu, ce qui reste, et
 * ce qu'il faut taper.
 *
 * **Lecture seule et sans verrou.** Elle n'écrit rien, pas même la table
 * d'historique : un état qui se consulte ne doit pas modifier ce qu'il
 * observe — et une sonde qui écrit dans la base n'est plus une sonde.
 *
 * ## Son autre métier : barrière d'intégration continue
 *
 * Le code de sortie porte le verdict, et il ne changera jamais de sens :
 *
 * | Code | Ce que ça veut dire                                                |
 * | ---- | ------------------------------------------------------------------ |
 * | `0`  | à jour — rien à faire                                              |
 * | `1`  | une action humaine est requise (migrations en attente, écart, échec) |
 * | `2`  | la commande n'a pas pu travailler (base injoignable, verrou, usage) |
 *
 * Une passe de déploiement peut donc s'arrêter dessus sans lire un mot :
 *
 * ```bash
 * nodefony orm:migrate:status --json || exit 1
 * ```
 *
 * @example Ce qu'un agent lit
 * ```bash
 * nodefony orm:migrate:status --json | jq -r '.verdict, .nextActions[0].command'
 * # pending
 * # nodefony orm:migrate
 * ```
 */
class OrmMigrateStatus extends OrmMigrateCommand {
  constructor(cli: CliKernel) {
    super(
      "orm:migrate:status",
      "Affiche l'état des migrations d'un connecteur (lecture seule ; code de sortie 0 à jour, 1 action requise, 2 panne)",
      cli,
      options,
    );
    this.addSharedOptions();
  }

  override async generate(opts: IMigrateSharedOptions = {}): Promise<this> {
    const resolved = this.resolveOrFail(opts, true);
    if (!resolved) {
      return this;
    }
    const { resolution, config } = resolved;
    try {
      const migrator = await this.migrator(resolution, config);
      const plan = await migrator.status();
      const report = buildReport(plan, {
        ddl: resolution.ddl,
        divergenceBlocks: config.migrations.divergence === "fail",
      });
      this.emitReport(report, renderStatus(report, this.style), opts.json);
    } catch (e) {
      this.failFrom(e, resolution.connector, opts.json, resolution.ddl);
    }
    return this;
  }
}

export default OrmMigrateStatus;
